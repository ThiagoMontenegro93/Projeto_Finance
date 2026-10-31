/**
 * WhatsApp Importer — transforma a ficha colada do WhatsApp em campos do cliente.
 * Aceita dois formatos:
 *  1) Linha:  NOME;CPF;RG;NASCIMENTO;ESTADO CIVIL;PROFISSÃO;TELEFONE;WHATSAPP;EMAIL;CEP;RUA;NÚMERO;COMPLEMENTO;BAIRRO;CIDADE;UF;PIX;BANCO
 *  2) Bloco:  "Nome: Fulano\nCPF: 000.000.000-00\n..." (rótulos em qualquer ordem, com ou sem acento)
 * Retorna os campos reconhecidos + preview "14 de 18 campos".
 */

export const IMPORT_FIELDS = [
  'name',
  'cpf',
  'rg',
  'birthDate',
  'maritalStatus',
  'profession',
  'phone',
  'whatsapp',
  'email',
  'cep',
  'street',
  'number',
  'complement',
  'district',
  'city',
  'state',
  'pixKey',
  'bank',
] as const;

export type ImportField = (typeof IMPORT_FIELDS)[number];

export const FIELD_LABELS: Record<ImportField, string> = {
  name: 'Nome',
  cpf: 'CPF',
  rg: 'RG',
  birthDate: 'Nascimento',
  maritalStatus: 'Estado civil',
  profession: 'Profissão',
  phone: 'Telefone',
  whatsapp: 'WhatsApp',
  email: 'E-mail',
  cep: 'CEP',
  street: 'Endereço',
  number: 'Número',
  complement: 'Complemento',
  district: 'Bairro',
  city: 'Cidade',
  state: 'UF',
  pixKey: 'Chave PIX',
  bank: 'Banco',
};

const norm = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

const ALIASES: Record<string, ImportField> = {
  nome: 'name', nomecompleto: 'name', cliente: 'name',
  cpf: 'cpf',
  rg: 'rg', identidade: 'rg',
  nascimento: 'birthDate', datanascimento: 'birthDate', datadenascimento: 'birthDate', dtnasc: 'birthDate',
  estadocivil: 'maritalStatus',
  profissao: 'profession', ocupacao: 'profession', trabalho: 'profession',
  telefone: 'phone', tel: 'phone', fone: 'phone', celular: 'phone',
  whatsapp: 'whatsapp', whats: 'whatsapp', zap: 'whatsapp', wpp: 'whatsapp',
  email: 'email',
  cep: 'cep',
  rua: 'street', endereco: 'street', logradouro: 'street',
  numero: 'number', n: 'number', no: 'number',
  complemento: 'complement',
  bairro: 'district',
  cidade: 'city', municipio: 'city',
  uf: 'state', estado: 'state',
  pix: 'pixKey', chavepix: 'pixKey',
  banco: 'bank',
};

const digits = (s: string) => s.replace(/\D/g, '');

function clean(field: ImportField, raw: string): string | undefined {
  const v = raw.trim();
  if (!v || v === '-') return undefined;
  switch (field) {
    case 'cpf': {
      const d = digits(v);
      return d.length === 11 ? `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}` : v;
    }
    case 'cep': {
      const d = digits(v);
      return d.length === 8 ? `${d.slice(0, 5)}-${d.slice(5)}` : v;
    }
    case 'phone':
    case 'whatsapp':
      return digits(v) || undefined;
    case 'state':
      return v.toUpperCase().slice(0, 2);
    case 'birthDate': {
      const m = v.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
      if (!m) return v;
      const year = m[3].length === 2 ? `19${m[3]}` : m[3];
      return `${year}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    }
    default:
      return v;
  }
}

export function isValidCpf(cpf: string): boolean {
  const d = digits(cpf);
  if (d.length !== 11 || /^(\d)\1+$/.test(d)) return false;
  const calc = (len: number) => {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += Number(d[i]) * (len + 1 - i);
    const r = (sum * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return calc(9) === Number(d[9]) && calc(10) === Number(d[10]);
}

export interface ImportResult {
  format: 'LINHA' | 'BLOCO' | 'DESCONHECIDO';
  fields: Partial<Record<ImportField, string>>;
  found: number;
  total: number;
  preview: string;
  missing: string[];
  warnings: string[];
  labels: Record<ImportField, string>;
}

export function parseWhatsapp(text: string): ImportResult {
  const fields: Partial<Record<ImportField, string>> = {};
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  let format: ImportResult['format'] = 'DESCONHECIDO';

  const labeled = lines.filter((l) => /^[^:;]{1,30}:\s*/.test(l));
  if (labeled.length >= 2) {
    format = 'BLOCO';
    for (const line of labeled) {
      const idx = line.indexOf(':');
      const key = ALIASES[norm(line.slice(0, idx).replace(/^[*_\-•\s]+|[*_\s]+$/g, ''))];
      if (key && !fields[key]) {
        const val = clean(key, line.slice(idx + 1).replace(/^[*_\s]+|[*_\s]+$/g, ''));
        if (val) fields[key] = val;
      }
    }
  } else {
    const line = lines.find((l) => l.includes(';'));
    if (line) {
      format = 'LINHA';
      line.split(';').forEach((part, i) => {
        const key = IMPORT_FIELDS[i];
        if (!key) return;
        const val = clean(key, part);
        if (val) fields[key] = val;
      });
    }
  }

  const warnings: string[] = [];
  if (fields.cpf && !isValidCpf(fields.cpf)) warnings.push('CPF inválido — confira os dígitos');
  if (fields.whatsapp === undefined && fields.phone) fields.whatsapp = fields.phone;

  const found = IMPORT_FIELDS.filter((f) => fields[f] !== undefined).length;
  return {
    format,
    fields,
    found,
    total: IMPORT_FIELDS.length,
    preview: `${found} de ${IMPORT_FIELDS.length} campos`,
    missing: IMPORT_FIELDS.filter((f) => fields[f] === undefined).map((f) => FIELD_LABELS[f]),
    warnings,
    labels: FIELD_LABELS,
  };
}
