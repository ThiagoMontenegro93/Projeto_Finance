/**
 * Planilha de backup LendControl — 7 abas categorizadas + Regras BANE
 * (fórmulas embutidas para tocar o negócio só pela planilha se o sistema cair).
 */
import ExcelJS from 'exceljs';

export const SHEETS = {
  clientes: 'Clientes',
  emprestimos: 'Emprestimos',
  parcelas: 'Parcelas',
  pagamentos: 'Pagamentos',
  equipe: 'Equipe',
  movimentacoes: 'Movimentacoes',
  calculadora: 'Calculadora_BANE',
} as const;

export const MIN_ROWS = 500;

type Col = { header: string; key: string; width?: number; fmt?: string; formula?: (r: number) => string };

const money = '"R$" #,##0.00';
const pct = '0.00%';
const date = 'dd/mm/yyyy';

export const COLUMNS: Record<Exclude<keyof typeof SHEETS, 'calculadora'>, Col[]> = {
  clientes: [
    { header: 'ID', key: 'id', width: 38 },
    { header: 'Nome', key: 'name', width: 28 },
    { header: 'CPF', key: 'cpf', width: 16 },
    { header: 'RG', key: 'rg', width: 14 },
    { header: 'Nascimento', key: 'birthDate', width: 12, fmt: date },
    { header: 'Estado civil', key: 'maritalStatus', width: 12 },
    { header: 'Profissão', key: 'profession', width: 16 },
    { header: 'Telefone', key: 'phone', width: 14 },
    { header: 'WhatsApp', key: 'whatsapp', width: 14 },
    { header: 'E-mail', key: 'email', width: 24 },
    { header: 'CEP', key: 'cep', width: 10 },
    { header: 'Endereço', key: 'street', width: 26 },
    { header: 'Número', key: 'number', width: 8 },
    { header: 'Complemento', key: 'complement', width: 12 },
    { header: 'Bairro', key: 'district', width: 16 },
    { header: 'Cidade', key: 'city', width: 16 },
    { header: 'UF', key: 'state', width: 5 },
    { header: 'Chave PIX', key: 'pixKey', width: 22 },
    { header: 'Banco', key: 'bank', width: 12 },
    { header: 'Margem', key: 'creditLimit', width: 12, fmt: money },
    { header: 'Taxa', key: 'interestRate', width: 8, fmt: pct },
    { header: 'Emergência nome', key: 'emergencyName', width: 18 },
    { header: 'Emergência tel', key: 'emergencyPhone', width: 14 },
    { header: 'Fiador ID', key: 'guarantorId', width: 38 },
    { header: 'Indicado por ID', key: 'referredById', width: 38 },
    { header: 'Bloqueado', key: 'blocked', width: 10 },
    // BANE — score automático
    { header: 'Maior atraso (dias)', key: '_maxLate', width: 12, formula: (r) => `IF(A${r}="","",IFERROR(_xlfn.MAXIFS(Parcelas!L:L,Parcelas!B:B,A${r}),0))` },
    { header: 'Pontos perdidos', key: '_lost', width: 10, formula: (r) => `IF(A${r}="","",SUMIFS(Parcelas!P:P,Parcelas!B:B,A${r}))` },
    {
      header: 'Score (0-10)', key: '_score', width: 10,
      formula: (r) => `IF(A${r}="","",IF(AA${r}>=180,0,MAX(0,MIN(10,ROUND(10-AB${r},0)))))`,
    },
    { header: 'Status', key: '_status', width: 10, formula: (r) => `IF(AC${r}="","",IF(AC${r}>=8,"BOM",IF(AC${r}>=5,"REGULAR",IF(AC${r}>=2,"RUIM","PERDA"))))` },
  ],
  emprestimos: [
    { header: 'ID', key: 'id', width: 38 },
    { header: 'Código', key: 'code', width: 8 },
    { header: 'Cliente ID', key: 'clientId', width: 38 },
    { header: 'Cliente', key: 'clientName', width: 24 },
    { header: 'Financiador (Dono) ID', key: 'funderUserId', width: 38 },
    { header: 'Emprestou (Funcionário) ID', key: 'lenderUserId', width: 38 },
    { header: 'Valor', key: 'principal', width: 12, fmt: money },
    { header: 'Taxa/período', key: 'interestRate', width: 10, fmt: pct },
    { header: 'Método', key: 'method', width: 11 },
    { header: 'Nº parcelas', key: 'installmentsCount', width: 9 },
    { header: 'Valor parcela (PRICE)', key: '_pmt', width: 13, fmt: money, formula: (r) => `IF(G${r}="","",ROUND(IF(H${r}=0,G${r}/J${r},PMT(H${r},J${r},-G${r})),2))` },
    { header: 'Multa/dia', key: 'lateFeeDailyRate', width: 9, fmt: pct },
    { header: 'Início', key: 'startDate', width: 12, fmt: date },
    { header: '1º vencimento', key: 'firstDueDate', width: 12, fmt: date },
    { header: 'Status', key: 'status', width: 10 },
    { header: 'Último vencimento', key: '_last', width: 12, fmt: date, formula: (r) => `IF(A${r}="","",IFERROR(_xlfn.MAXIFS(Parcelas!F:F,Parcelas!D:D,A${r},Parcelas!J:J,"<>CANCELADO"),""))` },
    ...[1, 2, 3].map<Col>((n) => ({
      header: `Projeção ${n}`, key: `_proj${n}`, width: 12, fmt: date,
      formula: (r) => `IF(OR(P${r}="",P${r}=0,O${r}<>"ATIVO"),"",IF(I${r}="MENSAL",EDATE(P${r},${n}),P${r}+${n}*IF(I${r}="DIARIO",1,IF(I${r}="SEMANAL",7,15))))`,
    })),
    { header: 'Saldo atualizado em aberto', key: '_open', width: 14, fmt: money, formula: (r) => `IF(A${r}="","",SUMIFS(Parcelas!M:M,Parcelas!D:D,A${r},Parcelas!J:J,"PENDENTE"))` },
  ],
  parcelas: [
    { header: 'ID', key: 'id', width: 38 },
    { header: 'Cliente ID', key: 'clientId', width: 38 },
    { header: 'Cliente', key: 'clientName', width: 24 },
    { header: 'Empréstimo ID', key: 'loanId', width: 38 },
    { header: 'Nº', key: 'number', width: 5 },
    { header: 'Vencimento', key: 'dueDate', width: 12, fmt: date },
    { header: 'Valor', key: 'amount', width: 12, fmt: money },
    { header: 'Juros', key: 'interestPart', width: 11, fmt: money },
    { header: 'Principal', key: 'principalPart', width: 11, fmt: money },
    { header: 'Status', key: 'status', width: 11 },
    { header: 'Multa/dia', key: 'lateFeeDailyRate', width: 9, fmt: pct },
    // BANE: dias atraso = HOJE() - Vencimento ; valor atualizado = Original * (1 + multa * dias)
    { header: 'Dias atraso', key: '_days', width: 9, formula: (r) => `IF(AND(J${r}="PENDENTE",F${r}<>"",TODAY()>INT(F${r})),TODAY()-INT(F${r}),0)` },
    { header: 'Valor atualizado', key: '_current', width: 13, fmt: money, formula: (r) => `IF(G${r}="","",ROUND(G${r}*(1+K${r}*L${r}),2))` },
    { header: 'Pago em', key: 'paidAt', width: 12, fmt: date },
    { header: 'Valor pago', key: 'paidAmount', width: 12, fmt: money },
    // pontos que a parcela tira do score (mesma régua do sistema)
    { header: 'Penalidade score', key: '_penalty', width: 10, formula: (r) => `IF(L${r}=0,0,IF(L${r}<=3,0.5,IF(L${r}<=7,1,IF(L${r}<=30,3,IF(L${r}<=60,4,6)))))` },
  ],
  pagamentos: [
    { header: 'ID', key: 'id', width: 38 },
    { header: 'Empréstimo ID', key: 'loanId', width: 38 },
    { header: 'Parcela ID', key: 'installmentId', width: 38 },
    { header: 'Tipo', key: 'type', width: 10 },
    { header: 'Valor', key: 'amount', width: 12, fmt: money },
    { header: 'Multa', key: 'lateFee', width: 10, fmt: money },
    { header: 'Status', key: 'status', width: 22 },
    { header: 'Lançado por ID', key: 'createdById', width: 38 },
    { header: 'Aprovado por ID', key: 'approvedById', width: 38 },
    { header: 'Data', key: 'paidAt', width: 12, fmt: date },
    { header: 'Forma', key: 'method', width: 10 },
    { header: 'Observação', key: 'notes', width: 24 },
  ],
  equipe: [
    { header: 'ID', key: 'id', width: 38 },
    { header: 'Nome', key: 'name', width: 22 },
    { header: 'E-mail', key: 'email', width: 26 },
    { header: 'Papel', key: 'role', width: 13 },
    { header: 'Dono ID', key: 'ownerId', width: 38 },
    { header: 'Capital disponível', key: 'capitalDisponivel', width: 14, fmt: money },
    { header: 'Capital emprestado', key: 'capitalEmprestado', width: 14, fmt: money },
    { header: 'Comissão acumulada', key: 'comissaoAcumulada', width: 14, fmt: money },
    { header: 'A repassar ao Dono', key: 'saldoARepassar', width: 14, fmt: money },
    { header: '% comissão', key: 'commissionRate', width: 10, fmt: pct },
    { header: 'Ativo', key: 'active', width: 7 },
    { header: 'Capital total', key: '_total', width: 14, fmt: money, formula: (r) => `IF(A${r}="","",F${r}+G${r})` },
  ],
  movimentacoes: [
    { header: 'ID', key: 'id', width: 38 },
    { header: 'Origem', key: 'source', width: 10 },
    { header: 'Data', key: 'createdAt', width: 17, fmt: 'dd/mm/yyyy hh:mm' },
    { header: 'Usuário ID', key: 'userId', width: 38 },
    { header: 'Tipo', key: 'type', width: 26 },
    { header: 'Valor', key: 'amount', width: 12, fmt: money },
    { header: 'Saldo após', key: 'balanceAfter', width: 12, fmt: money },
    { header: 'Empréstimo ID', key: 'loanId', width: 38 },
    { header: 'Para usuário ID', key: 'toUserId', width: 38 },
    { header: 'Descrição', key: 'description', width: 36 },
  ],
};

