/* Seed inicial: Super Admin, Dono com R$ 50.000 e Funcionário com repasse de R$ 10.000. */
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  const pass = await bcrypt.hash(process.env.SEED_PASSWORD ?? 'lend1234', 10);
  const admin = await prisma.user.upsert({
    where: { email: 'admin@lendcontrol.local' }, update: {},
    create: { name: 'Super Admin', email: 'admin@lendcontrol.local', password: pass, role: 'SUPER_ADMIN' },
  });
  const dono = await prisma.user.upsert({
    where: { email: 'dono@lendcontrol.local' }, update: {},
    create: { name: 'Dono', email: 'dono@lendcontrol.local', password: pass, role: 'DONO', capitalDisponivel: 40000, commissionRate: 0 },
  });
  const func = await prisma.user.upsert({
    where: { email: 'funcionario@lendcontrol.local' }, update: {},
    create: { name: 'Funcionário', email: 'funcionario@lendcontrol.local', password: pass, role: 'FUNCIONARIO', ownerId: dono.id, capitalDisponivel: 10000 },
  });
  if (!(await prisma.capitalTransfer.count())) {
    const t = await prisma.capitalTransfer.create({ data: { type: 'REPASSE_CAPITAL', fromUserId: dono.id, toUserId: func.id, amount: 10000, notes: 'Capital inicial' } });
    await prisma.cashLedger.createMany({
      data: [
        { userId: dono.id, type: 'APORTE', amount: 50000, balanceAfter: 50000, description: 'Aporte inicial' },
        { userId: dono.id, type: 'REPASSE_CAPITAL_SAIDA', amount: -10000, balanceAfter: 40000, transferId: t.id },
        { userId: func.id, type: 'REPASSE_CAPITAL_ENTRADA', amount: 10000, balanceAfter: 10000, transferId: t.id },
      ],
    });
  }
  console.log('Usuários: admin@, dono@, funcionario@lendcontrol.local — senha:', process.env.SEED_PASSWORD ?? 'lend1234');
  console.log({ admin: admin.id, dono: dono.id, func: func.id });
}

main().finally(() => prisma.$disconnect());
