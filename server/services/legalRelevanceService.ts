/**
 * legalRelevanceService.ts
 *
 * Relevans-/rankingalgoritm för juridiska sökningar. Består av tre komponenter:
 *  1. Basvikt per källsystem (DOMSTOL_RSS hög, DATAPORTAL mellan, KOMMUN_DIARY lägre).
 *  2. Aktualitetsvikt — exponential decay med halveringstid 365 dagar.
 *  3. Keyword-överlapp — förenklad BM25-liknande matchning på title + summary.
 *
 * Används när `sort=relevance` anges på /api/legal/judgments, /api/legal/sources
 * eller /api/legal/knowledge/search.
 */

import { prisma } from '../db/prisma';

const SOURCE_WEIGHTS: Record<string, number> = {
  DOMSTOL_RSS: 1.25,
  RATTSPRAXIS: 1.2,
  DATAPORTAL: 1.0,
  NATURVARDSVERKET: 1.1,
  LANSSTYRELSEN: 1.05,
  KOMMUN_DIARY: 0.85,
  MUNICIPAL_DIARY: 0.85,
  SFS: 1.15,
  INTERNAL: 0.7,
};

const HALF_LIFE_MS = 365 * 24 * 60 * 60 * 1000;
const MATRIX_JUDGMENT_BONUS = 0.3;
const KEYWORD_WEIGHT = 1.4;

export interface LegalSearchInput {
  q: string;
  legalArea?: string;
  authorityType?: string;
  from?: string;
  to?: string;
  take: number;
  skip: number;
  scope: 'judgments' | 'sources' | 'knowledge';
  nodeTypes?: string[];
}

export interface ScoredLegalItem {
  id: string;
  title: string;
  score: number;
  source: string;
  publishedAt?: string | null;
  kind: 'judgment' | 'legal_source' | 'knowledge_node';
  payload: Record<string, unknown>;
}

// Exporteras för unit-test (ingen extern API-yta).
export function tokenize(input: string): string[] {
  return input
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9åäö\s]/gi, ' ')
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2);
}

export function freshnessWeight(date: Date | null | undefined): number {
  if (!date) return 0.4;
  const ageMs = Date.now() - date.getTime();
  if (ageMs < 0) return 1;
  return Math.pow(0.5, ageMs / HALF_LIFE_MS);
}

export function sourceWeight(sourceSystem: string | null | undefined): number {
  if (!sourceSystem) return 1.0;
  const upper = sourceSystem.toUpperCase();
  for (const key of Object.keys(SOURCE_WEIGHTS)) {
    if (upper.includes(key)) return SOURCE_WEIGHTS[key];
  }
  return 1.0;
}

export function keywordOverlap(queryTokens: string[], candidate: string | null | undefined): number {
  if (!candidate || queryTokens.length === 0) return 0;
  const candidateTokens = new Set(tokenize(candidate));
  if (candidateTokens.size === 0) return 0;
  let hits = 0;
  for (const token of queryTokens) {
    if (candidateTokens.has(token)) hits++;
  }
  return hits / queryTokens.length;
}

function scoreJudgment(
  row: {
    id: string;
    title: string;
    description: string | null;
    pubDate: Date;
    sourceFeed: string;
    authorityType: string | null;
  },
  queryTokens: string[],
): number {
  const keywordScore =
    (keywordOverlap(queryTokens, row.title) * 2 + keywordOverlap(queryTokens, row.description)) / 3;
  return (
    sourceWeight(row.sourceFeed) * freshnessWeight(row.pubDate) +
    KEYWORD_WEIGHT * keywordScore +
    MATRIX_JUDGMENT_BONUS
  );
}

