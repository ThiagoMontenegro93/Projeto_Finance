import {
  BadRequestException, Body, Controller, ForbiddenException, Get, Injectable, Module,
  NotFoundException, Param, Patch, Post, Query,
} from '@nestjs/common';
import { LedgerType, Prisma, Role, TransferType } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { IsEmail, IsEnum, IsNumber, IsOptional, IsPositive, IsString, Max, Min, MinLength } from 'class-validator';
import { AuthUser, CurrentUser, Roles } from '../common/auth';
import { dec, num } from '../common/money';
import { PrismaService } from '../prisma/prisma.service';

type Tx = Prisma.TransactionClient;

/**
 * Carteira independente (revolving) por usuário.
 *  capitalDisponivel  dinheiro de capital pronto para emprestar
 *  capitalEmprestado  capital que está na rua
 *  comissaoAcumulada  30% dos juros/multas recebidos pelo funcionário
 *  saldoARepassar     parte do Dono (70% dos juros) que o funcionário recebeu e deve repassar
 */
@Injectable()
export class WalletService {
  constructor(private prisma: PrismaService) {}

  /** Lança no CashLedger e move o capital disponível do usuário. */
  async ledger(
    tx: Tx,
    userId: string,
    type: LedgerType,
    amount: number,
    refs: { loanId?: string; paymentId?: string; transferId?: string; description?: string } = {},
    extra: Prisma.UserUpdateInput = {},
  ) {
    const user = await tx.user.update({
      where: { id: userId },
      data: { capitalDisponivel: { increment: dec(amount) }, ...extra },
    });
    await tx.cashLedger.create({
      data: { userId, type, amount: dec(amount), balanceAfter: user.capitalDisponivel, ...refs },
    });
    return user;
  }

  async transfer(actor: AuthUser, type: TransferType, otherUserId: string, amount: number, notes?: string) {
    if (amount <= 0) throw new BadRequestException('Valor deve ser positivo');
    return this.prisma.$transaction(async (tx) => {
      const other = await tx.user.findUnique({ where: { id: otherUserId } });
      if (!other) throw new NotFoundException('Usuário não encontrado');

      let fromId: string;
      let toId: string;
      if (type === 'REPASSE_CAPITAL') {
        // Dono -> Funcionário (ex.: R$10.000 para emprestar)
        if (actor.role === 'FUNCIONARIO') throw new ForbiddenException('Somente o Dono repassa capital');
        fromId = actor.id;
        toId = other.id;
      } else {
        // Funcionário -> Dono
        fromId = actor.id;
        toId = other.id;
        const me = await tx.user.findUniqueOrThrow({ where: { id: actor.id } });
        if (me.ownerId !== other.id && actor.role !== 'SUPER_ADMIN') {
          throw new ForbiddenException('Repasse só para o seu Dono');
        }
      }
      const from = await tx.user.findUniqueOrThrow({ where: { id: fromId } });

      const t = await tx.capitalTransfer.create({
        data: { type, fromUserId: fromId, toUserId: toId, amount: dec(amount), notes },
      });

      if (type === 'REPASSE_RECEBIMENTO') {
        if (num(from.saldoARepassar) < amount) throw new BadRequestException('Valor maior que o saldo a repassar');
        await tx.user.update({ where: { id: fromId }, data: { saldoARepassar: { decrement: dec(amount) } } });
        await tx.cashLedger.create({
          data: { userId: fromId, type: 'REPASSE_RECEBIMENTO_SAIDA', amount: dec(-amount), balanceAfter: from.capitalDisponivel, transferId: t.id, description: notes },
        });
        await this.ledger(tx, toId, 'REPASSE_RECEBIMENTO_ENTRADA', amount, { transferId: t.id, description: `Repasse de ${from.name}` });
      } else {
        if (num(from.capitalDisponivel) < amount) throw new BadRequestException('Capital disponível insuficiente');
        await this.ledger(tx, fromId, 'REPASSE_CAPITAL_SAIDA', -amount, { transferId: t.id, description: notes });
        await this.ledger(tx, toId, 'REPASSE_CAPITAL_ENTRADA', amount, { transferId: t.id, description: notes });
      }
      return t;
    });
  }
}

