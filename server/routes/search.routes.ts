import express from 'express';
import { requireAuth } from '../security/auth';
import { rateLimitByUser, rateLimitByOrg } from '../security/rateLimit';
import { toSafeErrorResponse } from '../security/secureErrors';
import { assertPermission } from '../security/projectAccess';
import {
  getSearchConfig,
  runSearchQuery,
  enqueueSearchJob,
  getSearchStatus,
  recoverStaleRunningJobs,
  requeueFailedJobs,
  processSearchJobsOnce,
  runRagSearch,
} from '../modules/search/public';
import { assertProjectMembership } from '../modules/project/public';

const router = express.Router();

function resolveManifestSyncPaths(
  body: unknown,
  config: { manifestPath: string; outlookBaseDir: string },
): { manifestPath: string; outlookBaseDir: string } {
  const payload = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  const manifestPathOverride = payload.manifestPath ? String(payload.manifestPath) : '';
  const outlookBaseDirOverride = payload.outlookBaseDir ? String(payload.outlookBaseDir) : '';

  if ((manifestPathOverride || outlookBaseDirOverride) && process.env.ALLOW_SEARCH_MANIFEST_PATH_OVERRIDE !== 'true') {
    throw new Error('Access denied: manifest path override is disabled');
  }

  return {
    manifestPath: manifestPathOverride || config.manifestPath,
    outlookBaseDir: outlookBaseDirOverride || config.outlookBaseDir,
  };
}

router.post('/api/search/rag', requireAuth, rateLimitByUser(30, 60_000), async (req, res, next) => {
  try {
    const { query, projectId, limit, language, explain } = req.body ?? {};
    if (!query || !projectId) return res.status(400).json({ ok: false, error: 'Missing query or projectId' });
    
    await assertProjectMembership({
       projectId,
       userId: req.authUser!.id,
       organisationId: req.authUser!.organisationId,
       role: req.authUser!.role
    });

    const result = await runRagSearch({ 
      query, 
      projectId, 
      limit, 
      language,
      organisationId: req.authUser!.organisationId,
      explain: explain === true || explain === 'true'
    });
    res.json({ ok: true, ...result });
  } catch (error) {
    next(error);
  }
});

router.get('/api/search/info', requireAuth, rateLimitByUser(60, 60_000), (_req, res) => {
  res.json({
    ok: true,
    info: {
      description: 'Vad är sökbart i dokumentdatabasen',
      modes: [
        {
          id: 'hybrid',
          label: 'Hybrid (rekommenderat)',
          description:
            'Kombinerar semantisk (vektorsökning) med lexikal matchning. Ger bäst precision och recall.',
        },
        {
          id: 'semantic',
          label: 'Semantisk',
          description:
            'Vektorsökning med pgvector. Hittar dokument med liknande innebörd även utan exakta nyckelord.',
        },
        {
          id: 'lexical',
          label: 'Lexikal',
          description: 'Nyckelordsmatchning mot ämne, filnamn och disk-ID. Snabb och deterministisk.',
        },
      ],
      fullTextFields: [
        {
          field: 'content.searchText',
          label: 'Dokumenttext (fulltext)',
          source: 'Extraherad text ur PDF/bild via OCR eller direktextrahering',
          searchable: true,
        },
        {
          field: 'chunks[].chunkText',
          label: 'Textstycken (semantiska chunks)',
          source: 'Dokumentet delas in i ~180-ords-stycken för semantisk sökning',
          searchable: true,
        },
      ],
      metadataFilterFields: [
        {
          field: 'municipality',
          label: 'Kommun',
          type: 'string',
          example: 'Orsa',
          description: 'Exakt matchning (case-insensitive)',
        },
        {
          field: 'decisionType',
          label: 'Ärendetyp / beslutstyp',
          type: 'string',
          example: 'Tillstånd',
          description: 'Typ av miljöbeslut',
        },
        {
          field: 'wasteType',
          label: 'Avfallstyp',
          type: 'string',
          example: 'Schaktmassor',
          description: 'Typ av avfall',
        },
        {
          field: 'legalStatus',
          label: 'Juridisk status',
          type: 'string',
          example: 'Aktiv',
          description: 'Rättslig status för ärendet',
        },
        {
          field: 'hazardousFlag',
          label: 'Farligt avfall',
          type: 'boolean',
          example: true,
          description: 'true = farligt avfall, false = icke-farligt',
        },
        {
          field: 'status',
          label: 'Bearbetningsstatus',
          type: 'enum',
          values: ['METADATA_ONLY', 'TEXT_EXTRACTED', 'CHUNKED', 'EMBEDDED', 'FAILED'],
          description: 'Dokumentets indexeringsstatus',
        },
        {
          field: 'dateFrom / dateTo',
          label: 'Tidsintervall',
          type: 'date',
          example: '2023-01-01',
          description: 'Filtrerar på receivedTime (när ärendet inkom)',
        },
      ],
      lexicalMatchFields: [
        {
          field: 'subject',
          label: 'Ämne / ärendetitel',
          description: 'Rubriken på dokumentet eller e-postmeddelandet',
        },
        {
          field: 'originalName',
          label: 'Originalfilnamn',
          description: 'Det filnamn som lämnades in med ärendet',
        },
        { field: 'diskName', label: 'Diskfilnamn', description: 'Internt unikt filnamn på servern' },
      ],
      queryParameters: {
        query: 'Fritext att söka efter (obligatorisk för semantik/lexikal)',
        mode: 'hybrid | semantic | lexical',
        topK: 'Antal träffar att returnera (1–100, default 20)',
        strictEvidence: 'true = returnera bara dokument med citeringsstöd (default true)',
        projectId: 'Begränsa sökning till ett specifikt projekt (admin kan söka globalt)',
        filters: 'Objekt med metadatafilter (se metadataFilterFields ovan)',
      },
    },
  });
});