function scoreLegalSource(
  row: {
    id: string;
    title: string;
    summary: string | null;
    sourceSystem: string;
    matrixCategory: string | null;
    publishedAt: Date | null;
    decisionDate: Date | null;
    createdAt: Date;
  },
  queryTokens: string[],
): number {
  const keywordScore =
    (keywordOverlap(queryTokens, row.title) * 2 + keywordOverlap(queryTokens, row.summary)) / 3;
  const freshness = freshnessWeight(row.publishedAt ?? row.decisionDate ?? row.createdAt);
  const matrixBonus =
    row.matrixCategory && row.matrixCategory.toLowerCase().includes('praxis') ? MATRIX_JUDGMENT_BONUS : 0;
  return sourceWeight(row.sourceSystem) * freshness + KEYWORD_WEIGHT * keywordScore + matrixBonus;
}

export async function searchLegalKnowledge(input: LegalSearchInput): Promise<ScoredLegalItem[]> {
  const queryTokens = tokenize(input.q);

  if (input.scope === 'judgments') {
    // Ta en generös fetch-pool som sedan scoras och klipps lokalt.
    const pool = Math.min(Math.max(input.skip + input.take, 50) * 4, 500);
    const where: Record<string, unknown> = {};
    if (input.authorityType) where.authorityType = input.authorityType;
    if (input.from || input.to) {
      where.pubDate = {
        ...(input.from ? { gte: new Date(input.from) } : {}),
        ...(input.to ? { lte: new Date(input.to) } : {}),
      };
    }
    if (queryTokens.length > 0) {
      where.OR = [
        { title: { contains: input.q, mode: 'insensitive' } },
        { description: { contains: input.q, mode: 'insensitive' } },
      ];
    }
    const rows = await prisma.judgmentRecord.findMany({
      where,
      take: pool,
      orderBy: [{ pubDate: 'desc' }, { id: 'desc' }],
    });
    const scored = rows
      .map((row) => ({
        row,
        score: scoreJudgment(row, queryTokens),
      }))
      .sort((a, b) => b.score - a.score || b.row.id.localeCompare(a.row.id))
      .slice(input.skip, input.skip + input.take);
    return scored.map(({ row, score }) => ({
      id: row.id,
      title: row.title,
      score: Number(score.toFixed(4)),
      source: row.sourceFeed,
      publishedAt: row.pubDate.toISOString(),
      kind: 'judgment' as const,
      payload: {
        guid: row.guid,
        link: row.link,
        description: row.description,
        authorityType: row.authorityType,
        authorityName: row.authorityName,
        legalArea: row.legalArea,
      },
    }));
  }

  if (input.scope === 'sources') {
    const pool = Math.min(Math.max(input.skip + input.take, 50) * 4, 500);
    const where: Record<string, unknown> = {};
    if (input.legalArea) where.legalArea = input.legalArea;
    if (input.authorityType) where.authorityType = input.authorityType;
    if (input.from || input.to) {
      where.publishedAt = {
        ...(input.from ? { gte: new Date(input.from) } : {}),
        ...(input.to ? { lte: new Date(input.to) } : {}),
      };
    }
    if (queryTokens.length > 0) {
      where.OR = [
        { title: { contains: input.q, mode: 'insensitive' } },
        { summary: { contains: input.q, mode: 'insensitive' } },
      ];
    }
    const rows = await prisma.legalSourceRecord.findMany({
      where,
      take: pool,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    const scored = rows
      .map((row) => ({
        row,
        score: scoreLegalSource(row, queryTokens),
      }))
      .sort((a, b) => b.score - a.score || b.row.id.localeCompare(a.row.id))
      .slice(input.skip, input.skip + input.take);
    return scored.map(({ row, score }) => ({
      id: row.id,
      title: row.title,
      score: Number(score.toFixed(4)),
      source: row.sourceSystem,
      publishedAt: (row.publishedAt ?? row.decisionDate ?? row.createdAt).toISOString(),
      kind: 'legal_source' as const,
      payload: {
        sourceSystem: row.sourceSystem,
        sourceType: row.sourceType,
        sourceUrl: row.sourceUrl,
        authorityType: row.authorityType,
        authorityName: row.authorityName,
        municipality: row.municipality,
        legalArea: row.legalArea,
        storageTarget: row.storageTarget,
        matrixCategory: row.matrixCategory,
      },
    }));
  }

  // knowledge scope removed (legacy graph)
  return [];
}