class CreateMemberDto {
  @IsString() @MinLength(2) name: string;
  @IsEmail() email: string;
  @IsString() @MinLength(6) password: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsEnum(Role) role?: Role;
  @IsOptional() @IsNumber() @Min(0) @Max(1) commissionRate?: number;
}

class TransferDto {
  @IsEnum(TransferType) type: TransferType;
  @IsString() userId: string;
  @IsNumber() @IsPositive() amount: number;
  @IsOptional() @IsString() notes?: string;
}

class DepositDto {
  @IsNumber() amount: number;
  @IsOptional() @IsString() description?: string;
}

const publicUser = { id: true, name: true, email: true, phone: true, role: true, active: true, ownerId: true, capitalDisponivel: true, capitalEmprestado: true, comissaoAcumulada: true, saldoARepassar: true, commissionRate: true, createdAt: true } as const;

@Controller('team')
export class TeamController {
  constructor(private prisma: PrismaService, private wallet: WalletService) {}

  @Get()
  async list(@CurrentUser() u: AuthUser) {
    const where = u.role === 'SUPER_ADMIN' ? {} : u.role === 'DONO' ? { OR: [{ id: u.id }, { ownerId: u.id }] } : { id: u.id };
    return this.prisma.user.findMany({ where, select: publicUser, orderBy: { name: 'asc' } });
  }

  @Post()
  @Roles('DONO')
  async create(@CurrentUser() u: AuthUser, @Body() dto: CreateMemberDto) {
    if (dto.role && dto.role !== 'FUNCIONARIO' && u.role !== 'SUPER_ADMIN') throw new ForbiddenException('Dono só cria funcionários');
    return this.prisma.user.create({
      data: {
        name: dto.name,
        email: dto.email.toLowerCase(),
        phone: dto.phone,
        password: await bcrypt.hash(dto.password, 10),
        role: dto.role ?? 'FUNCIONARIO',
        ownerId: (dto.role ?? 'FUNCIONARIO') === 'FUNCIONARIO' ? u.id : null,
        commissionRate: dto.commissionRate ?? 0.3,
      },
      select: publicUser,
    });
  }

  @Patch(':id/active')
  @Roles('DONO')
  async toggle(@Param('id') id: string, @Body() body: { active: boolean }) {
    return this.prisma.user.update({ where: { id }, data: { active: !!body.active }, select: publicUser });
  }
}

@Controller('wallet')
export class WalletController {
  constructor(private prisma: PrismaService, private wallet: WalletService) {}

  @Get()
  me(@CurrentUser() u: AuthUser) {
    return this.prisma.user.findUniqueOrThrow({ where: { id: u.id }, select: publicUser });
  }

  /** Aporte/retirada de capital próprio do Dono. */
  @Post('deposit')
  @Roles('DONO')
  deposit(@CurrentUser() u: AuthUser, @Body() dto: DepositDto) {
    return this.prisma.$transaction((tx) =>
      this.wallet.ledger(tx, u.id, dto.amount >= 0 ? 'APORTE' : 'AJUSTE', dto.amount, { description: dto.description }),
    );
  }

  @Post('transfers')
  transfer(@CurrentUser() u: AuthUser, @Body() dto: TransferDto) {
    return this.wallet.transfer(u, dto.type, dto.userId, dto.amount, dto.notes);
  }

  @Get('transfers')
  transfers(@CurrentUser() u: AuthUser) {
    const where = u.role === 'SUPER_ADMIN' ? {} : { OR: [{ fromUserId: u.id }, { toUserId: u.id }] };
    return this.prisma.capitalTransfer.findMany({
      where, orderBy: { createdAt: 'desc' }, take: 200,
      include: { fromUser: { select: { name: true } }, toUser: { select: { name: true } } },
    });
  }

  @Get('ledger')
  ledgerList(@CurrentUser() u: AuthUser, @Query('userId') userId?: string) {
    const target = userId && u.role !== 'FUNCIONARIO' ? userId : u.id;
    return this.prisma.cashLedger.findMany({ where: { userId: target }, orderBy: { createdAt: 'desc' }, take: 500 });
  }
}

@Module({ providers: [WalletService], controllers: [TeamController, WalletController], exports: [WalletService] })
export class WalletModule {}
