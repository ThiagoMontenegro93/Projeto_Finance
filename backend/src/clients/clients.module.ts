import {
  BadRequestException, Body, Controller, Delete, ForbiddenException, Get, Injectable, Module,
  NotFoundException, Param, Patch, Post, Query, ServiceUnavailableException,
} from '@nestjs/common';
import { Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { IsOptional, IsString } from 'class-validator';
import { AuthUser, CurrentUser, Public, Roles } from '../common/auth';
import { num } from '../common/money';
import { PrismaService } from '../prisma/prisma.service';
import { COLLECTION_STRATEGIES, computeScore, SCORE_META } from '../score/score-engine';
import { isValidCpf, parseWhatsapp } from './whatsapp-importer';

type Tx = Prisma.TransactionClient | PrismaService;

const EDITABLE = [
  'name', 'cpf', 'rg', 'birthDate', 'maritalStatus', 'profession',
  'phone', 'whatsapp', 'email', 'cep', 'street', 'number', 'complement', 'district', 'city', 'state',
  'pixKey', 'pixKeyType', 'bank', 'income',
  'emergencyName', 'emergencyPhone', 'emergencyRelation', 'guarantorId', 'referredById', 'notes',
] as const;

function pickClient(body: Record<string, unknown>) {
  const data: Record<string, unknown> = {};
  for (const k of EDITABLE) {
    if (body[k] === undefined) continue;
    let v = body[k];
    if (v === '') v = null;
    if (k === 'birthDate' && v) v = new Date(String(v));
    if (k === 'income' && v != null) v = Number(v);
    if (k === 'cpf' && v) {
      const d = String(v).replace(/\D/g, '');
      if (d.length === 11) v = `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
    }
    data[k] = v;
  }
  return data;
}

@Injectable()
export class ScoreService implements OnApplicationBootstrap {
  private log = new Logger('Score');
  constructor(private prisma: PrismaService) {}

  onApplicationBootstrap() {
    if (process.env.NODE_ENV !== 'test') this.recalcAll().catch((e) => this.log.warn(e.message));
  }

  /** Todo dia 06:00: atualiza o score de todos (atraso cresce sozinho; 180 dias vira PERDA). */
  @Cron('0 6 * * *', { timeZone: 'America/Sao_Paulo' })
  async recalcAll() {
    const ids = await this.prisma.client.findMany({ select: { id: true } });
    for (const { id } of ids) await this.recalc(id);
    this.log.log(`Score recalculado para ${ids.length} clientes`);
    return { total: ids.length };
  }

  /** Recalcula score e aplica efeitos (margem, taxa fidelidade, bloqueio PERDA). */
  async recalc(clientId: string, db: Tx = this.prisma, today = new Date()) {
    const insts = await db.installment.findMany({
      where: { loan: { clientId } },
      select: { dueDate: true, paidAt: true, status: true },
    });
    const client = await db.client.findUniqueOrThrow({ where: { id: clientId } });
    const r = computeScore(insts, today);
    const meta = SCORE_META[r.status];
    const data: Prisma.ClientUpdateInput = { score: r.score, scoreStatus: r.status };
    if (r.status === 'PERDA') {
      data.blocked = true;
      data.blockedReason = r.maxDaysLate >= 180 ? `Atraso de ${r.maxDaysLate} dias` : 'Score PERDA';
    }
    // Não rebaixa manualmente a margem de quem é BOM; ajusta para o padrão da faixa
    data.creditLimit = meta.creditLimit;
    data.interestRate = meta.interestRate;
    if (client.blocked && r.status !== 'PERDA') delete data.blocked; // desbloqueio só manual pelo Super Admin
    await db.client.update({ where: { id: clientId }, data });
    return { ...r, meta };
  }
}

class ImportDto {
  @IsString() text: string;
}
class UnblockDto {
  @IsOptional() @IsString() reason?: string;
}

@Controller('clients')
export class ClientsController {
  constructor(private prisma: PrismaService, private score: ScoreService) {}

  private scope(u: AuthUser): Prisma.ClientWhereInput {
    if (u.role === 'FUNCIONARIO') return { OR: [{ ownerUserId: u.id }, { loans: { some: { lenderUserId: u.id } } }] };
    return {};
  }

  @Get()
  list(@CurrentUser() u: AuthUser, @Query('q') q?: string, @Query('status') status?: string) {
    const where: Prisma.ClientWhereInput = { AND: [this.scope(u)] };
    if (q) (where.AND as Prisma.ClientWhereInput[]).push({ OR: [{ name: { contains: q, mode: 'insensitive' } }, { cpf: { contains: q } }, { phone: { contains: q } }] });
    if (status) (where.AND as Prisma.ClientWhereInput[]).push({ scoreStatus: status as any });
    return this.prisma.client.findMany({
      where,
      orderBy: { name: 'asc' },
      include: {
        guarantor: { select: { id: true, name: true } },
        loans: { where: { status: 'ATIVO' }, select: { id: true, principal: true, installments: { where: { status: 'PENDENTE' }, select: { amount: true, dueDate: true }, orderBy: { dueDate: 'asc' } } } },
      },
    });
  }

  @Get(':id')
  async get(@Param('id') id: string) {
    const c = await this.prisma.client.findUnique({
      where: { id },
      include: {
        guarantor: { select: { id: true, name: true, phone: true, whatsapp: true } },
        referredBy: { select: { id: true, name: true } },
        guaranteeing: { select: { id: true, name: true } },
        referrals: { select: { id: true, name: true } },
        documents: { orderBy: { createdAt: 'desc' } },
        loans: { orderBy: { createdAt: 'desc' }, include: { installments: { orderBy: { number: 'asc' } }, lender: { select: { name: true } } } },
      },
    });
    if (!c) throw new NotFoundException('Cliente não encontrado');
    return { ...c, meta: SCORE_META[c.scoreStatus], strategies: COLLECTION_STRATEGIES[c.scoreStatus] };
  }

  @Post()
  async create(@CurrentUser() u: AuthUser, @Body() body: Record<string, unknown>) {
    const data = pickClient(body) as Prisma.ClientUncheckedCreateInput;
    if (!data.name || !data.cpf) throw new BadRequestException('Nome e CPF são obrigatórios');
    if (!isValidCpf(String(data.cpf))) throw new BadRequestException('CPF inválido');
    return this.prisma.client.create({ data: { ...data, ownerUserId: u.id } });
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() body: Record<string, unknown>) {
    const data = pickClient(body);
    if (data.cpf && !isValidCpf(String(data.cpf))) throw new BadRequestException('CPF inválido');
    if (data.guarantorId === id) throw new BadRequestException('Cliente não pode ser fiador de si mesmo');
    return this.prisma.client.update({ where: { id }, data });
  }

  @Delete(':id')
  @Roles('DONO')
  async remove(@Param('id') id: string) {
    const active = await this.prisma.loan.count({ where: { clientId: id, status: 'ATIVO' } });
    if (active) throw new BadRequestException('Cliente com empréstimo ativo não pode ser excluído');
    await this.prisma.client.delete({ where: { id } });
    return { ok: true };
  }

  /** Preview do importador WhatsApp ("14 de 18 campos"). */
  @Post('import/preview')
  preview(@Body() dto: ImportDto) {
    return parseWhatsapp(dto.text);
  }

  @Post(':id/score/recalc')
  recalc(@Param('id') id: string) {
    return this.score.recalc(id);
  }

  /** PERDA 💀: somente Super Admin desbloqueia. */
  @Post(':id/unblock')
  async unblock(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: UnblockDto) {
    if (u.role !== 'SUPER_ADMIN') throw new ForbiddenException('Somente o Super Admin desbloqueia clientes PERDA');
    return this.prisma.client.update({
      where: { id },
      data: { blocked: false, blockedReason: null, notes: dto.reason ? `Desbloqueado: ${dto.reason}` : undefined },
    });
  }

  @Post(':id/block')
  @Roles('DONO')
  block(@Param('id') id: string, @Body() dto: UnblockDto) {
    return this.prisma.client.update({ where: { id }, data: { blocked: true, blockedReason: dto.reason ?? 'Bloqueio manual' } });
  }

  @Get(':id/collection-letter')
  async letter(@Param('id') id: string) {
    const c = await this.get(id);
    const open = c.loans.flatMap((l) => l.installments.filter((i) => i.status === 'PENDENTE' && i.dueDate < new Date()));
    const total = open.reduce((s, i) => s + num(i.amount), 0);
    return {
      title: 'Carta de Cobrança',
      body: `Prezado(a) ${c.name}, CPF ${c.cpf},\n\nConstam em aberto ${open.length} parcela(s) vencida(s), totalizando ${total.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} (sem multa).\nSolicitamos a regularização em até 5 dias úteis. Estamos abertos a acordo (até 30% de desconto à vista).\n\nAtenciosamente,\nLendControl`,
    };
  }
}

/** Proxy ViaCEP (o painel também consulta direto no navegador). */
@Controller('cep')
export class CepController {
  @Public()
  @Get(':cep')
  async cep(@Param('cep') cep: string) {
    const d = cep.replace(/\D/g, '');
    if (d.length !== 8) throw new BadRequestException('CEP deve ter 8 dígitos');
    let j: Record<string, string>;
    try {
      j = (await (await fetch(`https://viacep.com.br/ws/${d}/json/`)).json()) as Record<string, string>;
    } catch {
      throw new ServiceUnavailableException('ViaCEP indisponível no momento — preencha o endereço manualmente');
    }
    if (j.erro) throw new NotFoundException('CEP não encontrado');
    return { cep: j.cep, street: j.logradouro, district: j.bairro, city: j.localidade, state: j.uf, complement: j.complemento };
  }
}

@Module({ providers: [ScoreService], controllers: [ClientsController, CepController], exports: [ScoreService] })
export class ClientsModule {}
