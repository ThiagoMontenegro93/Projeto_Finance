/** Mensagens pré-programadas de cobrança (régua D-2, D-0, D+1, D+3, D+7 + fiador). */

export interface TemplateDef {
  code: string;
  offsetDays: number; // dias em relação ao vencimento (negativo = antes)
  notifyGuarantor: boolean;
  body: string;
}

export const DEFAULT_TEMPLATES: TemplateDef[] = [
  {
    code: 'D_MENOS_2',
    offsetDays: -2,
    notifyGuarantor: false,
    body: 'Olá {nome}! Passando para lembrar que sua parcela {parcela} de {valor} vence em {vencimento} (daqui a 2 dias). PIX: {pix}. Obrigado!',
  },
  {
    code: 'D_0',
    offsetDays: 0,
    notifyGuarantor: false,
    body: 'Bom dia {nome}! Hoje vence sua parcela {parcela} no valor de {valor}. PIX: {pix}. Envie o comprovante por aqui. 🙏',
  },
  {
    code: 'D_MAIS_1',
    offsetDays: 1,
    notifyGuarantor: false,
    body: '{nome}, sua parcela {parcela} venceu ontem ({vencimento}). Valor atualizado: {valor_atual}. Regularize hoje para evitar mais multa.',
  },
  {
    code: 'D_MAIS_3',
    offsetDays: 3,
    notifyGuarantor: false,
    body: '{nome}, sua parcela {parcela} está com {dias} dias de atraso. Valor atualizado: {valor_atual}. Precisamos do pagamento ou de um contato ainda hoje.',
  },
  {
    code: 'D_MAIS_7',
    offsetDays: 7,
    notifyGuarantor: true,
    body: '{nome}, a parcela {parcela} está com {dias} dias de atraso (valor atualizado {valor_atual}). O fiador {fiador} também está sendo comunicado. Entre em contato para negociar.',
  },
];

export const GUARANTOR_BODY =
  'Olá {fiador}. Você é fiador(a) de {nome}, que está com a parcela {parcela} em atraso há {dias} dias (valor atualizado {valor_atual}). Por favor, entre em contato.';

export const brl = (n: number) =>
  n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export const brDate = (d: Date) =>
  `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`;

export function render(body: string, vars: Record<string, string | number | undefined>): string {
  return body.replace(/\{(\w+)\}/g, (_, k) => (vars[k] === undefined || vars[k] === null ? '' : String(vars[k])));
}

/** Normaliza número BR para o formato internacional (55 + DDD + número). */
export function toIntlPhone(phone: string): string {
  const d = phone.replace(/\D/g, '');
  if (d.startsWith('55') && d.length >= 12) return d;
  return `55${d}`;
}

/** Fallback quando a Evolution API não está conectada: link wa.me pronto para clicar. */
export function waMeLink(phone: string, text: string): string {
  return `https://wa.me/${toIntlPhone(phone)}?text=${encodeURIComponent(text)}`;
}
