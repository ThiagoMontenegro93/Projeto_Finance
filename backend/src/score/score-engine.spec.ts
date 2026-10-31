import { classify, computeScore, SCORE_META } from './score-engine';
const d = (s: string) => new Date(`${s}T00:00:00Z`);

describe('Score', () => {
  it('classificação por faixa', () => {
    expect([10, 8, 7, 5, 4, 2, 1, 0].map(classify)).toEqual(['BOM', 'BOM', 'REGULAR', 'REGULAR', 'RUIM', 'RUIM', 'PERDA', 'PERDA']);
  });
  it('tudo em dia = 10 BOM com margem R$1500 e taxa 8%', () => {
    const r = computeScore([{ dueDate: d('2026-10-01'), paidAt: d('2026-10-01'), status: 'PAGO' }], d('2026-10-30'));
    expect(r).toMatchObject({ score: 10, status: 'BOM' });
    expect(SCORE_META.BOM).toMatchObject({ creditLimit: 1500, interestRate: 0.08 });
  });
  it('atraso em aberto derruba o score', () => {
    const r = computeScore(
      [
        { dueDate: d('2026-09-01'), status: 'PENDENTE' },
        { dueDate: d('2026-10-01'), status: 'PENDENTE' },
      ], d('2026-10-30'));
    expect(r.status).toBe('RUIM');
  });
  it('cliente novo sem nada pago começa REGULAR (7)', () => {
    expect(computeScore([], d('2026-10-30'))).toMatchObject({ score: 7, status: 'REGULAR' });
    expect(computeScore([{ dueDate: d('2026-11-30'), status: 'PENDENTE' }], d('2026-10-30'))).toMatchObject({ score: 7, status: 'REGULAR' });
  });
  it('180 dias de atraso = PERDA bloqueado', () => {
    const r = computeScore([{ dueDate: d('2026-04-01'), status: 'PENDENTE' }], d('2026-10-30'));
    expect(r).toMatchObject({ score: 0, status: 'PERDA' });
    expect(SCORE_META.PERDA.canLend).toBe(false);
  });
});
