import {
  BadRequestException, Controller, Get, Injectable, Logger, Module, NotFoundException, Param, Post,
  Query, Res, UploadedFile, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Cron } from '@nestjs/schedule';
import { BackupKind, Prisma } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { randomBytes, randomUUID } from 'crypto';
import type { Response } from 'express';
import { promises as fs } from 'fs';
import * as nodemailer from 'nodemailer';
import { basename, join, resolve } from 'path';
import { ClientsModule, ScoreService } from '../clients/clients.module';
import { isValidCpf } from '../clients/whatsapp-importer';
import { AuthUser, CurrentUser, Roles } from '../common/auth';
import { dec, num } from '../common/money';
import { buildSchedule } from '../loan-engine/loan-engine';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.module';
import { BackupData, buildWorkbook, parseCsv, parseWorkbook, SheetKey, SHEETS, toCsv } from './workbook';

const KEEP = 10;
const MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const d = (v: unknown) => (v == null || v === '' ? null : v instanceof Date ? v : new Date(String(v)));
const n = (v: unknown) => (v == null || v === '' ? null : Number(v));
const s = (v: unknown) => (v == null || v === '' ? null : String(v));

export interface RestoreReport {
  dryRun: boolean;
  ok: boolean;
  errors: string[];
  warnings: string[];
  counts: Record<string, { created: number; updated: number; skipped: number }>;
}

@Injectable()
export class BackupService {
  private log = new Logger('Backup');
  private dir = resolve(process.env.BACKUP_DIR ?? './storage/backups');

  constructor(private prisma: PrismaService, private settings: SettingsService, private score: ScoreService) {}

  async collect(): Promise<BackupData> {
    const [clients, loans, insts, payments, users, ledger, transfers] = await Promise.all([
      this.prisma.client.findMany({ orderBy: { name: 'asc' } }),
      this.prisma.loan.findMany({ orderBy: { code: 'asc' }, include: { client: { select: { name: true } } } }),
      this.prisma.installment.findMany({ orderBy: [{ loanId: 'asc' }, { number: 'asc' }], include: { loan: { select: { clientId: true, lateFeeDailyRate: true, client: { select: { name: true } } } } } }),
      this.prisma.payment.findMany({ orderBy: { paidAt: 'asc' } }),
      this.prisma.user.findMany({ orderBy: { name: 'asc' } }),
      this.prisma.cashLedger.findMany({ orderBy: { createdAt: 'asc' } }),
      this.prisma.capitalTransfer.findMany({ orderBy: { createdAt: 'asc' } }),
    ]);
    const money = (v: Prisma.Decimal | null) => (v == null ? null : num(v));
    return {
      clientes: clients.map((c) => ({ ...c, creditLimit: money(c.creditLimit), interestRate: money(c.interestRate), income: money(c.income), blocked: c.blocked ? 'SIM' : 'NAO' })),
      emprestimos: loans.map((l) => ({ ...l, clientName: l.client.name, principal: money(l.principal), interestRate: money(l.interestRate), lateFeeDailyRate: money(l.lateFeeDailyRate) })),
      parcelas: insts.map((i) => ({ ...i, clientId: i.loan.clientId, clientName: i.loan.client.name, amount: money(i.amount), interestPart: money(i.interestPart), principalPart: money(i.principalPart), paidAmount: money(i.paidAmount), lateFeeDailyRate: money(i.loan.lateFeeDailyRate) })),
      pagamentos: payments.map((p) => ({ ...p, amount: money(p.amount), lateFee: money(p.lateFee) })),
      equipe: users.map((u) => ({ id: u.id, name: u.name, email: u.email, role: u.role, ownerId: u.ownerId, capitalDisponivel: money(u.capitalDisponivel), capitalEmprestado: money(u.capitalEmprestado), comissaoAcumulada: money(u.comissaoAcumulada), saldoARepassar: money(u.saldoARepassar), commissionRate: money(u.commissionRate), active: u.active ? 'SIM' : 'NAO' })),
      movimentacoes: [
        ...ledger.map((l) => ({ id: l.id, source: 'LEDGER', createdAt: l.createdAt, userId: l.userId, type: l.type, amount: money(l.amount), balanceAfter: money(l.balanceAfter), loanId: l.loanId, description: l.description })),
        ...transfers.map((t) => ({ id: t.id, source: 'TRANSFER', createdAt: t.createdAt, userId: t.fromUserId, toUserId: t.toUserId, type: t.type, amount: money(t.amount), description: t.notes })),
      ],
    };
  }

