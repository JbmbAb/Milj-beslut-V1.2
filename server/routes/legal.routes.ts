/**
 * legal.routes.ts
 *
 * Publikt och admin-API för juridiska källor (LegalSourceRecord) och domar
 * (JudgmentRecord). Exponerar listning, filtrering, sortering (inkl.
 * relevansranking), och manuell trigger av RSS-ingest.
 *
 * Skapad som del av helikopter-åtgärd spår 3.
 */

import express from 'express';
import { z } from 'zod';
import { requireAuth } from '../security/auth';
import { rateLimitByUser } from '../security/rateLimit';
import { toSafeErrorResponse } from '../security/secureErrors';
import type { Prisma } from '@prisma/client';
import {
  listJudgments,
  ingestDomstolRssFeed,
  searchLegalKnowledge,
  listJudgmentRecordsPage,
  listLegalSourceRecordsPage,
} from '../modules/legal/public';
import { parseListQuery } from '../lib/querySort';

const router = express.Router();

const JUDGMENT_SORT_KEYS = ['pubDate', 'createdAt', 'updatedAt', 'title', 'relevance'] as const;
const LEGAL_SOURCE_SORT_KEYS = [
  'createdAt',
  'updatedAt',
  'publishedAt',
  'decisionDate',
  'title',
  'relevance',
] as const;
const KNOWLEDGE_SORT_KEYS = ['name', 'relevance', 'createdAt'] as const;

// GET /api/legal/judgments — lista domar med filter/sort.
router.get('/api/legal/judgments', rateLimitByUser(60, 60_000), async (req, res) => {
  try {
    const parsed = parseListQuery(req.query, {
      sortKeys: JUDGMENT_SORT_KEYS,
      defaultSort: 'pubDate',
      defaultOrder: 'desc',
      maxPageSize: 200,
    });

    const schema = z.object({
      q: z.string().min(1).max(200).optional(),
      legalArea: z.string().max(100).optional(),
      authorityType: z.string().max(100).optional(),
      from: z.string().datetime().optional(),
      to: z.string().datetime().optional(),
    });
    const filters = schema.parse({
      q: typeof req.query.q === 'string' ? req.query.q : undefined,
      legalArea: typeof req.query.legalArea === 'string' ? req.query.legalArea : undefined,
      authorityType: typeof req.query.authorityType === 'string' ? req.query.authorityType : undefined,
      from: typeof req.query.from === 'string' ? req.query.from : undefined,
      to: typeof req.query.to === 'string' ? req.query.to : undefined,
    });

    if (parsed.sort === 'relevance') {
      const items = await searchLegalKnowledge({
        q: filters.q ?? '',
        legalArea: filters.legalArea,
        authorityType: filters.authorityType,
        from: filters.from,
        to: filters.to,
        take: parsed.pageSize,
        skip: (parsed.page - 1) * parsed.pageSize,
        scope: 'judgments',
      });
      res.json({ ok: true, items, page: parsed.page, pageSize: parsed.pageSize, sort: 'relevance' });
      return;
    }

    // parsed.sort !== 'relevance' vid denna punkt (hanterat ovan).
    const sortKey = parsed.sort as Exclude<(typeof JUDGMENT_SORT_KEYS)[number], 'relevance'>;
    const where: Record<string, unknown> = {};
    if (filters.legalArea) where.legalArea = filters.legalArea;
    if (filters.authorityType) where.authorityType = filters.authorityType;
    if (filters.from || filters.to) {
      where.pubDate = {
        ...(filters.from ? { gte: new Date(filters.from) } : {}),
        ...(filters.to ? { lte: new Date(filters.to) } : {}),
      };
    }
    if (filters.q) {
      where.OR = [
        { title: { contains: filters.q, mode: 'insensitive' } },
        { description: { contains: filters.q, mode: 'insensitive' } },
      ];
    }

    const { items, total } = await listJudgmentRecordsPage({
      where: where as Prisma.JudgmentRecordWhereInput,
      orderBy: [{ [sortKey]: parsed.order }, { id: 'desc' }],
      take: parsed.pageSize,
      skip: (parsed.page - 1) * parsed.pageSize,
    });

    // Om inget filter/sök och legacy-fallback behövs, komplettera via listJudgments.
    const shouldFallback =
      !filters.q &&
      !filters.legalArea &&
      !filters.authorityType &&
      !filters.from &&
      !filters.to &&
      items.length < parsed.pageSize;
    const finalItems = shouldFallback
      ? await listJudgments(parsed.pageSize, (parsed.page - 1) * parsed.pageSize)
      : items;

    res.json({
      ok: true,
      items: finalItems,
      total,
      page: parsed.page,
      pageSize: parsed.pageSize,
      sort: parsed.sort,
      order: parsed.order,
    });
  } catch (error: unknown) {
    res.status(400).json(toSafeErrorResponse(error));
  }
});

