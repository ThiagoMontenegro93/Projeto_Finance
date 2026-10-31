import {
  addPeriods, buildSchedule, currentValue, daysLate, edate, payoffAmount,
  pricePayment, projectDueDates, rollInterestOnly, simulate, splitInterest,
} from './loan-engine';

const d = (s: string) => new Date(`${s}T00:00:00Z`);
const iso = (x: Date) => x.toISOString().slice(0, 10);

describe('Loan Engine', () => {
  it('Price: R$1000 a 10% em 3x = R$402,11', () => {
    expect(pricePayment(1000, 0.1, 3)).toBe(402.11);
  });

  it('taxa zero divide igualmente', () => {
    expect(pricePayment(900, 0, 3)).toBe(300);
  });

  it('cronograma Price fecha o saldo em zero', () => {
    const s = buildSchedule({ principal: 1000, rate: 0.1, installments: 3, method: 'MENSAL', firstDueDate: d('2026-10-30') });
    expect(s.map((r) => iso(r.dueDate))).toEqual(['2026-10-30', '2026-11-30', '2026-12-30']);
    expect(s[s.length - 1].balanceAfter).toBe(0);
    expect(s.reduce((a, r) => a + r.principalPart, 0)).toBeCloseTo(1000, 2);
    expect(s[0].interestPart).toBe(100);
  });

  it('4 métodos de período', () => {
    const base = d('2026-10-30');
    expect(iso(addPeriods(base, 'DIARIO', 1))).toBe('2026-10-31');
    expect(iso(addPeriods(base, 'SEMANAL', 1))).toBe('2026-11-06');
    expect(iso(addPeriods(base, 'QUINZENAL', 1))).toBe('2026-11-14');
    expect(iso(addPeriods(base, 'MENSAL', 1))).toBe('2026-11-30');
  });

  it('EDATE limita ao fim do mês (31/01 -> 28/02)', () => {
    expect(iso(edate(d('2027-01-31'), 1))).toBe('2027-02-28');
  });

  it('projeção automática 30/10 -> 3 parcelas futuras', () => {
    expect(projectDueDates(d('2026-10-30'), 'MENSAL').map(iso)).toEqual(['2026-11-30', '2026-12-30', '2027-01-30']);
  });

  it('multa diária: ValorAtual = Parcela × (1 + %multa × dias)', () => {
    expect(daysLate(d('2026-10-20'), d('2026-10-30'))).toBe(10);
    expect(daysLate(d('2026-11-20'), d('2026-10-30'))).toBe(0);
    expect(currentValue(500, 0.01, 10)).toBe(550);
  });

  it('paga só juros cria nova parcela no final', () => {
    const r = rollInterestOnly(
      { number: 1, dueDate: d('2026-10-30'), amount: 402.11, interestPart: 100, principalPart: 302.11 },
      d('2026-12-30'), 3, 'MENSAL',
    );
    expect(r.number).toBe(4);
    expect(iso(r.dueDate)).toBe('2027-01-30');
    expect(r.amount).toBe(402.11);
  });

  it('quitação: principal aberto + juros/multa vencidos', () => {
    const p = payoffAmount(
      [
        { number: 1, dueDate: d('2026-10-20'), amount: 402.11, interestPart: 100, principalPart: 302.11 },
        { number: 2, dueDate: d('2026-11-20'), amount: 402.11, interestPart: 69.79, principalPart: 332.32 },
      ],
      0.01, d('2026-10-30'),
    );
    expect(p.principal).toBe(634.43);
    expect(p.overdueInterest).toBe(100);
    expect(p.lateFees).toBe(40.21);
    expect(p.total).toBe(774.64);
  });

  it('comissão 30% sobre juros', () => {
    expect(splitInterest(100)).toEqual({ commission: 30, owner: 70 });
  });

  it('simulate devolve totais e projeção', () => {
    const s = simulate({ principal: 1000, rate: 0.1, installments: 3, method: 'MENSAL', firstDueDate: d('2026-10-30') });
    expect(s.totalInterest).toBe(206.35);
    expect(s.projection).toHaveLength(3);
  });
});