  /** Modelo: 6 registros de teste reais + linhas modelo vazias até completar 500. */
  sample(): BackupData {
    const owner = { id: randomUUID(), name: 'Dono Exemplo', email: 'dono@exemplo.com', role: 'DONO', capitalDisponivel: 40000, capitalEmprestado: 0, comissaoAcumulada: 0, saldoARepassar: 0, commissionRate: 0, active: 'SIM' };
    const emp = { id: randomUUID(), name: 'Funcionário Exemplo', email: 'func@exemplo.com', role: 'FUNCIONARIO', ownerId: owner.id, capitalDisponivel: 10000, capitalEmprestado: 0, comissaoAcumulada: 0, saldoARepassar: 0, commissionRate: 0.3, active: 'SIM' };
    const people = [
      ['Ana Teste Silva', makeCpf('111444777'), 'BOM'],
      ['Bruno Teste Souza', makeCpf('222555888'), 'BOM'],
      ['Carla Teste Lima', makeCpf('333666999'), 'REGULAR'],
      ['Diego Teste Rocha', makeCpf('444777000'), 'RUIM'],
      ['Elaine Teste Alves', makeCpf('555888111'), 'REGULAR'],
      ['Fábio Teste Costa', makeCpf('666999222'), 'PERDA'],
    ];
    const now = new Date();
    const today = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
    const clientes: Record<string, unknown>[] = [];
    const emprestimos: Record<string, unknown>[] = [];
    const parcelas: Record<string, unknown>[] = [];
    const methods = ['MENSAL', 'SEMANAL', 'QUINZENAL', 'DIARIO', 'MENSAL', 'MENSAL'] as const;
    people.forEach(([name, cpf, status], i) => {
      const id = randomUUID();
      clientes.push({ id, name, cpf, phone: `1199999000${i}`, whatsapp: `1199999000${i}`, cep: '01001-000', street: 'Praça da Sé', number: String(10 + i), district: 'Sé', city: 'São Paulo', state: 'SP', pixKey: cpf, creditLimit: status === 'BOM' ? 1500 : 1000, interestRate: status === 'BOM' ? 0.08 : 0.1, blocked: status === 'PERDA' ? 'SIM' : 'NAO', guarantorId: i > 0 ? clientes[0].id : null });
      const loanId = randomUUID();
      const method = methods[i];
      const late = { BOM: 0, REGULAR: 3, RUIM: 25, PERDA: 190 }[status]!;
      const first = new Date(today.getTime() - (late + 1) * 86_400_000);
      const sched = buildSchedule({ principal: 1000, rate: 0.1, installments: 3, method, firstDueDate: first });
      emprestimos.push({ id: loanId, code: i + 1, clientId: id, clientName: name, funderUserId: owner.id, lenderUserId: emp.id, principal: 1000, interestRate: 0.1, method, installmentsCount: 3, lateFeeDailyRate: 0.01, startDate: new Date(first.getTime() - 30 * 86_400_000), firstDueDate: first, status: 'ATIVO' });
      sched.forEach((p) => parcelas.push({ id: randomUUID(), clientId: id, clientName: name, loanId, number: p.number, dueDate: p.dueDate, amount: p.amount, interestPart: p.interestPart, principalPart: p.principalPart, status: late === 0 && p.number === 1 ? 'PAGO' : 'PENDENTE', lateFeeDailyRate: 0.01, paidAt: late === 0 && p.number === 1 ? p.dueDate : null, paidAmount: late === 0 && p.number === 1 ? p.amount : null }));
    });
    return { clientes, emprestimos, parcelas, pagamentos: [], equipe: [owner, emp], movimentacoes: [] };
  }

  async generate(kind: BackupKind = 'MANUAL') {
    await fs.mkdir(this.dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16);
    const fileName = `lendcontrol-backup-${stamp}.xlsx`;
    try {
      const data = await this.collect();
      const wb = await buildWorkbook(data);
      const buffer = Buffer.from(await wb.xlsx.writeBuffer());
      await fs.writeFile(join(this.dir, fileName), buffer);
      const rows = Object.values(data).reduce((a, r) => a + r.length, 0);
      const emailedTo = await this.email(fileName, buffer).catch((e) => {
        this.log.warn(`E-mail do backup falhou: ${e.message}`);
        return null;
      });
      const log = await this.prisma.backupLog.create({ data: { kind, status: 'SUCESSO', fileName, sizeBytes: buffer.length, rowsCount: rows, emailedTo } });
      await this.prune();
      return log;
    } catch (e) {
      await this.prisma.backupLog.create({ data: { kind, status: 'FALHA', fileName, error: String(e.message ?? e) } });
      throw e;
    }
  }

