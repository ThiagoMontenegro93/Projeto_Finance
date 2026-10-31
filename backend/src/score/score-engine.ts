/**
 * Score 0–10 automático e classificação BOM / REGULAR / RUIM / PERDA.
 *  8–10  BOM     verde   ⭐  aumenta margem (R$1000 -> R$1500) e taxa fidelidade (10% -> 8%)
 *  5–7   REGULAR azul        mantém condições padrão
 *  2–4   RUIM    laranja ⚠️  restringe (margem baixa, novo empréstimo só com aprovação)
 *  0–1   PERDA   preto   💀  bloqueado, NÃO EMPRESTAR — só Super Admin desbloqueia
 *  Qualquer parcela com 180+ dias de atraso => PERDA imediata (score 0).
 */

export type ScoreStatus = 'BOM' | 'REGULAR' | 'RUIM' | 'PERDA';

export interface InstallmentHistory {
  dueDate: Date;
  paidAt?: Date | null;
  status: 'PENDENTE' | 'PAGO' | 'JUROS_PAGO' | 'CANCELADO';
}

const DAY = 86_400_000;
const dayDiff = (a: Date, b: Date) =>
  Math.floor(
    (Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), a.getUTCDate()) -
      Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate())) /
      DAY,
  );

export const LOSS_DAYS = 180;

export function penaltyFor(days: number): number {
  if (days <= 0) return 0;
  if (days <= 3) return 0.5;
  if (days <= 7) return 1;
  if (days <= 30) return 3;
  if (days <= 60) return 4;
  return 6;
}

export function computeScore(history: InstallmentHistory[], today: Date = new Date()) {
  let score = 10;
  let maxDaysLate = 0;
  let onTime = 0;
  for (const h of history) {
    if (h.status === 'CANCELADO') continue;
    const settled = h.status === 'PAGO' || h.status === 'JUROS_PAGO';
    const ref = settled && h.paidAt ? h.paidAt : today;
    const days = Math.max(0, dayDiff(ref, h.dueDate));
    if (settled && days === 0) onTime++;
    // atraso em aberto pesa mais que atraso já pago
    score -= settled ? penaltyFor(days) * 0.5 : penaltyFor(days);
    if (!settled) maxDaysLate = Math.max(maxDaysLate, days);
  }
  // bônus de fidelidade: a cada 5 parcelas pagas em dia recupera 1 ponto
  score += Math.floor(onTime / 5);
  score = Math.max(0, Math.min(10, Math.round(score)));
  if (maxDaysLate >= LOSS_DAYS) score = 0;
  return { score, status: classify(score), maxDaysLate };
}

export function classify(score: number): ScoreStatus {
  if (score >= 8) return 'BOM';
  if (score >= 5) return 'REGULAR';
  if (score >= 2) return 'RUIM';
  return 'PERDA';
}

export const SCORE_META: Record<
  ScoreStatus,
  { color: string; icon: string; label: string; creditLimit: number; interestRate: number; canLend: boolean; needsApproval: boolean }
> = {
  BOM: { color: '#16A34A', icon: '⭐', label: 'Bom pagador', creditLimit: 1500, interestRate: 0.08, canLend: true, needsApproval: false },
  REGULAR: { color: '#2563EB', icon: '•', label: 'Regular', creditLimit: 1000, interestRate: 0.1, canLend: true, needsApproval: false },
  RUIM: { color: '#EA580C', icon: '⚠️', label: 'Ruim — restringir', creditLimit: 500, interestRate: 0.1, canLend: true, needsApproval: true },
  PERDA: { color: '#111827', icon: '💀', label: 'Perda — NÃO EMPRESTAR', creditLimit: 0, interestRate: 0.1, canLend: false, needsApproval: true },
};

export const COLLECTION_STRATEGIES: Record<ScoreStatus, string[]> = {
  BOM: ['Lembrete amigável D-2 e D-0', 'Oferecer renovação com taxa fidelidade 8%'],
  REGULAR: ['Lembretes D-2, D-0, D+1', 'Ligação no D+3', 'Contato de emergência no D+7'],
  RUIM: [
    'Acionar contato de emergência',
    'Acionar fiador',
    'Visita presencial',
    'Desconto de 10% para pagamento à vista',
    'Parcelamento do saldo',
    'Carta de cobrança (PDF)',
  ],
  PERDA: [
    'Carta de cobrança formal (PDF)',
    'Acordo com 30% de desconto',
    'Negativação (SPC/Serasa)',
    'Encaminhar ao jurídico',
  ],
};
