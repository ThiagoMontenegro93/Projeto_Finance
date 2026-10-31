/**
 * Loan Engine LendControl V6.5 — funções puras (sem banco), usadas pela API,
 * pelo simulador do painel e espelhadas nas fórmulas BANE do Excel.
 */

export type LoanMethod = 'DIARIO' | 'SEMANAL' | 'QUINZENAL' | 'MENSAL';

export const METHOD_LABEL: Record<LoanMethod, string> = {
  DIARIO: 'Diário',
  SEMANAL: 'Semanal',
  QUINZENAL: 'Quinzenal',
  MENSAL: 'Mensal',
};

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Data "pura" (00:00 UTC) para comparar dias sem fuso. */
export function toDay(d: Date | string): Date {
  const x = typeof d === 'string' ? new Date(d) : d;
  return new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate()));
}

/** Equivalente ao EDATE do Excel: soma meses mantendo o dia, limitado ao fim do mês (31/01 -> 28/02). */
export function edate(date: Date, months: number): Date {
  const d = toDay(date);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + months;
  const day = d.getUTCDate();
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(day, lastDay)));
}

export function addDays(date: Date, days: number): Date {
  const d = toDay(date);
  return new Date(d.getTime() + days * 86_400_000);
}

/** Avança n períodos conforme o método (30/10 mensal -> 30/11). */
export function addPeriods(date: Date, method: LoanMethod, n: number): Date {
  switch (method) {
    case 'DIARIO':
      return addDays(date, n);
    case 'SEMANAL':
      return addDays(date, 7 * n);
    case 'QUINZENAL':
      return addDays(date, 15 * n);
    case 'MENSAL':
      return edate(date, n);
  }
}

/** Projeção automática das próximas N datas (padrão 3) a partir de um vencimento. */
export function projectDueDates(lastDueDate: Date, method: LoanMethod, count = 3): Date[] {
  return Array.from({ length: count }, (_, i) => addPeriods(lastDueDate, method, i + 1));
}

/** Parcela pela Tabela Price: PMT = P·i / (1 − (1+i)^−n). */
export function pricePayment(principal: number, rate: number, n: number): number {
  if (n <= 0) throw new Error('Número de parcelas deve ser maior que zero');
  if (rate === 0) return round2(principal / n);
  return round2((principal * rate) / (1 - Math.pow(1 + rate, -n)));
}

export interface ScheduleRow {
  number: number;
  dueDate: Date;
  amount: number;
  interestPart: number;
  principalPart: number;
  balanceAfter: number;
}

export interface LoanInput {
  principal: number;
  rate: number; // por período (0.10 = 10%)
  installments: number;
  method: LoanMethod;
  firstDueDate: Date;
}

/** Cronograma Price completo. A última parcela absorve o arredondamento. */
export function buildSchedule(input: LoanInput): ScheduleRow[] {
  const { principal, rate, installments, method, firstDueDate } = input;
  const pmt = pricePayment(principal, rate, installments);
  const rows: ScheduleRow[] = [];
  let balance = principal;
  for (let k = 1; k <= installments; k++) {
    const interest = round2(balance * rate);
    let principalPart = round2(pmt - interest);
    let amount = pmt;
    if (k === installments) {
      principalPart = round2(balance);
      amount = round2(principalPart + interest);
    }
    balance = round2(balance - principalPart);
    rows.push({
      number: k,
      dueDate: addPeriods(firstDueDate, method, k - 1),
      amount,
      interestPart: interest,
      principalPart,
      balanceAfter: balance,
    });
  }
  return rows;
}

/** Dias de atraso = HOJE() − Vencimento (nunca negativo). */
export function daysLate(dueDate: Date, today: Date = new Date()): number {
  const diff = Math.floor((toDay(today).getTime() - toDay(dueDate).getTime()) / 86_400_000);
  return Math.max(0, diff);
}

/** Multa diária simples: ValorAtual = Parcela × (1 + %multa × dias). */
export function currentValue(amount: number, dailyLateRate: number, days: number): number {
  return round2(amount * (1 + dailyLateRate * Math.max(0, days)));
}

export interface SimulationResult {
  installmentAmount: number;
  totalPaid: number;
  totalInterest: number;
  schedule: ScheduleRow[];
  projection: Date[];
}

export function simulate(input: LoanInput): SimulationResult {
  const schedule = buildSchedule(input);
  const totalPaid = round2(schedule.reduce((s, r) => s + r.amount, 0));
  return {
    installmentAmount: schedule[0]?.amount ?? 0,
    totalPaid,
    totalInterest: round2(totalPaid - input.principal),
    schedule,
    projection: projectDueDates(schedule[schedule.length - 1].dueDate, input.method, 3),
  };
}

// ---------------------------------------------------------------------------
// Regras de pagamento
// ---------------------------------------------------------------------------

export interface OpenInstallment {
  number: number;
  dueDate: Date;
  amount: number;
  interestPart: number;
  principalPart: number;
}

/**
 * Regra "paga só juros": a parcela fica JUROS_PAGO e uma nova parcela idêntica
 * (mesmo valor/composição) é criada no final do cronograma, um período após a última.
 */
export function rollInterestOnly(
  paid: OpenInstallment,
  lastDueDate: Date,
  lastNumber: number,
  method: LoanMethod,
): OpenInstallment {
  return {
    number: lastNumber + 1,
    dueDate: addPeriods(lastDueDate, method, 1),
    amount: paid.amount,
    interestPart: paid.interestPart,
    principalPart: paid.principalPart,
  };
}

/**
 * Valor de quitação total: soma do principal ainda aberto + juros e multa
 * das parcelas já vencidas. Após aprovado, todas as parcelas abertas são apagadas (CANCELADO).
 */
export function payoffAmount(
  open: OpenInstallment[],
  dailyLateRate: number,
  today: Date = new Date(),
): { principal: number; overdueInterest: number; lateFees: number; total: number } {
  let principal = 0;
  let overdueInterest = 0;
  let lateFees = 0;
  for (const i of open) {
    principal += i.principalPart;
    const days = daysLate(i.dueDate, today);
    if (toDay(i.dueDate) <= toDay(today)) {
      overdueInterest += i.interestPart;
      lateFees += currentValue(i.amount, dailyLateRate, days) - i.amount;
    }
  }
  principal = round2(principal);
  overdueInterest = round2(overdueInterest);
  lateFees = round2(lateFees);
  return { principal, overdueInterest, lateFees, total: round2(principal + overdueInterest + lateFees) };
}

/** Comissão do funcionário sobre os juros recebidos (padrão 30%). */
export function splitInterest(interest: number, commissionRate = 0.3) {
  const commission = round2(interest * commissionRate);
  return { commission, owner: round2(interest - commission) };
}
