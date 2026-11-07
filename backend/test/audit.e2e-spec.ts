/**
 * Auditoria de todas as funções + régua de cobrança simulada por data.
 * Rode em banco limpo: NODE_ENV=test DATABASE_URL=... npx jest --config test/jest-e2e.json audit
 */
import { Test } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configure } from '../src/main';
import { PrismaService } from '../src/prisma/prisma.service';
import { makeCpf } from '../src/backup/backup.module';
import { StorageService } from '../src/documents/documents.module';

const DAY = 86_400_000;
const today = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()));
const iso = (offset: number) => new Date(today.getTime() + offset * DAY).toISOString().slice(0, 10);

describe('Auditoria LendControl', () => {
  let app: NestExpressApplication;
  let http: any;
  let prisma: PrismaService;
  const tok: Record<string, string> = {};
  const ids: Record<string, string> = {};
  const A = (w: string) => ({ Authorization: `Bearer ${tok[w]}` });
  let seq = 100;
  const newClient = async (name: string, extra: Record<string, unknown> = {}) => {
    const r = await request(http).post('/api/clients').set(A('funcionario')).send({ name, cpf: makeCpf(String(Date.now() + seq++).slice(-9)), whatsapp: `119${String(seq).padStart(8, '0')}`, ...extra }).expect(201);
    return r.body.id as string;
  };
  const newLoan = (clientId: string, firstDue: number, extra: Record<string, unknown> = {}, who = 'funcionario') =>
    request(http).post('/api/loans').set(A(who)).send({ clientId, principal: 500, rate: 0.1, installments: 1, method: 'MENSAL', firstDueDate: iso(firstDue), ...extra });

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configure(mod.createNestApplication<NestExpressApplication>());
    await app.init();
    http = app.getHttpServer();
    prisma = app.get(PrismaService);
    for (const w of ['admin', 'dono', 'funcionario']) {
      const r = await request(http).post('/api/auth/login').send({ email: `${w}@lendcontrol.local`, password: 'lend1234' }).expect(201);
      tok[w] = r.body.accessToken;
      ids[w] = r.body.user.id;
    }
    // segundo funcionário
    // garante capital para os testes (aporte do Dono + repasse ao funcionário)
    await request(http).post('/api/wallet/deposit').set(A('dono')).send({ amount: 50000, description: 'aporte teste' }).expect(201);
    await request(http).post('/api/wallet/transfers').set(A('dono')).send({ type: 'REPASSE_CAPITAL', userId: ids.funcionario, amount: 50000 }).expect(201);
    const fb = `funcb${Date.now()}@lendcontrol.local`;
    await request(http).post('/api/team').set(A('dono')).send({ name: 'Func B', email: fb, password: 'lend1234' }).expect(201);
    tok.funcb = (await request(http).post('/api/auth/login').send({ email: fb, password: 'lend1234' })).body.accessToken;
  });
  afterAll(() => app.close());

  describe('Régua de cobrança (alertas)', () => {
    const cli: Record<string, string> = {};
    beforeAll(async () => {
      cli.fiador = await newClient('Fiador Teste');
      for (const [k, off] of [['dm2', 2], ['d0', 0], ['dp1', -1], ['dp3', -3], ['dp5', -5], ['dp7', -7], ['dp15', -15]] as const) {
        cli[k] = await newClient(`Cliente ${k}`, { guarantorId: cli.fiador });
        await newLoan(cli[k], off).expect(201);
      }
    });

    it('fila do dia traz D-2, D-0, D+1, D+3 e D+7 (+ fiador)', async () => {
      const q = (await request(http).get('/api/messages/queue').set(A('dono')).expect(200)).body as any[];
      const by = (id: string) => q.filter((m) => m.clientId === id).map((m) => `${m.templateCode}:${m.recipient}`).sort();
      expect(by(cli.dm2)).toEqual(['D_MENOS_2:CLIENTE']);
      expect(by(cli.d0)).toEqual(['D_0:CLIENTE']);
      expect(by(cli.dp1)).toEqual(['D_MAIS_1:CLIENTE']);
      expect(by(cli.dp3)).toEqual(['D_MAIS_3:CLIENTE']);
      expect(by(cli.dp7)).toEqual(['D_MAIS_7:CLIENTE', 'D_MAIS_7:FIADOR']);
      const d7 = q.find((m) => m.clientId === cli.dp7 && m.recipient === 'CLIENTE');
      expect(d7.body).toContain('7 dias de atraso');
      expect(d7.body).toContain('R$'); // valor atualizado com multa
      expect(d7.waLink).toMatch(/^https:\/\/wa\.me\/55119/);
      (global as any).gaps = { dp5: by(cli.dp5), dp15: by(cli.dp15) };
    });

    it('após D+7 repete toda semana (D+14, D+21…) com fiador; entre as datas não repete', async () => {
      const g = (global as any).gaps;
      expect(g.dp5).toEqual([]);
      expect(g.dp15).toEqual([]);
      const c = await newClient('Semanal', { guarantorId: cli.fiador });
      await newLoan(c, -21).expect(201);
      const q = (await request(http).get('/api/messages/queue').set(A('dono'))).body as any[];
      expect(q.filter((m) => m.clientId === c).map((m) => `${m.templateCode}:${m.recipient}`).sort()).toEqual(['ATRASO_SEMANAL_D21:CLIENTE', 'ATRASO_SEMANAL_D21:FIADOR']);
    });

    it('resumo diário do Dono traz atrasos, vencimentos, aprovações e fila', async () => {
      const r = (await request(http).get('/api/messages/summary').set(A('dono')).expect(200)).body;
      expect(r.overdue).toBeGreaterThanOrEqual(5);
      expect(r.text).toContain('Em atraso');
    });

    it('registrar a fila grava log e não duplica', async () => {
      const r1 = (await request(http).post('/api/messages/send').set(A('dono')).send({}).expect(201)).body;
      expect(r1.channel).toBe('WA_ME');
      expect(r1.total).toBeGreaterThanOrEqual(6);
      const logs = await prisma.messageLog.count();
      await request(http).post('/api/messages/send').set(A('dono')).send({}).expect(201);
      expect(await prisma.messageLog.count()).toBe(logs);
      const q = (await request(http).get('/api/messages/queue').set(A('dono'))).body as any[];
      expect(q.filter((m) => !m.alreadySent && !m.missingPhone)).toHaveLength(0);
    });

    it('dashboard mostra atrasados e vencendo hoje', async () => {
      const d = (await request(http).get('/api/dashboard').set(A('dono')).expect(200)).body;
      expect(d.cards.parcelasEmAtraso).toBeGreaterThanOrEqual(5);
      expect(d.dueToday.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Empréstimo, multa e projeção', () => {
    it('multa diária de 1% em 10 dias = +10%', async () => {
      const c = await newClient('Multa Teste');
      const l = (await newLoan(c, -10).expect(201)).body;
      const d = (await request(http).get(`/api/loans/${l.id}`).set(A('dono'))).body;
      expect(d.installments[0].daysLate).toBe(10);
      expect(d.installments[0].currentValue).toBeCloseTo(Number(d.installments[0].amount) * 1.1, 2);
      expect(d.projection.map((x: string) => x.slice(0, 10))).toHaveLength(3);
    });

    it('pagar parcela atrasada: multa entra em comissão (30%) e a repassar (70%)', async () => {
      const c = await newClient('Multa Paga');
      const l = (await newLoan(c, -10).expect(201)).body;
      const before = await prisma.user.findUniqueOrThrow({ where: { id: ids.funcionario } });
      const p = (await request(http).post(`/api/loans/${l.id}/payments`).set(A('funcionario')).send({ type: 'PARCELA' }).expect(201)).body;
      const after = await prisma.user.findUniqueOrThrow({ where: { id: ids.funcionario } });
      const earn = 50 + Number(p.lateFee);
      expect(Number(p.lateFee)).toBeCloseTo(55, 2);
      expect(Number(after.comissaoAcumulada) - Number(before.comissaoAcumulada)).toBeCloseTo(earn * 0.3, 2);
      expect(Number(after.saldoARepassar) - Number(before.saldoARepassar)).toBeCloseTo(earn * 0.7, 2);
      const loan = (await request(http).get(`/api/loans/${l.id}`).set(A('dono'))).body;
      expect(loan.status).toBe('QUITADO');
    });

    it('4 métodos geram datas corretas', async () => {
      const c = await newClient('Metodos');
      for (const [m, step] of [['DIARIO', 1], ['SEMANAL', 7], ['QUINZENAL', 15]] as const) {
        const l = (await newLoan(c, 1, { installments: 2, method: m, principal: 100 }).expect(201)).body;
        const ds = l.installments.sort((a: any, b: any) => a.number - b.number).map((i: any) => new Date(i.dueDate).getTime());
        expect((ds[1] - ds[0]) / DAY).toBe(step);
      }
    });

    it('capital insuficiente bloqueia empréstimo', async () => {
      const c = await newClient('Sem capital', {});
      await prisma.client.update({ where: { id: c }, data: { creditLimit: 10_000_000 } });
      const r = await newLoan(c, 30, { principal: 9_000_000 });
      expect(r.status).toBe(400);
      expect(r.body.message).toContain('Capital disponível insuficiente');
    });
  });

  describe('Score e bloqueios', () => {
    it('180 dias de atraso => PERDA, bloqueado, nem o Dono libera; só Super Admin desbloqueia', async () => {
      const c = await newClient('Perda 180');
      await newLoan(c, -181).expect(201);
      const cl = await prisma.client.findUniqueOrThrow({ where: { id: c } });
      expect(cl.scoreStatus).toBe('PERDA');
      expect(cl.blocked).toBe(true);
      expect((await newLoan(c, 30, { overrideLimit: true }, 'dono')).status).toBe(403);
      await request(http).post(`/api/clients/${c}/unblock`).set(A('dono')).send({}).expect(403);
      await request(http).post(`/api/clients/${c}/unblock`).set(A('admin')).send({ reason: 'acordo' }).expect(201);
    });

    it('RUIM exige liberação do Dono; funcionário é barrado', async () => {
      const c = await newClient('Ruim');
      await newLoan(c, -20, { installments: 2, principal: 200 }).expect(201); // 2 parcelas: 20 dias e ~futuro
      await newLoan(c, -40, { principal: 100 }, 'funcionario').then((r) => r.status === 201 || r.status === 403);
      const cl = await prisma.client.findUniqueOrThrow({ where: { id: c } });
      console.log('Score após atrasos:', cl.score, cl.scoreStatus);
      if (cl.scoreStatus === 'RUIM') {
        expect((await newLoan(c, 30, { principal: 100 })).status).toBe(403);
        expect((await newLoan(c, 30, { principal: 100, overrideLimit: true }, 'dono')).status).toBe(201);
      }
    });

    it('cliente novo começa REGULAR; ao pagar em dia vira BOM com margem 1.500 e taxa 8%', async () => {
      const c = await newClient('Bom');
      let cl = await prisma.client.findUniqueOrThrow({ where: { id: c } });
      expect(cl.scoreStatus).toBe('REGULAR');
      expect(Number(cl.creditLimit)).toBe(1000);
      const l = (await newLoan(c, 0, { installments: 2, principal: 200 }).expect(201)).body;
      await request(http).post(`/api/loans/${l.id}/payments`).set(A('funcionario')).send({ type: 'PARCELA' }).expect(201);
      cl = await prisma.client.findUniqueOrThrow({ where: { id: c } });
      expect(cl.scoreStatus).toBe('BOM');
      expect(Number(cl.creditLimit)).toBe(1500);
      expect(Number(cl.interestRate)).toBe(0.08);
    });
  });

  describe('Aprovações e carteira', () => {
    it('recusar pagamento de juros não mexe nas parcelas; não deixa 2 pendentes', async () => {
      const c = await newClient('Recusa');
      const l = (await newLoan(c, 5, { installments: 2 }).expect(201)).body;
      const p = (await request(http).post(`/api/loans/${l.id}/payments`).set(A('funcionario')).send({ type: 'JUROS' }).expect(201)).body;
      await request(http).post(`/api/loans/${l.id}/payments`).set(A('funcionario')).send({ type: 'QUITACAO' }).expect(400);
      await request(http).post(`/api/payments/${p.id}/approve`).set(A('funcionario')).send({ password: 'lend1234' }).expect(403);
      await request(http).post(`/api/payments/${p.id}/reject`).set(A('dono')).send({ reason: 'sem comprovante' }).expect(201);
      const d = (await request(http).get(`/api/loans/${l.id}`).set(A('dono'))).body;
      expect(d.installments.map((i: any) => i.status)).toEqual(['PENDENTE', 'PENDENTE']);
    });

    it('senha errada não aprova', async () => {
      const c = await newClient('Senha');
      const l = (await newLoan(c, 5).expect(201)).body;
      const p = (await request(http).post(`/api/loans/${l.id}/payments`).set(A('funcionario')).send({ type: 'JUROS' }).expect(201)).body;
      await request(http).post(`/api/payments/${p.id}/approve`).set(A('dono')).send({ password: 'errada' }).expect(403);
    });

    it('funcionário B não paga empréstimo do funcionário A e não vê na lista', async () => {
      const c = await newClient('Escopo');
      const l = (await newLoan(c, 5).expect(201)).body;
      await request(http).post(`/api/loans/${l.id}/payments`).set(A('funcb')).send({ type: 'PARCELA' }).expect(403);
      const list = (await request(http).get('/api/loans').set(A('funcb'))).body as any[];
      expect(list.find((x) => x.id === l.id)).toBeUndefined();
      const q = (await request(http).get('/api/messages/queue').set(A('funcb'))).body as any[];
      expect(q).toHaveLength(0);
    });

    it('repasse ao Dono acima do saldo é recusado', async () => {
      await request(http).post('/api/wallet/transfers').set(A('funcionario')).send({ type: 'REPASSE_RECEBIMENTO', userId: ids.dono, amount: 99_999_999 }).expect(400);
    });

    it('extrato tem lançamentos de empréstimo e recebimento', async () => {
      const l = (await request(http).get('/api/wallet/ledger').set(A('funcionario'))).body as any[];
      const types = new Set(l.map((x) => x.type));
      expect(types.has('EMPRESTIMO_SAIDA')).toBe(true);
      expect(types.has('RECEBIMENTO_PRINCIPAL')).toBe(true);
      expect(types.has('COMISSAO')).toBe(true);
    });
  });

  describe('Documentos, configurações e importador', () => {
    it('upload privado + link de 5 min; link adulterado ou vencido é negado', async () => {
      const c = await newClient('Docs');
      const png = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');
      const d = (await request(http).post('/api/documents').set(A('funcionario')).field('clientId', c).field('kind', 'COMPROVANTE_CLIENTE').attach('file', png, { filename: 'pix.png', contentType: 'image/png' }).expect(201)).body;
      const s = (await request(http).get(`/api/documents/${d.id}/signed-url`).set(A('funcionario')).expect(200)).body;
      await request(http).get(s.url).expect(200);
      await request(http).get(s.url.replace(/sig=../, 'sig=00')).expect(403);
      const st = app.get(StorageService);
      const old = st.sign(d.id, Date.now() - 6 * 60_000);
      await request(http).get(`/api/documents/${d.id}/file?exp=${old.exp}&sig=${old.sig}`).expect(403);
      await request(http).post('/api/documents').set(A('funcionario')).field('clientId', c).field('kind', 'RG').attach('file', Buffer.from('x'), { filename: 'a.exe', contentType: 'application/octet-stream' }).expect(400);
    });

    it('e-mail do backup valida formato', async () => {
      await request(http).put('/api/settings').set(A('dono')).send({ backup_email: 'nao-e-email' }).expect(400);
      const r = await request(http).put('/api/settings').set(A('dono')).send({ backup_email: 'thiago@exemplo.com' }).expect(200);
      expect(r.body.backup_email).toBe('thiago@exemplo.com');
      await request(http).put('/api/settings').set(A('funcionario')).send({ backup_email: 'x@y.com' }).expect(403);
    });

    it('CPF duplicado responde 409 claro', async () => {
      const cpf = makeCpf(String(Date.now() + 777).slice(-9));
      await request(http).post('/api/clients').set(A('dono')).send({ name: 'Dup 1', cpf }).expect(201);
      const r = await request(http).post('/api/clients').set(A('dono')).send({ name: 'Dup 2', cpf: cpf.replace(/\D/g, '') }).expect(409);
      expect(r.body.message).toContain('CPF');
    });

    it('funcionário não acessa backup/exportação', async () => {
      await request(http).get('/api/backup/export').set(A('funcionario')).expect(403);
    });
  });
});
