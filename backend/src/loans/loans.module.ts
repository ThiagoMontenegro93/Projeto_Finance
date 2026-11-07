import {
  BadRequestException, Body, Controller, ForbiddenException, Get, Injectable, Module,
  NotFoundException, Param, Post, Query,
} from '@nestjs/common';
import { Loan, LoanMethod, PaymentType, Prisma } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { Type } from 'class-transformer';
import {
  IsBoolean, IsDateString, IsEnum, IsInt, IsNumber, IsOptional, IsPositive, IsString, Max, Min,
} from 'class-validator';
import { ClientsModule, ScoreService } from '../clients/clients.module';
import { AuthUser, CurrentUser, Roles } from '../common/auth';
import { dec, num } from '../common/money';
import {
  buildSchedule, currentValue, daysLate, payoffAmount, projectDueDates, rollInterestOnly, round2,
  simulate, splitInterest,
} from '../loan-engine/loan-engine';
import { PrismaService } from '../prisma/prisma.service';
import { SCORE_META } from '../score/score-engine';
import { WalletModule, WalletService } from '../wallet/wallet.module';

type Tx = Prisma.TransactionClient;

class SimulateDto {
  @IsNumber() @IsPositive() principal: number;
  @IsNumber() @Min(0) @Max(5) rate: number;
  @IsInt() @Min(1) @Max(360) installments: number;
  @IsEnum(LoanMethod) method: LoanMethod;
  @IsDateString() firstDueDate: string;
}

class CreateLoanDto extends SimulateDto {
  @IsString() clientId: string;
  @IsOptional() @IsNumber() @Min(0) @Max(1) lateFeeDailyRate?: number;
  @IsOptional() @IsString() lenderUserId?: string;
  @IsOptional() @IsDateString() startDate?: string;
  @IsOptional() @IsBoolean() overrideLimit?: boolean;
}

class PaymentDto {
  @IsEnum(PaymentType) type: PaymentType;
  @IsOptional() @IsString() installmentId?: string;
  @IsOptional() @IsString() method?: string;
  @IsOptional() @IsString() notes?: string;
  @IsOptional() @IsString() receiptDocumentId?: string;
  @IsOptional() @Type(() => Date) paidAt?: Date;
}

class ApproveDto {
  @IsOptional() @IsBoolean() biometricVerified?: boolean;
  @IsOptional() @IsString() password?: string;
}
class RejectDto {
  @IsString() reason: string;
}

@Injectable()
export class LoansService {
  constructor(private prisma: PrismaService, private wallet: WalletService, private score: ScoreService) {}

  async create(u: AuthUser, dto: CreateLoanDto) {
    const loan = await this.createTx(u, dto);
    await this.score.recalc(loan.clientId); // vencimentos já passados contam no score na hora
    return loan;
  }

  private async createTx(u: AuthUser, dto: CreateLoanDto) {
    return this.prisma.$transaction(async (tx) => {
      const client = await tx.client.findUnique({ where: { id: dto.clientId } });
      if (!client) throw new NotFoundException('Cliente não encontrado');
      const meta = SCORE_META[client.scoreStatus];
      if (client.blocked || !meta.canLend) {
        throw new ForbiddenException('💀 Cliente PERDA/bloqueado: NÃO EMPRESTAR. Somente o Super Admin desbloqueia.');
      }
      const overLimit = dto.principal > num(client.creditLimit);
      if ((overLimit || meta.needsApproval) && !(dto.overrideLimit && u.role !== 'FUNCIONARIO')) {
        throw new ForbiddenException(
          overLimit
            ? `Valor acima da margem do cliente (${num(client.creditLimit).toFixed(2)}). Peça ao Dono para liberar.`
            : '⚠️ Cliente RUIM: novo empréstimo precisa de liberação do Dono.',
        );
      }

      const lenderId = dto.lenderUserId && u.role !== 'FUNCIONARIO' ? dto.lenderUserId : u.id;
      const lender = await tx.user.findUniqueOrThrow({ where: { id: lenderId } });
      if (num(lender.capitalDisponivel) < dto.principal) {
        throw new BadRequestException(`Capital disponível insuficiente (${num(lender.capitalDisponivel).toFixed(2)})`);
      }
      const schedule = buildSchedule({
        principal: dto.principal, rate: dto.rate, installments: dto.installments,
        method: dto.method, firstDueDate: new Date(dto.firstDueDate),
      });
      const loan = await tx.loan.create({
        data: {
          clientId: client.id,
          funderUserId: lender.ownerId ?? lender.id,
          lenderUserId: lender.id,
          principal: dec(dto.principal),
          interestRate: dto.rate,
          method: dto.method,
          installmentsCount: dto.installments,
          installmentAmount: dec(schedule[0].amount),
          lateFeeDailyRate: dto.lateFeeDailyRate ?? 0.01,
          startDate: dto.startDate ? new Date(dto.startDate) : new Date(),
          firstDueDate: new Date(dto.firstDueDate),
          installments: {
            create: schedule.map((s) => ({
              number: s.number, dueDate: s.dueDate, amount: dec(s.amount),
              interestPart: dec(s.interestPart), principalPart: dec(s.principalPart),
            })),
          },
        },
        include: { installments: true },
      });
      await this.wallet.ledger(tx, lender.id, 'EMPRESTIMO_SAIDA', -dto.principal,
        { loanId: loan.id, description: `Empréstimo #${loan.code} para ${client.name}` },
        { capitalEmprestado: { increment: dec(dto.principal) } });
      return loan;
    });
  }

