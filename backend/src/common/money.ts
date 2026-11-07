import { Prisma } from '@prisma/client';
export const num = (v: Prisma.Decimal | number | string | null | undefined) => (v == null ? 0 : Number(v));
export const dec = (n: number) => new Prisma.Decimal(Math.round(n * 100) / 100);
