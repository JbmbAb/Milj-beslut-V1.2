import { prisma } from '../db/prisma';

function mapLegalSourceToJudgment(record: {
  id: string;
  externalId: string;
  title: string;
  sourceUrl: string;
  summary?: string | null;
  publishedAt?: Date | null;
  decisionDate?: Date | null;
  sourceSystem: string;
  legalArea?: string | null;
  authorityName?: string | null;
  authorityType?: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: record.id,
    guid: record.externalId,
    title: record.title,
    link: record.sourceUrl,
    description: record.summary ?? null,
    pubDate: record.publishedAt ?? record.decisionDate ?? record.createdAt,
    sourceFeed: record.sourceSystem,
    legalArea: record.legalArea ?? null,
    authorityName: record.authorityName ?? null,
    authorityType: record.authorityType ?? null,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

export async function upsertJudgment(data: {
  guid: string;
  title: string;
  link: string;
  description?: string;
  pubDate: Date;
}) {
  return prisma.judgmentRecord.upsert({
    where: { guid: data.guid },
    create: {
      guid: data.guid,
      title: data.title,
      link: data.link,
      description: data.description,
      pubDate: data.pubDate,
    },
    update: {
      title: data.title,
      link: data.link,
      description: data.description,
      pubDate: data.pubDate,
    },
  });
}

export async function getJudgmentByGuid(guid: string) {
  const judgment = await prisma.judgmentRecord.findUnique({
    where: { guid },
  });
  if (judgment) {
    return judgment;
  }

  const legacy = await prisma.legalSourceRecord.findFirst({
    where: {
      externalId: guid,
      sourceType: {
        in: ['JUDGMENT', 'LEGAL_PRAXIS'],
      },
    },
    orderBy: {
      updatedAt: 'desc',
    },
  });

  return legacy ? mapLegalSourceToJudgment(legacy) : null;
}

export async function listJudgments(take: number = 100, skip: number = 0) {
  // Stabil sortering: primärt pubDate desc, sekundärt id desc som tie-breaker.
  const judgments = await prisma.judgmentRecord.findMany({
    take,
    skip,
    orderBy: [{ pubDate: 'desc' }, { id: 'desc' }],
  });

  if (judgments.length >= take) {
    return judgments;
  }

  const legacy = await prisma.legalSourceRecord.findMany({
    where: {
      judgmentId: null,
      sourceType: {
        in: ['JUDGMENT', 'LEGAL_PRAXIS'],
      },
    },
    take: Math.max(take - judgments.length, 0),
    skip: Math.max(skip - judgments.length, 0),
    orderBy: [{ publishedAt: 'desc' }, { decisionDate: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
  });

  // Dedup via guid — legacy-posten vinner vid konflikt (bakåtkompatibelt
  // beteende: listJudgments har historiskt låtit senaste källa överskriva).
  const merged = [...judgments, ...legacy.map(mapLegalSourceToJudgment)];
  const deduped = new Map<string, (typeof merged)[number]>();
  for (const item of merged) {
    deduped.set(item.guid, item);
  }

  // Deterministisk slutsort: pubDate desc primärt, id desc som tie-breaker.
  return Array.from(deduped.values())
    .sort((a, b) => {
      const diff = b.pubDate.getTime() - a.pubDate.getTime();
      return diff !== 0 ? diff : b.id.localeCompare(a.id);
    })
    .slice(0, take);
}