  /** Detalhe com valor atualizado (multa diária) e projeção das 3 próximas datas. */
  async detail(id: string, today = new Date()) {
    const loan = await this.prisma.loan.findUnique({
      where: { id },
      include: {
        client: { select: { id: true, name: true, cpf: true, phone: true, whatsapp: true, pixKey: true, scoreStatus: true } },
        lender: { select: { id: true, name: true } },
        funder: { select: { id: true, name: true } },
        installments: { orderBy: { number: 'asc' } },
        payments: { orderBy: { createdAt: 'desc' }, include: { createdBy: { select: { name: true } }, approvedBy: { select: { name: true } } } },
      },
    });
    if (!loan) throw new NotFoundException('Empréstimo não encontrado');
    const rate = num(loan.lateFeeDailyRate);
    const installments = loan.installments.map((i) => {
      const open = i.status === 'PENDENTE';
      const days = open ? daysLate(i.dueDate, today) : 0;
      return { ...i, daysLate: days, currentValue: open ? currentValue(num(i.amount), rate, days) : num(i.amount) };
    });
    const open = loan.installments.filter((i) => i.status === 'PENDENTE');
    const last = loan.installments.filter((i) => i.status !== 'CANCELADO').at(-1);
    return {
      ...loan,
      installments,
      payoff: loan.status === 'ATIVO' ? payoffAmount(open.map(this.toOpen), rate, today) : null,
      projection: last && loan.status === 'ATIVO' ? projectDueDates(last.dueDate, loan.method, 3) : [],
    };
  }

  private toOpen = (i: { number: number; dueDate: Date; amount: unknown; interestPart: unknown; principalPart: unknown }) => ({
    number: i.number, dueDate: i.dueDate, amount: num(i.amount as any), interestPart: num(i.interestPart as any), principalPart: num(i.principalPart as any),
  });

  /** Registra pagamento. PARCELA aplica na hora; JUROS e QUITACAO ficam AGUARDANDO_APROVACAO (Approval Lock). */
  async pay(u: AuthUser, loanId: string, dto: PaymentDto) {
    const loan = await this.detail(loanId);
    if (loan.status !== 'ATIVO') throw new BadRequestException('Empréstimo não está ativo');
    if (u.role === 'FUNCIONARIO' && loan.lenderUserId !== u.id) throw new ForbiddenException('Empréstimo de outro operador');

    const pending = await this.prisma.payment.count({ where: { loanId, status: 'AGUARDANDO_APROVACAO' } });
    if (pending && dto.type !== 'PARCELA') throw new BadRequestException('Já existe um pagamento aguardando aprovação neste empréstimo');

    let amount: number;
    let lateFee = 0;
    let installmentId: string | undefined = dto.installmentId;
    if (dto.type === 'QUITACAO') {
      amount = loan.payoff!.total;
      lateFee = loan.payoff!.lateFees;
      installmentId = undefined;
    } else {
      const inst = installmentId
        ? loan.installments.find((i) => i.id === installmentId)
        : loan.installments.find((i) => i.status === 'PENDENTE');
      if (!inst || inst.status !== 'PENDENTE') throw new BadRequestException('Parcela não está em aberto');
      installmentId = inst.id;
      lateFee = round2(inst.currentValue - num(inst.amount));
      amount = dto.type === 'JUROS' ? round2(num(inst.interestPart) + lateFee) : inst.currentValue;
    }

    const needsApproval = dto.type !== 'PARCELA';
    return this.prisma.$transaction(async (tx) => {
      const payment = await tx.payment.create({
        data: {
          loanId, installmentId, type: dto.type, amount: dec(amount), lateFee: dec(lateFee),
          status: needsApproval ? 'AGUARDANDO_APROVACAO' : 'APROVADO',
          method: dto.method, notes: dto.notes, receiptDocumentId: dto.receiptDocumentId,
          createdById: u.id, paidAt: dto.paidAt ?? new Date(),
        },
      });
      if (!needsApproval) await this.apply(tx, payment.id);
      return tx.payment.findUniqueOrThrow({ where: { id: payment.id } });
    });
  }