  private async email(fileName: string, buffer: Buffer): Promise<string | null> {
    const to = await this.settings.get('backup_email');
    if (!to || !process.env.SMTP_HOST) return null;
    const transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT ?? 587),
      secure: process.env.SMTP_SECURE === 'true',
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
    });
    await transport.sendMail({
      from: process.env.SMTP_FROM ?? process.env.SMTP_USER,
      to,
      subject: `LendControl — backup semanal ${new Date().toLocaleDateString('pt-BR')}`,
      text: 'Segue o backup semanal do LendControl (7 abas + Regras BANE). Se o sistema cair, dá para operar só por esta planilha.',
      attachments: [{ filename: fileName, content: buffer, contentType: MIME }],
    });
    return to;
  }

  /** Mantém só os 10 últimos arquivos. */
  private async prune() {
    const files = (await fs.readdir(this.dir)).filter((f) => f.startsWith('lendcontrol-backup-') && f.endsWith('.xlsx')).sort().reverse();
    for (const f of files.slice(KEEP)) await fs.rm(join(this.dir, f), { force: true });
  }

  async history() {
    const files = new Set(await fs.readdir(this.dir).catch(() => [] as string[]));
    const logs = await this.prisma.backupLog.findMany({ orderBy: { createdAt: 'desc' }, take: 30 });
    return logs.map((l) => ({ ...l, available: files.has(l.fileName) })).filter((l, i) => l.available || l.kind === 'RESTAURACAO' || l.status === 'FALHA' || i < KEEP).slice(0, 20);
  }

  async file(fileName: string) {
    const safe = basename(fileName);
    try {
      return await fs.readFile(join(this.dir, safe));
    } catch {
      throw new NotFoundException('Arquivo de backup não encontrado');
    }
  }

  async template() {
    const wb = await buildWorkbook(this.sample());
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  @Cron('0 8 * * 1', { timeZone: 'America/Sao_Paulo', name: 'backup-semanal' })
  async weekly() {
    const r = await this.generate('AUTOMATICO');
    this.log.log(`Backup semanal gerado: ${r.fileName}`);
  }

  /**
   * Restauração: valida a planilha e distribui cada aba para sua área (equipe, clientes,
   * empréstimos, parcelas, pagamentos, movimentações). Nada é apagado: registros com o
   * mesmo ID são atualizados, os novos são incluídos.
   */
  async restore(actor: AuthUser, buffer: Buffer, fileName: string, dryRun: boolean): Promise<RestoreReport> {
    let parsed;
    try {
      parsed = fileName.toLowerCase().endsWith('.csv') ? parseCsv(buffer.toString('utf8')) : await parseWorkbook(buffer);
    } catch {
      throw new BadRequestException('Arquivo não é uma planilha .xlsx ou .csv válida');
    }
    const { data } = parsed;
    const errors = [...parsed.errors];
    const warnings: string[] = [];
    const counts: RestoreReport['counts'] = {};
    for (const k of Object.keys(data)) counts[k] = { created: 0, updated: 0, skipped: 0 };

    // Validação linha a linha antes de gravar
    const userIds = new Set(data.equipe.map((u) => String(u.id)));
    const clientIds = new Set(data.clientes.map((c) => String(c.id)));
    const loanIds = new Set(data.emprestimos.map((l) => String(l.id)));
    for (const c of data.clientes) {
      if (!c.name || !c.cpf) errors.push(`Clientes linha ${c._row}: Nome e CPF obrigatórios`);
      else if (!isValidCpf(String(c.cpf))) warnings.push(`Clientes linha ${c._row}: CPF ${c.cpf} inválido`);
      if (!c.id) c.id = randomUUID();
    }
    for (const l of data.emprestimos) {
      if (!l.id) l.id = randomUUID();
      if (!l.clientId) errors.push(`Emprestimos linha ${l._row}: Cliente ID obrigatório`);
      if (!(Number(l.principal) > 0)) errors.push(`Emprestimos linha ${l._row}: Valor inválido`);
      if (!['DIARIO', 'SEMANAL', 'QUINZENAL', 'MENSAL'].includes(String(l.method))) errors.push(`Emprestimos linha ${l._row}: Método inválido`);
    }
    for (const p of data.parcelas) {
      if (!p.id) p.id = randomUUID();
      if (!p.loanId || !p.dueDate || p.amount == null) errors.push(`Parcelas linha ${p._row}: Empréstimo ID, Vencimento e Valor obrigatórios`);
    }
    if (errors.length || dryRun) {
      return { dryRun, ok: !errors.length, errors, warnings, counts: this.preview(data, counts) };
    }

    await this.prisma.$transaction(async (tx) => {
      // 1. Equipe
      for (const u of data.equipe) {
        if (!u.id || !u.email) { counts.equipe.skipped++; continue; }
        const exists = await tx.user.findFirst({ where: { OR: [{ id: String(u.id) }, { email: String(u.email).toLowerCase() }] } });
        const base = { name: String(u.name ?? u.email), role: (s(u.role) ?? 'FUNCIONARIO') as any, capitalDisponivel: dec(n(u.capitalDisponivel) ?? 0), capitalEmprestado: dec(n(u.capitalEmprestado) ?? 0), comissaoAcumulada: dec(n(u.comissaoAcumulada) ?? 0), saldoARepassar: dec(n(u.saldoARepassar) ?? 0), commissionRate: n(u.commissionRate) ?? 0.3, active: s(u.active) !== 'NAO' };
        if (exists) {
          if (exists.id !== String(u.id)) userIds.add(exists.id);
          await tx.user.update({ where: { id: exists.id }, data: base });
          counts.equipe.updated++;
        } else {
          await tx.user.create({ data: { ...base, id: String(u.id), email: String(u.email).toLowerCase(), password: await bcrypt.hash(randomBytes(12).toString('hex'), 10) } });
          counts.equipe.created++;
          warnings.push(`Usuário ${u.email} criado com senha aleatória — redefina pelo painel`);
        }
      }
      for (const u of data.equipe) if (u.ownerId && u.id) await tx.user.update({ where: { id: String(u.id) }, data: { ownerId: String(u.ownerId) } }).catch(() => undefined);

      // 2. Clientes (vínculos fiador/indicação depois)
      for (const c of data.clientes) {
        const fields = {
          name: String(c.name), rg: s(c.rg), birthDate: d(c.birthDate), maritalStatus: s(c.maritalStatus), profession: s(c.profession),
          phone: s(c.phone), whatsapp: s(c.whatsapp), email: s(c.email), cep: s(c.cep), street: s(c.street), number: s(c.number),
          complement: s(c.complement), district: s(c.district), city: s(c.city), state: s(c.state), pixKey: s(c.pixKey), bank: s(c.bank),
          creditLimit: dec(n(c.creditLimit) ?? 1000), interestRate: n(c.interestRate) ?? 0.1,
          emergencyName: s(c.emergencyName), emergencyPhone: s(c.emergencyPhone), blocked: s(c.blocked) === 'SIM',
        };
        const exists = await tx.client.findFirst({ where: { OR: [{ id: String(c.id) }, { cpf: String(c.cpf) }] } });
        if (exists) {
          if (exists.id !== c.id) {
            warnings.push(`Cliente CPF ${c.cpf} já existia com outro ID — dados mesclados no cadastro existente`);
            remap(data, String(c.id), exists.id);
            c.id = exists.id;
          }
          await tx.client.update({ where: { id: exists.id }, data: fields });
          counts.clientes.updated++;
        } else {
          await tx.client.create({ data: { ...fields, id: String(c.id), cpf: String(c.cpf) } });
          counts.clientes.created++;
        }
        clientIds.add(String(c.id));
      }
      for (const c of data.clientes) {
        const link: Prisma.ClientUncheckedUpdateInput = {};
        if (c.guarantorId && c.guarantorId !== c.id) link.guarantorId = String(c.guarantorId);
        if (c.referredById && c.referredById !== c.id) link.referredById = String(c.referredById);
        if (Object.keys(link).length) await tx.client.update({ where: { id: String(c.id) }, data: link }).catch(() => warnings.push(`Vínculo do cliente ${c.name} ignorado (ID inexistente)`));
      }

      // 3. Empréstimos
      for (const l of data.emprestimos) {
        const funder = s(l.funderUserId) ?? actor.id;
        const lender = s(l.lenderUserId) ?? funder;
        if (!(await tx.client.findUnique({ where: { id: String(l.clientId) } }))) {
          counts.emprestimos.skipped++;
          warnings.push(`Empréstimo linha ${l._row} ignorado: cliente ${l.clientId} não existe`);
          continue;
        }
        const fields = {
          clientId: String(l.clientId),
          funderUserId: (await tx.user.findUnique({ where: { id: funder } })) ? funder : actor.id,
          lenderUserId: (await tx.user.findUnique({ where: { id: lender } })) ? lender : actor.id,
          principal: dec(Number(l.principal)), interestRate: Number(l.interestRate ?? 0), method: l.method as any,
          installmentsCount: Number(l.installmentsCount ?? 1), installmentAmount: dec(Number(l.principal) / Number(l.installmentsCount ?? 1)),
          lateFeeDailyRate: Number(l.lateFeeDailyRate ?? 0.01), startDate: d(l.startDate) ?? new Date(), firstDueDate: d(l.firstDueDate) ?? new Date(),
          status: (s(l.status) ?? 'ATIVO') as any,
        };
        const exists = await tx.loan.findUnique({ where: { id: String(l.id) } });
        if (exists) { await tx.loan.update({ where: { id: exists.id }, data: fields }); counts.emprestimos.updated++; }
        else { await tx.loan.create({ data: { ...fields, id: String(l.id) } }); counts.emprestimos.created++; }
        loanIds.add(String(l.id));
      }

      // 4. Parcelas
      for (const p of data.parcelas) {
        if (!(await tx.loan.findUnique({ where: { id: String(p.loanId) } }))) { counts.parcelas.skipped++; continue; }
        const fields = {
          dueDate: d(p.dueDate)!, amount: dec(Number(p.amount)), interestPart: dec(Number(p.interestPart ?? 0)), principalPart: dec(Number(p.principalPart ?? p.amount)),
          status: (s(p.status) ?? 'PENDENTE') as any, paidAt: d(p.paidAt), paidAmount: n(p.paidAmount) == null ? null : dec(Number(p.paidAmount)),
        };
        const exists = await tx.installment.findFirst({ where: { OR: [{ id: String(p.id) }, { loanId: String(p.loanId), number: Number(p.number) }] } });
        if (exists) { await tx.installment.update({ where: { id: exists.id }, data: fields }); counts.parcelas.updated++; }
        else { await tx.installment.create({ data: { ...fields, id: String(p.id), loanId: String(p.loanId), number: Number(p.number) } }); counts.parcelas.created++; }
      }

      // 5. Pagamentos
      for (const p of data.pagamentos) {
        if (!p.id || !(await tx.loan.findUnique({ where: { id: String(p.loanId) } }))) { counts.pagamentos.skipped++; continue; }
        const createdById = (await tx.user.findUnique({ where: { id: String(p.createdById) } })) ? String(p.createdById) : actor.id;
        const fields = {
          loanId: String(p.loanId), installmentId: s(p.installmentId), type: p.type as any, amount: dec(Number(p.amount)), lateFee: dec(Number(p.lateFee ?? 0)),
          status: (s(p.status) ?? 'APROVADO') as any, createdById, approvedById: s(p.approvedById), paidAt: d(p.paidAt) ?? new Date(), method: s(p.method), notes: s(p.notes),
        };
        if (fields.approvedById && !(await tx.user.findUnique({ where: { id: fields.approvedById } }))) fields.approvedById = null;
        if (fields.installmentId && !(await tx.installment.findUnique({ where: { id: fields.installmentId } }))) fields.installmentId = null;
        const exists = await tx.payment.findUnique({ where: { id: String(p.id) } });
        if (exists) { await tx.payment.update({ where: { id: exists.id }, data: fields }); counts.pagamentos.updated++; }
        else { await tx.payment.create({ data: { ...fields, id: String(p.id) } }); counts.pagamentos.created++; }
      }

      // 6. Movimentações — só inclui as que ainda não existem (histórico nunca é sobrescrito)
      for (const m of data.movimentacoes) {
        if (!m.id || !m.userId || !(await tx.user.findUnique({ where: { id: String(m.userId) } }))) { counts.movimentacoes.skipped++; continue; }
        if (m.source === 'TRANSFER') {
          if (await tx.capitalTransfer.findUnique({ where: { id: String(m.id) } })) { counts.movimentacoes.skipped++; continue; }
          if (!m.toUserId || !(await tx.user.findUnique({ where: { id: String(m.toUserId) } }))) { counts.movimentacoes.skipped++; continue; }
          await tx.capitalTransfer.create({ data: { id: String(m.id), type: m.type as any, fromUserId: String(m.userId), toUserId: String(m.toUserId), amount: dec(Number(m.amount)), notes: s(m.description), createdAt: d(m.createdAt) ?? new Date() } });
        } else {
          if (await tx.cashLedger.findUnique({ where: { id: String(m.id) } })) { counts.movimentacoes.skipped++; continue; }
          await tx.cashLedger.create({ data: { id: String(m.id), userId: String(m.userId), type: m.type as any, amount: dec(Number(m.amount)), balanceAfter: dec(Number(m.balanceAfter ?? 0)), loanId: s(m.loanId), description: s(m.description), createdAt: d(m.createdAt) ?? new Date() } });
        }
        counts.movimentacoes.created++;
      }
    }, { timeout: 120_000 });

    for (const c of data.clientes) await this.score.recalc(String(c.id)).catch(() => undefined);
    await this.prisma.backupLog.create({ data: { kind: 'RESTAURACAO', status: 'SUCESSO', fileName, sizeBytes: buffer.length, rowsCount: Object.values(counts).reduce((a, c) => a + c.created + c.updated, 0) } });
    return { dryRun: false, ok: true, errors, warnings, counts };
  }

  private preview(data: BackupData, counts: RestoreReport['counts']) {
    for (const [k, rows] of Object.entries(data)) counts[k] = { created: rows.length, updated: 0, skipped: 0 };
    return counts;
  }
}