export type SheetKey = keyof typeof COLUMNS;
export type BackupData = Record<SheetKey, Record<string, unknown>[]>;

const TAB_COLORS: Record<string, string> = {
  Clientes: 'FF2563EB', Emprestimos: 'FF16A34A', Parcelas: 'FFEA580C', Pagamentos: 'FF9333EA',
  Equipe: 'FF0891B2', Movimentacoes: 'FF64748B', Calculadora_BANE: 'FFDC2626',
};

const VALIDATIONS: Partial<Record<SheetKey, Record<string, string[]>>> = {
  emprestimos: { method: ['DIARIO', 'SEMANAL', 'QUINZENAL', 'MENSAL'], status: ['ATIVO', 'QUITADO', 'PERDA'] },
  parcelas: { status: ['PENDENTE', 'PAGO', 'JUROS_PAGO', 'CANCELADO'] },
  pagamentos: { type: ['PARCELA', 'JUROS', 'QUITACAO'], status: ['AGUARDANDO_APROVACAO', 'APROVADO', 'REJEITADO'] },
  equipe: { role: ['SUPER_ADMIN', 'DONO', 'FUNCIONARIO'] },
};

const colLetter = (n: number) => {
  let s = '';
  for (; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};

function addDataSheet(wb: ExcelJS.Workbook, key: SheetKey, rows: Record<string, unknown>[], minRows: number) {
  const name = SHEETS[key];
  const cols = COLUMNS[key];
  const ws = wb.addWorksheet(name, { properties: { tabColor: { argb: TAB_COLORS[name] } }, views: [{ state: 'frozen', ySplit: 1, xSplit: 2 }] });
  ws.columns = cols.map((c) => ({ header: c.header, key: c.key, width: c.width ?? 12, style: c.fmt ? { numFmt: c.fmt } : {} }));
  const head = ws.getRow(1);
  head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } };
  head.alignment = { vertical: 'middle', wrapText: true };
  head.height = 30;
  cols.forEach((c, i) => {
    if (c.formula) head.getCell(i + 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDC2626' } };
  });

  const total = Math.max(minRows, rows.length + 50);
  for (let i = 0; i < total; i++) {
    const r = i + 2;
    const src = rows[i];
    const row = ws.getRow(r);
    cols.forEach((c, ci) => {
      const cell = row.getCell(ci + 1);
      if (c.formula) cell.value = { formula: c.formula(r) } as ExcelJS.CellFormulaValue;
      else if (src && src[c.key] !== undefined && src[c.key] !== null) cell.value = src[c.key] as ExcelJS.CellValue;
    });
  }

  // listas de validação
  const v = VALIDATIONS[key] ?? {};
  for (const [field, list] of Object.entries(v)) {
    const idx = cols.findIndex((c) => c.key === field) + 1;
    const L = colLetter(idx);
    for (let r = 2; r <= total + 1; r++) {
      ws.getCell(`${L}${r}`).dataValidation = { type: 'list', allowBlank: true, formulae: [`"${list.join(',')}"`] };
    }
  }
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } };
  return { ws, total };
}