router.post(
  '/api/search/sync-manifest',
  requireAuth,
  rateLimitByUser(10, 60_000),
  rateLimitByOrg(120, 60 * 60_000),
  async (req, res) => {
    try {
      if (!req.authUser) {
        res.status(401).json({ ok: false, error: 'Unauthorized' });
        return;
      }

      const projectId = String(req.body?.projectId ?? '');
      if (!projectId) {
        res.status(400).json({ ok: false, error: 'projectId is required' });
        return;
      }

      assertPermission(req.authUser, 'AUDIT_EXPORT');

      await assertProjectMembership({
        projectId,
        userId: req.authUser.id,
        organisationId: req.authUser.organisationId,
        role: req.authUser.role,
      });

      const config = getSearchConfig();
      const { manifestPath, outlookBaseDir } = resolveManifestSyncPaths(req.body, config);

      const job = await enqueueSearchJob({
        type: 'SYNC_MANIFEST',
        projectId,
        payload: {
          projectId,
          organisationId: req.authUser.organisationId,
          manifestPath,
          outlookBaseDir,
        },
      });

      const processedImmediately = await processSearchJobsOnce(1);
      res.json({
        ok: true,
        jobId: job.id,
        processedImmediately,
        config: {
          manifestPath,
          outlookBaseDir,
        },
      });
    } catch (error: unknown) {
      const safe = toSafeErrorResponse(error);
      res.status(safe.statusCode ?? 400).json(safe);
    }
  },
);

router.post(
  '/api/search/query',
  requireAuth,
  rateLimitByUser(80, 60_000),
  rateLimitByOrg(800, 60 * 60_000),
  async (req, res) => {
    try {
      if (!req.authUser) {
        res.status(401).json({ ok: false, error: 'Unauthorized' });
        return;
      }

      const projectIdRaw = String(req.body?.projectId ?? '').trim();
      const projectId = projectIdRaw || undefined;
      const query = String(req.body?.query ?? '');
      const mode = req.body?.mode === 'semantic' || req.body?.mode === 'lexical' ? req.body.mode : 'hybrid';
      const topK = Number(req.body?.topK ?? 20);
      const strictEvidenceRaw = String(req.body?.strictEvidence ?? 'true')
        .trim()
        .toLowerCase();
      const strictEvidence = !['false', '0', 'no'].includes(strictEvidenceRaw);
      const filters = (req.body?.filters ?? {}) as Record<string, unknown>;

      if (projectId) {
        await assertProjectMembership({
          projectId,
          userId: req.authUser.id,
          organisationId: req.authUser.organisationId,
          role: req.authUser.role,
        });
      } else if (req.authUser.role !== 'ADMIN') {
        res.status(400).json({ ok: false, error: 'projectId is required for non-admin users' });
        return;
      }

      const result = await runSearchQuery({
        projectId,
        organisationId: req.authUser.organisationId,
        userId: req.authUser.id,
        query,
        mode,
        topK,
        strictEvidence,
        filters: {
          municipality: typeof filters.municipality === 'string' ? filters.municipality : undefined,
          decisionType: typeof filters.decisionType === 'string' ? filters.decisionType : undefined,
          wasteType: typeof filters.wasteType === 'string' ? filters.wasteType : undefined,
          status: typeof filters.status === 'string' ? filters.status : undefined,
          legalStatus: typeof filters.legalStatus === 'string' ? filters.legalStatus : undefined,
          hazardousFlag: typeof filters.hazardousFlag === 'boolean' ? filters.hazardousFlag : undefined,
          dateFrom: typeof filters.dateFrom === 'string' ? filters.dateFrom : undefined,
          dateTo: typeof filters.dateTo === 'string' ? filters.dateTo : undefined,
        },
      });

      res.json({ ok: true, result });
    } catch (error: unknown) {
      res.status(400).json(toSafeErrorResponse(error));
    }
  },
);