/** Gera CPF válido (dígitos verificadores) a partir de 9 dígitos — usado só nos dados de teste. */
export function makeCpf(base9: string) {
  const dv = (digits: string) => {
    let sum = 0;
    for (let i = 0; i < digits.length; i++) sum += Number(digits[i]) * (digits.length + 1 - i);
    const r = (sum * 10) % 11;
    return r === 10 ? 0 : r;
  };
  const d1 = dv(base9);
  const d2 = dv(base9 + d1);
  const x = base9 + d1 + d2;
  return `${x.slice(0, 3)}.${x.slice(3, 6)}.${x.slice(6, 9)}-${x.slice(9)}`;
}

function remap(data: BackupData, from: string, to: string) {
  for (const rows of Object.values(data)) for (const r of rows) for (const k of ['clientId', 'guarantorId', 'referredById']) if (r[k] === from) r[k] = to;
}

@Controller('backup')
@Roles('DONO')
export class BackupController {
  constructor(private svc: BackupService) {}

  @Get()
  history() {
    return this.svc.history();
  }

  @Post()
  generate() {
    return this.svc.generate('MANUAL');
  }

  @Get('template')
  async template(@Res() res: Response) {
    const buf = await this.svc.template();
    res.setHeader('Content-Type', MIME);
    res.setHeader('Content-Disposition', 'attachment; filename="lendcontrol-modelo-500-linhas.xlsx"');
    res.send(buf);
  }