function addStatusColors(ws: ExcelJS.Worksheet, ref: string) {
  const rule = (text: string, bg: string, fg = 'FFFFFFFF'): ExcelJS.ConditionalFormattingRule => ({
    type: 'containsText', operator: 'containsText', text, priority: 1,
    style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: bg } }, font: { color: { argb: fg }, bold: true } },
  });
  ws.addConditionalFormatting({
    ref,
    rules: [rule('BOM', 'FF16A34A'), rule('REGULAR', 'FF2563EB'), rule('RUIM', 'FFEA580C'), rule('PERDA', 'FF111827')],
  });
}

function addCalculator(wb: ExcelJS.Workbook) {
  const now = new Date();
  const today = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  const ws = wb.addWorksheet(SHEETS.calculadora, { properties: { tabColor: { argb: TAB_COLORS.Calculadora_BANE } } });
  ws.columns = [{ width: 30 }, { width: 16 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 3 }, { width: 70 }];
  const title = (cell: string, text: string) => {
    ws.getCell(cell).value = text;
    ws.getCell(cell).font = { bold: true, size: 13, color: { argb: 'FF0F172A' } };
  };
  const input = (cell: string) => {
    ws.getCell(cell).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF7ED' } };
    ws.getCell(cell).border = { bottom: { style: 'thin', color: { argb: 'FFEA580C' } } };
  };

  title('A1', 'CALCULADORA DE EMPRÉSTIMO (Tabela Price) — preencha as células laranja');
  const inputs: [string, string, ExcelJS.CellValue, string?][] = [
    ['A3', 'Valor emprestado', 1000, money],
    ['A4', 'Taxa por período', 0.1, pct],
    ['A5', 'Nº de parcelas', 4],
    ['A6', 'Método (DIARIO/SEMANAL/QUINZENAL/MENSAL)', 'MENSAL'],
    ['A7', '1º vencimento', today, date],
    ['A8', 'Multa por dia de atraso', 0.01, pct],
  ];
  for (const [c, label, val, fmt] of inputs) {
    const r = Number(c.slice(1));
    ws.getCell(`A${r}`).value = label;
    ws.getCell(`B${r}`).value = val;
    if (fmt) ws.getCell(`B${r}`).numFmt = fmt;
    input(`B${r}`);
  }
  ws.getCell('B6').dataValidation = { type: 'list', allowBlank: false, formulae: ['"DIARIO,SEMANAL,QUINZENAL,MENSAL"'] };

  ws.getCell('A10').value = 'Valor da parcela';
  ws.getCell('B10').value = { formula: 'ROUND(IF(B4=0,B3/B5,PMT(B4,B5,-B3)),2)' } as ExcelJS.CellFormulaValue;
  ws.getCell('A11').value = 'Total a receber';
  ws.getCell('B11').value = { formula: 'ROUND(B10*B5,2)' } as ExcelJS.CellFormulaValue;
  ws.getCell('A12').value = 'Lucro (juros)';
  ws.getCell('B12').value = { formula: 'B11-B3' } as ExcelJS.CellFormulaValue;
  ['B10', 'B11', 'B12'].forEach((c) => {
    ws.getCell(c).numFmt = money;
    ws.getCell(c).font = { bold: true };
  });

  title('A14', 'CRONOGRAMA (até 36 parcelas; EDATE para mensal)');
  ['Nº', 'Vencimento', 'Parcela', 'Juros', 'Amortização', 'Saldo'].forEach((h, i) => {
    const c = ws.getCell(15, i + 1);
    c.value = h;
    c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } };
  });
  for (let k = 1; k <= 36; k++) {
    const r = 15 + k;
    const prevSaldo = k === 1 ? '$B$3' : `F${r - 1}`;
    ws.getCell(`A${r}`).value = { formula: `IF(${k}<=$B$5,${k},"")` } as ExcelJS.CellFormulaValue;
    ws.getCell(`B${r}`).value = {
      formula: `IF(A${r}="","",IF($B$6="MENSAL",EDATE($B$7,${k - 1}),$B$7+${k - 1}*IF($B$6="DIARIO",1,IF($B$6="SEMANAL",7,15))))`,
    } as ExcelJS.CellFormulaValue;
    ws.getCell(`D${r}`).value = { formula: `IF(A${r}="","",ROUND(${prevSaldo}*$B$4,2))` } as ExcelJS.CellFormulaValue;
    ws.getCell(`E${r}`).value = { formula: `IF(A${r}="","",IF(A${r}=$B$5,${prevSaldo},$B$10-D${r}))` } as ExcelJS.CellFormulaValue;
    ws.getCell(`C${r}`).value = { formula: `IF(A${r}="","",D${r}+E${r})` } as ExcelJS.CellFormulaValue;
    ws.getCell(`F${r}`).value = { formula: `IF(A${r}="","",ROUND(${prevSaldo}-E${r},2))` } as ExcelJS.CellFormulaValue;
    ws.getCell(`B${r}`).numFmt = date;
    ['C', 'D', 'E', 'F'].forEach((L) => (ws.getCell(`${L}${r}`).numFmt = money));
  }

  // Calculadora de atraso + projeção 3x
  title('H1', 'REGRAS BANE — use a planilha se o sistema cair');
  const rules = [
    'Dias de atraso: =HOJE()-Vencimento (aba Parcelas, coluna L; só conta se Status = PENDENTE).',
    'Valor atualizado: =Original*(1+multa*dias) (aba Parcelas, coluna M).',
    'Score automático (aba Clientes, AA–AD): 10 menos a soma das penalidades das parcelas em atraso (Parcelas, coluna P);',
    '   180+ dias de atraso = PERDA (score 0).',
    'Faixas: 8–10 BOM (verde ⭐, margem R$1.500, taxa 8%) · 5–7 REGULAR (azul)',
    '   2–4 RUIM (laranja ⚠️, restringir) · 0–1 PERDA (preto 💀, NÃO EMPRESTAR).',
    'Projeção automática: aba Emprestimos, colunas Q–S = próximas 3 datas (EDATE no mensal).',
    'Pagou SÓ JUROS: marque a parcela como JUROS_PAGO e copie a linha para o final com a próxima data.',
    'QUITAÇÃO total: marque todas as parcelas PENDENTE do empréstimo como CANCELADO e o empréstimo como QUITADO.',
    'Comissão do funcionário: 30% sobre juros + multa; 70% é repassado ao Dono.',
    'Novas linhas: preencha a partir da primeira linha vazia — as fórmulas já estão prontas até a linha 501.',
    'Para voltar ao sistema: Backup > Restaurar > arraste este arquivo. Nada é apagado: linhas são atualizadas ou incluídas.',
  ];
  rules.forEach((t, i) => (ws.getCell(`H${3 + i}`).value = t));

  title('H17', 'CALCULADORA DE ATRASO');
  const late: [string, ExcelJS.CellValue, string?][] = [
    ['Valor original da parcela', 500, money],
    ['Vencimento', new Date(today.getTime() - 10 * 86_400_000), date],
    ['Multa por dia', 0.01, pct],
  ];
  late.forEach(([label], i) => (ws.getCell(`H${18 + i}`).value = label));
  ws.getColumn(9).width = 16;
  late.forEach(([, val, fmt], i) => {
    const c = ws.getCell(`I${18 + i}`);
    c.value = val;
    if (fmt) c.numFmt = fmt;
    input(`I${18 + i}`);
  });
  ws.getCell('H21').value = 'Dias de atraso';
  ws.getCell('I21').value = { formula: 'MAX(0,TODAY()-INT(I19))' } as ExcelJS.CellFormulaValue;
  ws.getCell('H22').value = 'Valor atualizado';
  ws.getCell('I22').value = { formula: 'ROUND(I18*(1+I20*I21),2)' } as ExcelJS.CellFormulaValue;
  ws.getCell('I22').numFmt = money;
  ws.getCell('I22').font = { bold: true };
  ws.getCell('H23').value = 'Próximos 3 vencimentos (mensal)';
  ['I23', 'J23', 'K23'].forEach((c, i) => {
    ws.getCell(c).value = { formula: `EDATE(I19,${i + 1})` } as ExcelJS.CellFormulaValue;
    ws.getCell(c).numFmt = date;
  });
  ws.getColumn(10).width = 12;
  ws.getColumn(11).width = 12;
}

