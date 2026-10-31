/**
 * Fluxo completo: Dono -> REPASSE_CAPITAL -> Funcionário empresta -> Cliente paga Funcionário
 * -> pagamento só de juros (Approval Lock) -> quitação -> Funcionário repassa ao Dono -> backup/restauração.
 * Usa o banco de DATABASE_URL (rode em um banco de teste).
 */
import { Test } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import ExcelJS from 'exceljs';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configure } from '../src/main';
import { PrismaService } from '../src/prisma/prisma.service';
import { makeCpf } from '../src/backup/backup.module';

describe('LendControl fluxo e2e', () => {
  let app: NestExpressApplication;
  let http: any;
  let prisma: PrismaService;
  const tok: Record<string, string> = {};
  const auth = (who: string) => ({ Authorization: `Bearer ${tok[who]}` });
  let funcId: string;
  let donoId: string;
  let clientId: string;
  let loanId: string;
  const cpf = makeCpf(String(Date.now()).slice(-9));

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configure(mod.createNestApplication<NestExpressApplication>());
    await app.init();
    http = app.getHttpServer();
    prisma = app.get(PrismaService);
    for (const who of ['admin', 'dono', 'funcionario']) {
      const r = await request(http).post('/api/auth/login').send({ email: `${who}@lendcontrol.local`, password: 'lend1234' }).expect(201);
      tok[who] = r.body.accessToken;
      if (who === 'dono') donoId = r.body.user.id;
      if (who === 'funcionario') funcId = r.body.user.id;
    }
  });

  afterAll(async () => app.close());

  it('bloqueia sem token', async () => {
    await request(http).get('/api/clients').expect(401);
  });

  it('Dono repassa R$ 1.000 de capital ao Funcionário', async () => {
    const before = await prisma.user.findUniqueOrThrow({ where: { id: funcId } });
    await request(http).post('/api/wallet/transfers').set(auth('dono')).send({ type: 'REPASSE_CAPITAL', userId: funcId, amount: 1000 }).expect(201);
    const after = await prisma.user.findUniqueOrThrow({ where: { id: funcId } });
    expect(Number(after.capitalDisponivel) - Number(before.capitalDisponivel)).toBe(1000);
  });

  it('Funcionário não pode repassar capital (só Dono)', async () => {
    await request(http).post('/api/wallet/transfers').set(auth('funcionario')).send({ type: 'REPASSE_CAPITAL', userId: donoId, amount: 1 }).expect(403);
  });

  it('importa ficha do WhatsApp e cadastra cliente', async () => {
    const r = await request(http).post('/api/clients/import/preview').set(auth('funcionario')).send({ text: `Nome: Cliente E2E\nCPF: ${cpf}\nTelefone: 11999990000\nCEP: 01001000` }).expect(201);
    expect(r.body.preview).toBe('5 de 18 campos');
    const c = await request(http).post('/api/clients').set(auth('funcionario')).send(r.body.fields).expect(201);
    clientId = c.body.id;
    expect(c.body.cpf).toBe(cpf);
  });

  it('cria empréstimo R$ 1.000, 10%, 3x mensal e debita a carteira', async () => {
    const before = await prisma.user.findUniqueOrThrow({ where: { id: funcId } });
    const r = await request(http).post('/api/loans').set(auth('funcionario')).send({
      clientId, principal: 1000, rate: 0.1, installments: 3, method: 'MENSAL', firstDueDate: '2026-10-30',
    }).expect(201);
    loanId = r.body.id;
    expect(r.body.installments).toHaveLength(3);
    expect(Number(r.body.installmentAmount)).toBe(402.11);
    expect(r.body.funderUserId).toBe(donoId);
    expect(r.body.lenderUserId).toBe(funcId);
    const after = await prisma.user.findUniqueOrThrow({ where: { id: funcId } });
    expect(Number(before.capitalDisponivel) - Number(after.capitalDisponivel)).toBe(1000);
    expect(Number(after.capitalEmprestado) - Number(before.capitalEmprestado)).toBe(1000);
  });

  it('acima da margem é recusado', async () => {
    await request(http).post('/api/loans').set(auth('funcionario')).send({ clientId, principal: 5000, rate: 0.1, installments: 3, method: 'MENSAL', firstDueDate: '2026-11-30' }).expect(403);
  });

  it('paga parcela 1 (aplica na hora; principal volta, 30% de comissão sobre juros)', async () => {
    const before = await prisma.user.findUniqueOrThrow({ where: { id: funcId } });
    const loan = await request(http).get(`/api/loans/${loanId}`).set(auth('funcionario')).expect(200);
    const inst = loan.body.installments[0];
    const p = await request(http).post(`/api/loans/${loanId}/payments`).set(auth('funcionario')).send({ type: 'PARCELA', installmentId: inst.id, paidAt: '2026-10-30' }).expect(201);
    expect(p.body.status).toBe('APROVADO');
    const after = await prisma.user.findUniqueOrThrow({ where: { id: funcId } });
    const lateFee = Number(p.body.lateFee);
    expect(Number(after.capitalDisponivel) - Number(before.capitalDisponivel)).toBeCloseTo(302.11, 2);
    expect(Number(after.comissaoAcumulada) - Number(before.comissaoAcumulada)).toBeCloseTo((100 + lateFee) * 0.3, 2);
  });

  it('paga só juros -> AGUARDANDO_APROVACAO; operador não aprova o próprio; Dono aprova; nova parcela no final', async () => {
    const p = await request(http).post(`/api/loans/${loanId}/payments`).set(auth('funcionario')).send({ type: 'JUROS' }).expect(201);
    expect(p.body.status).toBe('AGUARDANDO_APROVACAO');
    await request(http).post(`/api/payments/${p.body.id}/approve`).set(auth('funcionario')).send({ biometricVerified: true }).expect(403);
    await request(http).post(`/api/payments/${p.body.id}/approve`).set(auth('dono')).send({}).expect(403); // sem biometria/senha
    await request(http).post(`/api/payments/${p.body.id}/approve`).set(auth('dono')).send({ password: 'lend1234' }).expect(201);
    const loan = await request(http).get(`/api/loans/${loanId}`).set(auth('dono')).expect(200);
    const st = loan.body.installments.map((i: any) => `${i.number}:${i.status}`);
    expect(st).toEqual(['1:PAGO', '2:JUROS_PAGO', '3:PENDENTE', '4:PENDENTE']);
    expect(loan.body.installments[3].dueDate.slice(0, 10)).toBe('2027-01-30');
    expect(loan.body.projection).toHaveLength(3);
  });

  it('quitação total apaga todas as parcelas abertas e fecha o empréstimo', async () => {
    const p = await request(http).post(`/api/loans/${loanId}/payments`).set(auth('funcionario')).send({ type: 'QUITACAO' }).expect(201);
    expect(p.body.status).toBe('AGUARDANDO_APROVACAO');
    await request(http).post(`/api/payments/${p.body.id}/approve`).set(auth('dono')).send({ biometricVerified: true }).expect(201);
    const loan = await request(http).get(`/api/loans/${loanId}`).set(auth('dono')).expect(200);
    expect(loan.body.status).toBe('QUITADO');
    expect(loan.body.installments.filter((i: any) => i.status === 'PENDENTE')).toHaveLength(0);
    expect(loan.body.installments.filter((i: any) => i.status === 'CANCELADO')).toHaveLength(2);
    const f = await prisma.user.findUniqueOrThrow({ where: { id: funcId } });
    expect(Number(f.saldoARepassar)).toBeGreaterThan(0);
  });

  it('Funcionário repassa o recebido ao Dono', async () => {
    const f = await prisma.user.findUniqueOrThrow({ where: { id: funcId } });
    const amount = Number(f.saldoARepassar);
    const d0 = await prisma.user.findUniqueOrThrow({ where: { id: donoId } });
    await request(http).post('/api/wallet/transfers').set(auth('funcionario')).send({ type: 'REPASSE_RECEBIMENTO', userId: donoId, amount }).expect(201);
    const d1 = await prisma.user.findUniqueOrThrow({ where: { id: donoId } });
    expect(Number(d1.capitalDisponivel) - Number(d0.capitalDisponivel)).toBeCloseTo(amount, 2);
  });

  it('cliente PERDA não recebe empréstimo e só Super Admin desbloqueia', async () => {
    await prisma.client.update({ where: { id: clientId }, data: { scoreStatus: 'PERDA', blocked: true } });
    await request(http).post('/api/loans').set(auth('funcionario')).send({ clientId, principal: 100, rate: 0.1, installments: 1, method: 'DIARIO', firstDueDate: '2026-11-30' }).expect(403);
    await request(http).post(`/api/clients/${clientId}/unblock`).set(auth('dono')).send({}).expect(403);
    await request(http).post(`/api/clients/${clientId}/unblock`).set(auth('admin')).send({ reason: 'acordo' }).expect(201);
  });

  it('backup gera Excel com 7 abas e fórmulas BANE; restauração valida e importa', async () => {
    const b = await request(http).post('/api/backup').set(auth('dono')).expect(201);
    expect(b.body.status).toBe('SUCESSO');
    const file = await request(http).get(`/api/backup/files/${b.body.fileName}`).set(auth('dono')).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    }).expect(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(file.body);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Clientes', 'Emprestimos', 'Parcelas', 'Pagamentos', 'Equipe', 'Movimentacoes', 'Calculadora_BANE']);
    expect((wb.getWorksheet('Parcelas')!.getCell('L2').value as any).formula).toContain('TODAY()-INT(F2)');
    expect((wb.getWorksheet('Parcelas')!.getCell('M501').value as any).formula).toBe('IF(G501="","",ROUND(G501*(1+K501*L501),2))');

    const dry = await request(http).post('/api/backup/restore?dryRun=true').set(auth('dono')).attach('file', file.body, 'b.xlsx').expect(201);
    expect(dry.body.ok).toBe(true);
    const real = await request(http).post('/api/backup/restore').set(auth('dono')).attach('file', file.body, 'b.xlsx').expect(201);
    expect(real.body.ok).toBe(true);
    expect(real.body.counts.clientes.created).toBe(0); // nada duplicado
    expect(real.body.counts.clientes.updated).toBeGreaterThan(0);
  });

  it('modelo: 6 registros de teste + linhas vazias até 500', async () => {
    const r = await request(http).get('/api/backup/template').set(auth('dono')).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    }).expect(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(r.body);
    const ws = wb.getWorksheet('Clientes')!;
    expect(ws.getCell('B7').value).toBeTruthy();
    expect(ws.getCell('B8').value).toBeNull();
    expect((ws.getCell('AD501').value as any).formula).toBeTruthy();
  });

  it('exporta CSV de clientes e reimporta sem duplicar', async () => {
    const csv = await request(http).get('/api/backup/export/clientes.csv').set(auth('dono')).expect(200);
    expect(csv.text.split('\r\n')[0]).toContain('Nome;CPF');
    const r = await request(http).post('/api/backup/restore').set(auth('dono')).attach('file', Buffer.from(csv.text, 'utf8'), 'clientes.csv').expect(201);
    expect(r.body.ok).toBe(true);
    expect(r.body.counts.clientes.created).toBe(0);
    expect(r.body.counts.clientes.updated).toBeGreaterThan(0);
  });

  it('ficha incompleta é recusada na restauração', async () => {
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet('Qualquer');
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    const r = await request(http).post('/api/backup/restore').set(auth('dono')).attach('file', buf, 'x.xlsx').expect(201);
    expect(r.body.ok).toBe(false);
    expect(r.body.errors[0]).toContain('Nenhuma aba reconhecida');
  });

  it('dashboard 4 cards', async () => {
    const r = await request(http).get('/api/dashboard').set(auth('dono')).expect(200);
    expect(Object.keys(r.body.cards)).toEqual(expect.arrayContaining(['capitalDisponivel', 'capitalEmprestado', 'recebidoMes', 'emAtraso']));
  });

  it('régua de mensagens gera link wa.me sem Evolution API', async () => {
    const r = await request(http).get('/api/messages/queue').set(auth('dono')).expect(200);
    for (const i of r.body) expect(i.waLink).toMatch(/^https:\/\/wa\.me\/55/);
  });
});