  async approve(u: AuthUser, paymentId: string, dto: ApproveDto) {
    const p = await this.prisma.payment.findUnique({ where: { id: paymentId } });
    if (!p) throw new NotFoundException('Pagamento não encontrado');
    if (p.status !== 'AGUARDANDO_APROVACAO') throw new BadRequestException('Pagamento não está aguardando aprovação');
    if (p.createdById === u.id) throw new ForbiddenException('Operador não pode aprovar o próprio lançamento');
    if (!dto.biometricVerified) {
      const me = await this.prisma.user.findUniqueOrThrow({ where: { id: u.id } });
      if (!dto.password || !(await bcrypt.compare(dto.password, me.password))) {
        throw new ForbiddenException('Confirme com biometria ou senha para aprovar');
      }
    }
    return this.prisma.$transaction(async (tx) => {
      await tx.payment.update({
        where: { id: paymentId },
        data: { status: 'APROVADO', approvedById: u.id, approvedAt: new Date(), biometricVerified: !!dto.biometricVerified },
      });
      await this.apply(tx, paymentId);
      return tx.payment.findUniqueOrThrow({ where: { id: paymentId } });
    });
  }

  async reject(u: AuthUser, paymentId: string, reason: string) {
    const p = await this.prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
    if (p.status !== 'AGUARDANDO_APROVACAO') throw new BadRequestException('Pagamento não está aguardando aprovação');
    return this.prisma.payment.update({
      where: { id: paymentId },
      data: { status: 'REJEITADO', approvedById: u.id, approvedAt: new Date(), rejectionReason: reason },
    });
  }

  /** Efeito do pagamento aprovado nas parcelas e na carteira. */
  private async apply(tx: Tx, paymentId: string) {
    const p = await tx.payment.findUniqueOrThrow({ where: { id: paymentId }, include: { loan: { include: { installments: { orderBy: { number: 'asc' } } } } } });
    const loan = p.loan;
    let principalBack = 0;
    let interest = 0;
    const lateFee = num(p.lateFee);

    if (p.type === 'PARCELA') {
      const inst = loan.installments.find((i) => i.id === p.installmentId)!;
      principalBack = num(inst.principalPart);
      interest = num(inst.interestPart);
      await tx.installment.update({ where: { id: inst.id }, data: { status: 'PAGO', paidAt: p.paidAt, paidAmount: p.amount } });
    } else if (p.type === 'JUROS') {
      // Paga só juros: parcela vira JUROS_PAGO e uma nova idêntica é criada no final
      const inst = loan.installments.find((i) => i.id === p.installmentId)!;
      if (inst.status !== 'PENDENTE') throw new BadRequestException('Parcela já não está em aberto');
      interest = num(inst.interestPart);
      const last = loan.installments.filter((i) => i.status !== 'CANCELADO').at(-1)!;
      const next = rollInterestOnly(this.toOpen(inst), last.dueDate, loan.installments.at(-1)!.number, loan.method);
      await tx.installment.update({ where: { id: inst.id }, data: { status: 'JUROS_PAGO', paidAt: p.paidAt, paidAmount: p.amount } });
      await tx.installment.create({
        data: {
          loanId: loan.id, number: next.number, dueDate: next.dueDate, amount: dec(next.amount),
          interestPart: dec(next.interestPart), principalPart: dec(next.principalPart), rolledFromId: inst.id,
        },
      });
    } else {
      // Quitação total: apaga (cancela) todas as parcelas em aberto
      const open = loan.installments.filter((i) => i.status === 'PENDENTE');
      const q = payoffAmount(open.map(this.toOpen), num(loan.lateFeeDailyRate), p.paidAt);
      principalBack = q.principal;
      interest = q.overdueInterest;
      await tx.installment.updateMany({ where: { loanId: loan.id, status: 'PENDENTE' }, data: { status: 'CANCELADO' } });
    }

    await this.settleWallet(tx, loan, p.id, principalBack, interest, lateFee);

    const stillOpen = await tx.installment.count({ where: { loanId: loan.id, status: 'PENDENTE' } });
    if (!stillOpen) await tx.loan.update({ where: { id: loan.id }, data: { status: 'QUITADO', closedAt: new Date() } });
    await this.score.recalc(loan.clientId, tx);
  }