export async function buildWorkbook(data: BackupData, opts: { minRows?: number; generatedAt?: Date } = {}) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'LendControl V6.5';
  wb.created = opts.generatedAt ?? new Date();
  wb.calcProperties = { fullCalcOnLoad: true };
  const minRows = opts.minRows ?? MIN_ROWS;

  const { ws: cli, total: ct } = addDataSheet(wb, 'clientes', data.clientes, minRows);
  addStatusColors(cli, `AD2:AD${ct + 1}`);
  addDataSheet(wb, 'emprestimos', data.emprestimos, minRows);
  const { ws: par, total: pt } = addDataSheet(wb, 'parcelas', data.parcelas, minRows);
  par.addConditionalFormatting({
    ref: `L2:L${pt + 1}`,
    rules: [{ type: 'cellIs', operator: 'greaterThan', formulae: ['0'], priority: 1, style: { font: { color: { argb: 'FFDC2626' }, bold: true } } }],
  });
  addDataSheet(wb, 'pagamentos', data.pagamentos, minRows);
  addDataSheet(wb, 'equipe', data.equipe, minRows);
  addDataSheet(wb, 'movimentacoes', data.movimentacoes, minRows);
  addCalculator(wb);
  return wb;
}

// ---------------------------------------------------------------------------
// Leitura para restauração
// ---------------------------------------------------------------------------