router.get('/api/search/status', requireAuth, rateLimitByUser(30, 60_000), async (req, res) => {
  try {
    if (!req.authUser) {
      res.status(401).json({ ok: false, error: 'Unauthorized' });
      return;
    }

    const projectIdRaw = String(req.query?.projectId ?? '').trim();
    const projectId = projectIdRaw || undefined;

    if (projectId) {
      await assertProjectMembership({
        projectId,
        userId: req.authUser.id,
        organisationId: req.authUser.organisationId,
        role: req.authUser.role,
      });
    } else if (req.authUser.role !== 'ADMIN') {
      res.status(400).json({ ok: false, error: 'projectId is required for non-admin users' });
      return;
    }

    const status = await getSearchStatus(req.authUser.organisationId, projectId);
    res.json({ ok: true, status });
  } catch (error: unknown) {
    res.status(400).json(toSafeErrorResponse(error));
  }
});

router.get('/api/search/status/:projectId', requireAuth, rateLimitByUser(30, 60_000), async (req, res) => {
  try {
    if (!req.authUser) {
      res.status(401).json({ ok: false, error: 'Unauthorized' });
      return;
    }

    const projectId = String(req.params.projectId || '');
    if (!projectId) {
      res.status(400).json({ ok: false, error: 'projectId is required' });
      return;
    }

    await assertProjectMembership({
      projectId,
      userId: req.authUser.id,
      organisationId: req.authUser.organisationId,
      role: req.authUser.role,
    });

    const status = await getSearchStatus(req.authUser.organisationId, projectId);
    res.json({ ok: true, status });
  } catch (error: unknown) {
    res.status(400).json(toSafeErrorResponse(error));
  }
});

router.post('/api/search/recover-stale', requireAuth, rateLimitByUser(6, 60_000), async (req, res) => {
  try {
    if (!req.authUser) {
      res.status(401).json({ ok: false, error: 'Unauthorized' });
      return;
    }

    const projectIdRaw = String(req.body?.projectId ?? '').trim();
    const projectId = projectIdRaw || undefined;
    if (projectId) {
      await assertProjectMembership({
        projectId,
        userId: req.authUser.id,
        organisationId: req.authUser.organisationId,
        role: req.authUser.role,
      });
    } else if (req.authUser.role !== 'ADMIN') {
      res.status(400).json({ ok: false, error: 'projectId is required for non-admin users' });
      return;
    }

    const maxAgeMinutes = Math.max(5, Math.min(24 * 60, Number(req.body?.maxAgeMinutes ?? 30)));
    const limit = Math.max(1, Math.min(1000, Number(req.body?.limit ?? 200)));
    const recovered = await recoverStaleRunningJobs({ projectId, maxAgeMinutes, limit });
    const processedImmediately = await processSearchJobsOnce(2);
    res.json({ ok: true, recovered, processedImmediately });
  } catch (error: unknown) {
    res.status(400).json(toSafeErrorResponse(error));
  }
});

router.post('/api/search/retry-failed', requireAuth, rateLimitByUser(10, 60_000), async (req, res) => {
  try {
    if (!req.authUser) {
      res.status(401).json({ ok: false, error: 'Unauthorized' });
      return;
    }

    const projectId = String(req.body?.projectId ?? '');
    const limit = Number(req.body?.limit ?? 100);
    if (!projectId) {
      res.status(400).json({ ok: false, error: 'projectId is required' });
      return;
    }

    await assertProjectMembership({
      projectId,
      userId: req.authUser.id,
      organisationId: req.authUser.organisationId,
      role: req.authUser.role,
    });

    const requeued = await requeueFailedJobs(projectId, Math.max(1, Math.min(limit, 500)));
    const processedImmediately = await processSearchJobsOnce(2);
    res.json({ ok: true, requeued, processedImmediately });
  } catch (error: unknown) {
    res.status(400).json(toSafeErrorResponse(error));
  }
});

export default router;
