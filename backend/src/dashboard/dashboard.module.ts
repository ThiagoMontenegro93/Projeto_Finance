import { Controller, Get, Module } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuthUser, CurrentUser } from '../common/auth';
import { num } from '../common/money';
import { currentValue, daysLate, round2, toDay } from '../loan-engine/loan-engine';
import { PrismaService } from '../prisma/prisma.service';

@Controller('dashboard')
export class DashboardController {
  constructor(private prisma: PrismaService) {}

  /** 4 cards: Capital disponível, Capital na rua, Recebido no mês, Em atraso — + listas de apoio. */
  @Get()
  async get(@CurrentUser() u: AuthUser) {
    const userWhere: Prisma.UserWhereInput =
      u.role === 'SUPER_ADMIN' ? {} : u.role === 'DONO' ? { OR: [{ id: u.id }, { ownerId: u.id }] } : { id: u.id };
    const loanWhere: Prisma.LoanWhereInput =
      u.role === 'SUPER_ADMIN' ? {} : u.role === 'DONO' ? { funderUserId: u.id } : { lenderUserId: u.id };

    const users = await this.prisma.user.findMany({ where: userWhere });
    const capitalDisponivel = round2(users.reduce((s, x) => s + num(x.capitalDisponivel), 0));
    const capitalEmprestado = round2(users.reduce((s, x) => s + num(x.capitalEmprestado), 0));
    const saldoARepassar = round2(users.reduce((s, x) => s + num(x.saldoARepassar), 0));

    const today = toDay(new Date());
    const monthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
    const paid = await this.prisma.payment.aggregate({
      where: { status: 'APROVADO', paidAt: { gte: monthStart }, loan: loanWhere },
      _sum: { amount: true },
      _count: true,
    });

    const overdue = await this.prisma.installment.findMany({
      where: { status: 'PENDENTE', dueDate: { lt: today }, loan: { ...loanWhere, status: 'ATIVO' } },
      include: { loan: { select: { id: true, code: true, lateFeeDailyRate: true, client: { select: { id: true, name: true, scoreStatus: true, whatsapp: true, phone: true } } } } },
      orderBy: { dueDate: 'asc' },
    });
    const overdueRows = overdue.map((i) => {
      const days = daysLate(i.dueDate, today);
      return { id: i.id, loanId: i.loan.id, code: i.loan.code, client: i.loan.client, number: i.number, dueDate: i.dueDate, amount: num(i.amount), daysLate: days, currentValue: currentValue(num(i.amount), num(i.loan.lateFeeDailyRate), days) };
    });

    const dueToday = await this.prisma.installment.findMany({
      where: { status: 'PENDENTE', dueDate: { gte: today, lt: new Date(today.getTime() + 86_400_000) }, loan: loanWhere },
      include: { loan: { select: { id: true, code: true, client: { select: { name: true } } } } },
    });
    const byStatus = await this.prisma.client.groupBy({ by: ['scoreStatus'], _count: true });
    const pendingApprovals = await this.prisma.payment.count({ where: { status: 'AGUARDANDO_APROVACAO', loan: loanWhere } });

    return {
      cards: {
        capitalDisponivel,
        capitalEmprestado,
        recebidoMes: round2(num(paid._sum.amount)),
        pagamentosMes: paid._count,
        emAtraso: round2(overdueRows.reduce((s, r) => s + r.currentValue, 0)),
        parcelasEmAtraso: overdueRows.length,
      },
      saldoARepassar,
      pendingApprovals,
      overdue: overdueRows.slice(0, 50),
      dueToday,
      scoreDistribution: Object.fromEntries(byStatus.map((b) => [b.scoreStatus, b._count])),
    };
  }
}

@Module({ controllers: [DashboardController] })
export class DashboardModule {}