export interface ParsedBackup {
  data: BackupData;
  errors: string[];
}

const cellValue = (v: ExcelJS.CellValue): unknown => {
  if (v === null || v === undefined || v === '') return undefined;
  if (typeof v === 'object' && !(v instanceof Date)) {
    if ('result' in (v as any)) return (v as any).result;
    if ('text' in (v as any)) return (v as any).text;
    if ('richText' in (v as any)) return (v as any).richText.map((t: any) => t.text).join('');
    return undefined;
  }
  return v;
};

export async function parseWorkbook(buffer: Buffer): Promise<ParsedBackup> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as any);
  const errors: string[] = [];
  const data = {} as BackupData;
  for (const key of Object.keys(COLUMNS) as SheetKey[]) {
    const ws = wb.getWorksheet(SHEETS[key]);
    data[key] = [];
    if (!ws) continue; // abas ausentes são ignoradas: dá para importar só Clientes, por exemplo
    const cols = COLUMNS[key];
    const head = ws.getRow(1);
    cols.forEach((c, i) => {
      const h = String(cellValue(head.getCell(i + 1).value) ?? '');
      if (h !== c.header) errors.push(`Aba ${SHEETS[key]}: coluna ${colLetter(i + 1)} deveria ser "${c.header}" e está "${h}"`);
    });
    ws.eachRow({ includeEmpty: false }, (row, r) => {
      if (r === 1) return;
      const obj: Record<string, unknown> = { _row: r };
      let filled = false;
      cols.forEach((c, i) => {
        if (c.formula) return;
        const v = cellValue(row.getCell(i + 1).value);
        if (v !== undefined) {
          obj[c.key] = v;
          filled = true;
        }
      });
      if (filled) data[key].push(obj);
    });
  }
  if (!Object.keys(COLUMNS).some((k) => wb.getWorksheet(SHEETS[k as SheetKey]))) {
    errors.push(`Nenhuma aba reconhecida. Use as abas: ${Object.values(SHEETS).slice(0, 6).join(', ')}`);
  }
  return { data, errors };
}