  /** Cliente paga o Funcionário: principal volta ao capital (revolving), juros+multa: 30% comissão, 70% a repassar ao Dono. */
  private async settleWallet(tx: Tx, loan: Loan, paymentId: string, principal: number, interest: number, lateFee: number) {
    const lender = await tx.user.findUniqueOrThrow({ where: { id: loan.lenderUserId } });
    const refs = { loanId: loan.id, paymentId };
    if (principal > 0) {
      await this.wallet.ledger(tx, lender.id, 'RECEBIMENTO_PRINCIPAL', principal,
        { ...refs, description: `Principal #${loan.code}` }, { capitalEmprestado: { decrement: dec(principal) } });
    }
    const earnings = round2(interest + lateFee);
    if (earnings <= 0) return;
    if (loan.funderUserId === loan.lenderUserId) {
      if (interest > 0) await this.wallet.ledger(tx, lender.id, 'RECEBIMENTO_JUROS', interest, { ...refs, description: `Juros #${loan.code}` });
      if (lateFee > 0) await this.wallet.ledger(tx, lender.id, 'RECEBIMENTO_MULTA', lateFee, { ...refs, description: `Multa #${loan.code}` });
      return;
    }
    const { commission, owner } = splitInterest(earnings, num(lender.commissionRate));
    const u = await tx.user.update({
      where: { id: lender.id },
      data: { comissaoAcumulada: { increment: dec(commission) }, saldoARepassar: { increment: dec(owner) } },
    });
    await tx.cashLedger.create({
      data: { userId: lender.id, type: 'COMISSAO', amount: dec(commission), balanceAfter: u.capitalDisponivel, ...refs, description: `Comissão ${num(lender.commissionRate) * 100}% sobre juros #${loan.code} (a repassar ao Dono: ${owner.toFixed(2)})` },
    });
  }
}

@Controller('loans')
export class LoansController {
  constructor(private loans: LoansService, private prisma: PrismaService) {}

  @Post('simulate')
  simulate(@Body() dto: SimulateDto) {
    return simulate({ principal: dto.principal, rate: dto.rate, installments: dto.installments, method: dto.method, firstDueDate: new Date(dto.firstDueDate) });
  }

  @Get()
  list(@CurrentUser() u: AuthUser, @Query('status') status?: string, @Query('clientId') clientId?: string) {
    const where: Prisma.LoanWhereInput = {};
    if (u.role === 'FUNCIONARIO') where.lenderUserId = u.id;
    else if (u.role === 'DONO') where.funderUserId = u.id;
    if (status) where.status = status as any;
    if (clientId) where.clientId = clientId;
    return this.prisma.loan.findMany({
      where, orderBy: { createdAt: 'desc' },
      include: {
        client: { select: { id: true, name: true, scoreStatus: true } },
        lender: { select: { name: true } },
        installments: { where: { status: 'PENDENTE' }, orderBy: { dueDate: 'asc' }, take: 1 },
      },
    });
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.loans.detail(id);
  }

  @Post()
  create(@CurrentUser() u: AuthUser, @Body() dto: CreateLoanDto) {
    return this.loans.create(u, dto);
  }

  @Post(':id/payments')
  pay(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: PaymentDto) {
    return this.loans.pay(u, id, dto);
  }
}

@Controller('payments')
export class PaymentsController {
  constructor(private loans: LoansService, private prisma: PrismaService) {}

  @Get('pending')
  pending(@CurrentUser() u: AuthUser) {
    const where: Prisma.PaymentWhereInput = { status: 'AGUARDANDO_APROVACAO' };
    if (u.role === 'DONO') where.loan = { funderUserId: u.id };
    if (u.role === 'FUNCIONARIO') where.createdById = u.id;
    return this.prisma.payment.findMany({
      where, orderBy: { createdAt: 'asc' },
      include: { loan: { select: { code: true, client: { select: { name: true } } } }, createdBy: { select: { name: true } }, installment: { select: { number: true, dueDate: true } } },
    });
  }

  @Post(':id/approve')
  @Roles('DONO')
  approve(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: ApproveDto) {
    return this.loans.approve(u, id, dto);
  }

  @Post(':id/reject')
  @Roles('DONO')
  reject(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: RejectDto) {
    return this.loans.reject(u, id, dto.reason);
  }
}

@Module({ imports: [WalletModule, ClientsModule], providers: [LoansService], controllers: [LoansController, PaymentsController], exports: [LoansService] })
export class LoansModule {}
