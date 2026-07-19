import express from 'express';
import { requireAuth } from '../security/auth';
import { rateLimitByUser } from '../security/rateLimit';
import { prisma } from '../db/prisma';
import { WASTE_CODES } from '../../constants';
import { TEMPLATE_PACKS } from '../../services/projectStructure';
import type { ReferenceMunicipalitySummary } from '../../types';

const router = express.Router();

router.get('/api/reference/waste-codes', requireAuth, rateLimitByUser(60, 60_000), (_req, res) => {
  res.json({
    ok: true,
    state: WASTE_CODES.length > 0 ? 'ready' : 'empty',
    codes: WASTE_CODES,
    checkedAt: new Date().toISOString(),
  });
});

router.get('/api/reference/templates', requireAuth, rateLimitByUser(60, 60_000), (_req, res) => {
  res.json({
    ok: true,
    state: TEMPLATE_PACKS.length > 0 ? 'ready' : 'empty',
    templates: TEMPLATE_PACKS,
    checkedAt: new Date().toISOString(),
  });
});

router.get('/api/reference/receivers', requireAuth, rateLimitByUser(60, 60_000), async (_req, res, next) => {
  try {
    // For now, return empty array as Receiver model is missing from schema
    res.json({
      ok: true,
      state: 'empty',
      receivers: [],
      checkedAt: new Date().toISOString(),
    });
  } catch (error) {
    next(error);
  }
});

// Alias for old UI / smoke test
router.get('/api/receivers', requireAuth, rateLimitByUser(60, 60_000), async (_req, res, next) => {
  try {
    res.json({ ok: true, receivers: [] });
  } catch (error) {
    next(error);
  }
});

router.get('/api/reference/municipalities', requireAuth, rateLimitByUser(60, 60_000), async (req, res, next) => {
  try {
    if (!req.authUser) {
      res.status(401).json({ ok: false, error: 'Unauthorized' });
      return;
    }

    const docs = await prisma.documentRecord.findMany({
      where: {
        organisationId: req.authUser.organisationId,
        municipalityNormalized: {
          not: null,
        },
      },
      select: {
        municipalityNormalized: true,
        municipality: true,
        projectId: true,
      },
      take: 5000,
      orderBy: {
        updatedAt: 'desc',
      },
    });

    const summaryMap = new Map<string, { name: string; projectIds: Set<string>; documentCount: number }>();
    for (const doc of docs) {
      const key = String(doc.municipalityNormalized || doc.municipality || '').trim();
      if (!key) continue;
      const existing = summaryMap.get(key) || {
        name: String(doc.municipality || doc.municipalityNormalized || key).trim(),
        projectIds: new Set<string>(),
        documentCount: 0,
      };
      existing.documentCount += 1;
      if (doc.projectId) existing.projectIds.add(doc.projectId);
      summaryMap.set(key, existing);
    }

    const municipalities: ReferenceMunicipalitySummary[] = Array.from(summaryMap.values())
      .map((item) => ({
        name: item.name,
        projectCount: item.projectIds.size,
        documentCount: item.documentCount,
      }))
      .sort((a, b) => b.documentCount - a.documentCount)
      .slice(0, 50);

    res.json({
      ok: true,
      state: municipalities.length > 0 ? 'ready' : 'empty',
      municipalities,
      checkedAt: new Date().toISOString(),
    });
  } catch (error: unknown) {
    next(error);
  }
});

export default router;