// GET /api/legal/sources — lista LegalSourceRecord med bred filtrering.
router.get('/api/legal/sources', rateLimitByUser(60, 60_000), async (req, res) => {
  try {
    const parsed = parseListQuery(req.query, {
      sortKeys: LEGAL_SOURCE_SORT_KEYS,
      defaultSort: 'createdAt',
      defaultOrder: 'desc',
      maxPageSize: 200,
    });

    const schema = z.object({
      q: z.string().min(1).max(200).optional(),
      sourceSystem: z.string().max(100).optional(),
      sourceType: z.string().max(100).optional(),
      authorityType: z.string().max(100).optional(),
      authorityName: z.string().max(200).optional(),
      municipality: z.string().max(100).optional(),
      legalArea: z.string().max(100).optional(),
      storageTarget: z.enum(['PRISMA', 'POSTGIS', 'FILESYSTEM', 'REVIEW_QUEUE']).optional(),
      from: z.string().datetime().optional(),
      to: z.string().datetime().optional(),
    });
    const filters = schema.parse({
      q: typeof req.query.q === 'string' ? req.query.q : undefined,
      sourceSystem: typeof req.query.sourceSystem === 'string' ? req.query.sourceSystem : undefined,
      sourceType: typeof req.query.sourceType === 'string' ? req.query.sourceType : undefined,
      authorityType: typeof req.query.authorityType === 'string' ? req.query.authorityType : undefined,
      authorityName: typeof req.query.authorityName === 'string' ? req.query.authorityName : undefined,
      municipality: typeof req.query.municipality === 'string' ? req.query.municipality : undefined,
      legalArea: typeof req.query.legalArea === 'string' ? req.query.legalArea : undefined,
      storageTarget: typeof req.query.storageTarget === 'string' ? req.query.storageTarget : undefined,
      from: typeof req.query.from === 'string' ? req.query.from : undefined,
      to: typeof req.query.to === 'string' ? req.query.to : undefined,
    });

    const where: Record<string, unknown> = {};
    if (filters.sourceSystem) where.sourceSystem = filters.sourceSystem;
    if (filters.sourceType) where.sourceType = filters.sourceType;
    if (filters.authorityType) where.authorityType = filters.authorityType;
    if (filters.authorityName) where.authorityName = filters.authorityName;
    if (filters.municipality) where.municipality = filters.municipality;
    if (filters.legalArea) where.legalArea = filters.legalArea;
    if (filters.storageTarget) where.storageTarget = filters.storageTarget;
    if (filters.from || filters.to) {
      where.publishedAt = {
        ...(filters.from ? { gte: new Date(filters.from) } : {}),
        ...(filters.to ? { lte: new Date(filters.to) } : {}),
      };
    }
    if (filters.q) {
      where.OR = [
        { title: { contains: filters.q, mode: 'insensitive' } },
        { summary: { contains: filters.q, mode: 'insensitive' } },
      ];
    }

    if (parsed.sort === 'relevance') {
      const items = await searchLegalKnowledge({
        q: filters.q ?? '',
        legalArea: filters.legalArea,
        authorityType: filters.authorityType,
        from: filters.from,
        to: filters.to,
        take: parsed.pageSize,
        skip: (parsed.page - 1) * parsed.pageSize,
        scope: 'sources',
      });
      res.json({ ok: true, items, page: parsed.page, pageSize: parsed.pageSize, sort: 'relevance' });
      return;
    }

    const sortKey = parsed.sort;
    const { items, total } = await listLegalSourceRecordsPage({
      where: where as Prisma.LegalSourceRecordWhereInput,
      orderBy: [{ [sortKey]: parsed.order }, { id: 'desc' }],
      take: parsed.pageSize,
      skip: (parsed.page - 1) * parsed.pageSize,
    });

    res.json({
      ok: true,
      items,
      total,
      page: parsed.page,
      pageSize: parsed.pageSize,
      sort: parsed.sort,
      order: parsed.order,
    });
  } catch (error: unknown) {
    res.status(400).json(toSafeErrorResponse(error));
  }
});

// GET /api/legal/knowledge/search — publik sökning i kunskapsgrafen med relevans.
router.get('/api/legal/knowledge/search', rateLimitByUser(60, 60_000), async (req, res) => {
  try {
    const parsed = parseListQuery(req.query, {
      sortKeys: KNOWLEDGE_SORT_KEYS,
      defaultSort: 'relevance',
      defaultOrder: 'desc',
      maxPageSize: 100,
    });

    const schema = z.object({
      q: z.string().min(1).max(200),
      nodeTypes: z.string().max(500).optional(),
    });
    const filters = schema.parse({
      q: typeof req.query.q === 'string' ? req.query.q : undefined,
      nodeTypes: typeof req.query.nodeTypes === 'string' ? req.query.nodeTypes : undefined,
    });

    const items = await searchLegalKnowledge({
      q: filters.q,
      take: parsed.pageSize,
      skip: (parsed.page - 1) * parsed.pageSize,
      scope: 'knowledge',
      nodeTypes: filters.nodeTypes ? filters.nodeTypes.split(',').map((s) => s.trim()) : undefined,
    });

    res.json({
      ok: true,
      items,
      page: parsed.page,
      pageSize: parsed.pageSize,
      sort: parsed.sort,
    });
  } catch (error: unknown) {
    res.status(400).json(toSafeErrorResponse(error));
  }
});

// POST /api/legal/ingest/domstol-rss/run — manuell körning av domstols-RSS (admin only).
router.post(
  '/api/legal/ingest/domstol-rss/run',
  requireAuth,
  rateLimitByUser(5, 60_000),
  async (_req, res) => {
    try {
      const result = await ingestDomstolRssFeed();
      res.json({ ok: true, result, ranAt: new Date().toISOString() });
    } catch (error: unknown) {
      res.status(500).json(toSafeErrorResponse(error));
    }
  },
);

export default router;