  /** Ctrl+E: baixa na hora a planilha completa (7 abas) com os dados atuais. */
  @Get('export')
  async exportNow(@Res() res: Response) {
    const wb = await buildWorkbook(await this.svc.collect());
    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', MIME);
    res.setHeader('Content-Disposition', `attachment; filename="lendcontrol-${stamp}.xlsx"`);
    res.send(Buffer.from(await wb.xlsx.writeBuffer()));
  }

  /** CSV leve de uma aba (clientes, emprestimos, parcelas, pagamentos, equipe, movimentacoes). */
  @Get('export/:sheet.csv')
  async exportCsv(@Param('sheet') sheet: string, @Res() res: Response) {
    if (!(sheet in SHEETS) || sheet === 'calculadora') throw new BadRequestException('Aba inválida');
    const data = await this.svc.collect();
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="lendcontrol-${sheet}.csv"`);
    res.send(toCsv(sheet as SheetKey, data[sheet as SheetKey]));
  }

  @Get('files/:name')
  async download(@Param('name') name: string, @Res() res: Response) {
    const buf = await this.svc.file(name);
    res.setHeader('Content-Type', MIME);
    res.setHeader('Content-Disposition', `attachment; filename="${basename(name)}"`);
    res.send(buf);
  }

  /** Arraste a planilha no painel. ?dryRun=true só valida e mostra o que seria importado. */
  @Post('restore')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 30 * 1024 * 1024 } }))
  restore(@CurrentUser() u: AuthUser, @UploadedFile() file: Express.Multer.File, @Query('dryRun') dryRun?: string) {
    if (!file) throw new BadRequestException('Envie o arquivo .xlsx');
    return this.svc.restore(u, file.buffer, file.originalname, dryRun === 'true');
  }
}

@Module({ imports: [ClientsModule], providers: [BackupService], controllers: [BackupController] })
export class BackupModule {}