// ---------------------------------------------------------------------------
// CSV (uma aba por arquivo) — exportação leve e importação pelo mesmo layout
// ---------------------------------------------------------------------------

const csvCell = (v: unknown) => {
  if (v === null || v === undefined) return '';
  const t = v instanceof Date ? v.toISOString().slice(0, 10) : String(v);
  return /[";\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
};

/** CSV com ";" e BOM UTF-8 (abre direto no Excel em português). Só colunas de dados, sem fórmulas. */
export function toCsv(key: SheetKey, rows: Record<string, unknown>[]) {
  const cols = COLUMNS[key].filter((c) => !c.formula);
  const lines = [cols.map((c) => csvCell(c.header)).join(';'), ...rows.map((r) => cols.map((c) => csvCell(r[c.key])).join(';'))];
  return '\uFEFF' + lines.join('\r\n');
}

function splitCsvLine(line: string, sep: string) {
  const out: string[] = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === sep) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

/** Lê um CSV exportado (ou montado à mão) e descobre a aba pelo cabeçalho. */
export function parseCsv(text: string): ParsedBackup {
  const data = Object.fromEntries(Object.keys(COLUMNS).map((k) => [k, []])) as unknown as BackupData;
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return { data, errors: ['CSV vazio'] };
  const sep = lines[0].includes(';') ? ';' : ',';
  const head = splitCsvLine(lines[0], sep).map((h) => h.trim());
  const key = (Object.keys(COLUMNS) as SheetKey[]).find((k) => {
    const hs = COLUMNS[k].filter((c) => !c.formula).map((c) => c.header);
    return hs.length === head.length && hs.every((h, i) => h === head[i]);
  });
  if (!key) return { data, errors: ['Cabeçalho do CSV não corresponde a nenhuma aba. Exporte um CSV pelo sistema e use o mesmo layout.'] };
  const cols = COLUMNS[key].filter((c) => !c.formula);
  lines.slice(1).forEach((line, i) => {
    const vals = splitCsvLine(line, sep);
    const obj: Record<string, unknown> = { _row: i + 2 };
    cols.forEach((c, ci) => {
      const v = vals[ci]?.trim();
      if (!v) return;
      const isNum = c.fmt && c.fmt !== date && !c.fmt.startsWith('dd');
      obj[c.key] = isNum ? Number(v.replace(/\./g, '').replace(',', '.')) : c.fmt?.startsWith('dd') ? parseBrDate(v) : v;
    });
    data[key].push(obj);
  });
  return { data, errors: [] };
}

function parseBrDate(v: string): Date | string {
  const m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return new Date(Date.UTC(+m[3], +m[2] - 1, +m[1]));
  const d = new Date(v);
  return isNaN(d.getTime()) ? v : d;
}
