import type { Prisma } from '@prisma/client';
import { prisma } from '../../../db/prisma';

export async function listJudgmentRecordsPage(input: {
  where: Prisma.JudgmentRecordWhereInput;
  orderBy: Prisma.JudgmentRecordOrderByWithRelationInput[];
  skip: number;
  take: number;
}): Promise<{ items: Awaited<ReturnType<typeof prisma.judgmentRecord.findMany>>; total: number }> {
  const [items, total] = await Promise.all([
    prisma.judgmentRecord.findMany({
      where: input.where,
      orderBy: input.orderBy,
      take: input.take,
      skip: input.skip,
    }),
    prisma.judgmentRecord.count({ where: input.where }),
  ]);
  return { items, total };
}

export async function listLegalSourceRecordsPage(input: {
  where: Prisma.LegalSourceRecordWhereInput;
  orderBy: Prisma.LegalSourceRecordOrderByWithRelationInput[];
  skip: number;
  take: number;
}): Promise<{ items: Awaited<ReturnType<typeof prisma.legalSourceRecord.findMany>>; total: number }> {
  const [items, total] = await Promise.all([
    prisma.legalSourceRecord.findMany({
      where: input.where,
      orderBy: input.orderBy,
      take: input.take,
      skip: input.skip,
    }),
    prisma.legalSourceRecord.count({ where: input.where }),
  ]);
  return { items, total };
}
