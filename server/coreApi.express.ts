import { randomUUID } from 'node:crypto';
import express from 'express';
import bodyParser from 'body-parser';
import { z, type ZodTypeAny } from 'zod';
import { getUserFromAccessToken } from './security/auth';
import { rateLimitByUser } from './security/rateLimit';
import {
  classificationRequestSchema,
  classificationResponseSchema,
  complianceRequirementsRequestSchema,
  complianceRequirementsResponseSchema,
  documentExportRequestSchema,
  labValidateRequestSchema,
  labValidateResponseSchema,
  permitGenerateRequestSchema,
  permitGenerateResponseSchema,
  riskAnalysisRequestSchema,
  riskAnalysisResponseSchema,
  verificationCheckRequestSchema,
  verificationCheckResponseSchema,
} from './schemas/coreSchemas';
import {
  analyzeRisk,
  classifyActivity,
  generatePermitDraft,
  getComplianceRequirements,
  validateLabResults,
  verifyAnalysis,
} from './services/coreContractService';
import { buildPermitDocxBuffer } from './services/permitDocxExportService';
import { appendAuditLog } from '../services/auditLogService';
import { runSearchQuery } from './services/searchService';
import { assertProjectMembership } from './repositories/projectAccessRepository';
import { getMunicipalityInsight } from './services/municipalityService';
import { prisma } from './db/prisma';

async function getRagCitations(input: {
  projectId: string;
  organisationId: string;
  userId: string;
  query: string;
  topK?: number;
}) {
  const raw = await runSearchQuery({
    ...input,
    mode: 'hybrid',
    topK: input.topK || 5,
    strictEvidence: false,
  });

  const docIds = raw.results.map((r) => r.documentId);
  const metaRows =
    docIds.length > 0
      ? await prisma.documentRecord.findMany({
          where: { id: { in: docIds } },
          select: { id: true, municipalityNormalized: true },
        })
      : [];
  const metaByDocId = new Map(metaRows.map((r) => [r.id, r]));

  return raw.results.map((r) => ({
    source: `DocumentRecord:${r.documentId}`,
    snippet: (r.snippet || r.citations[0]?.quote || '').slice(0, 300),
    municipality: metaByDocId.get(r.documentId)?.municipalityNormalized || r.metadata.municipality || null,
    documentId: r.documentId,
  }));
}

type ApiErrorStatus = 400 | 401 | 403 | 404 | 500;

const router = express.Router();
router.use(bodyParser.json({ limit: '5mb' }));

router.use((_req, res, next) => {
  const traceId = randomUUID();
  res.locals.traceId = traceId;
  res.setHeader('X-Trace-Id', traceId);
  next();
});

function traceIdOf(res: express.Response): string {
  return String(res.locals.traceId || randomUUID());
}

function sendError(
  res: express.Response,
  status: ApiErrorStatus,
  code: string,
  message: string,
  details?: unknown,
) {
  const traceId = traceIdOf(res);
  res.status(status).json({
    ok: false,
    traceId,
    error: {
      code,
      message,
      details: process.env.NODE_ENV === 'production' ? undefined : (details ?? null),
    },
  });
}

function parseInput<TSchema extends ZodTypeAny>(
  res: express.Response,
  schema: TSchema,
  body: unknown,
): z.infer<TSchema> | null {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    sendError(res, 400, 'VALIDATION_ERROR', 'Request body is invalid.', parsed.error.issues);
    return null;
  }
  return parsed.data;
}

function sendValidatedOutput(res: express.Response, schema: ZodTypeAny, payload: unknown) {
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    sendError(res, 500, 'RESPONSE_SCHEMA_ERROR', 'Internal response validation failed.', parsed.error.issues);
    return;
  }
  res.json(parsed.data);
}

router.get('/api/v1/municipality/:name/insight', async (req, res) => {
  try {
    const insight = await getMunicipalityInsight(req.params.name);
    res.json({ ok: true, insight });
  } catch (error) {
    sendError(res, 500, 'INSIGHT_FAILED', 'Could not fetch municipality insight.', String(error));
  }
});

const requireCoreAuth = async (req: any, res: express.Response, next: express.NextFunction) => {
  const authHeader = String(req.headers.authorization || '');
  if (!authHeader.startsWith('Bearer ')) {
    sendError(res, 401, 'AUTH_MISSING', 'Missing bearer token.');
    return;
  }

  try {
    const token = authHeader.slice('Bearer '.length).trim();
    req.authUser = await getUserFromAccessToken(token);
    if (!req.authUser || !['ADMIN', 'CONSULTANT'].includes(req.authUser.role)) {
      sendError(res, 403, 'AUTH_FORBIDDEN', 'Insufficient role.');
      return;
    }
    next();
  } catch {
    sendError(res, 401, 'AUTH_INVALID', 'Invalid bearer token.');
  }
};

router.use('/api/v1', (req, res, next) => {
  // Add trace ID and other common middlewares here if needed
  next();
});

// rateLimit managed per route or globally for this router
const coreRateLimit = rateLimitByUser(60, 60_000);

// DB-backed classification with RAG citations (distinct from /classification/activity)
router.get('/api/v1/projects', requireCoreAuth, coreRateLimit, async (req, res) => {
  try {
    const memberships = await prisma.projectMember.findMany({
      where: {
        userId: req.authUser.id,
        project: {
          organisationId: req.authUser.organisationId,
          status: 'ACTIVE',
        },
      },
      select: {
        project: {
          select: {
            id: true,
            propertyDesignation: true,
            status: true,
            documents: {
              select: {
                municipalityNormalized: true,
                decisionType: true,
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    const projects = memberships.map(({ project }) => {
      const docCount = project.documents.length;
      const municipalityCoverage =
        docCount === 0
          ? 0
          : Math.round(
              (project.documents.filter((document) => Boolean(document.municipalityNormalized)).length /
                docCount) *
                100,
            );
      const decisionTypeCoverage =
        docCount === 0
          ? 0
          : Math.round(
              (project.documents.filter((document) => Boolean(document.decisionType)).length / docCount) *
                100,
            );

      return {
        id: project.id,
        propertyDesignation: project.propertyDesignation,
        status: project.status,
        docCount,
        coverage: {
          municipality: municipalityCoverage,
          decisionType: decisionTypeCoverage,
        },
      };
    });

    res.json({ ok: true, projects });
  } catch (error) {
    sendError(res, 500, 'PROJECT_LIST_FAILED', 'Could not load projects.', String(error));
  }
});

router.get('/api/v1/projects/:projectId/search', requireCoreAuth, coreRateLimit, async (req, res) => {
  const projectId = String(req.params.projectId || '').trim();
  const query = String(req.query.q || '').trim();
  const topK = Math.max(1, Math.min(20, Number(req.query.topK || 6)));

  if (!projectId) {
    sendError(res, 400, 'PROJECT_ID_REQUIRED', 'projectId is required.');
    return;
  }

  if (!query) {
    sendError(res, 400, 'QUERY_REQUIRED', 'Search query is required.');
    return;
  }

  try {
    await assertProjectMembership({
      projectId,
      userId: req.authUser.id,
      organisationId: req.authUser.organisationId,
      role: req.authUser.role,
    });
  } catch {
    sendError(res, 403, 'PROJECT_ACCESS_DENIED', 'Project access denied.');
    return;
  }

  try {
    const response = await runSearchQuery({
      projectId,
      organisationId: req.authUser.organisationId,
      userId: req.authUser.id,
      query,
      mode: 'hybrid',
      topK,
      strictEvidence: false,
    });

    const results = response.results.map((result) => ({
      id: result.documentId,
      originalName: result.metadata.originalName || '',
      subject: result.metadata.subject || result.metadata.originalName || 'Dokument',
      municipality: result.metadata.municipality || '',
      decisionType: result.metadata.decisionType || '',
      snippet: result.snippet || result.citations[0]?.quote || '',
      score: result.score,
    }));

    res.json({ ok: true, results });
  } catch (error) {
    sendError(res, 500, 'PROJECT_SEARCH_FAILED', 'Could not search project documents.', String(error));
  }
});

router.post('/api/v1/classification', requireCoreAuth, coreRateLimit, async (req, res) => {
  const body = req.body as {
    projectId?: string;
    documentId?: string;
    ewcCode?: string;
    volumeTon?: number;
    hazardous?: boolean;
    municipality?: string;
    activityCode?: string;
  };

  const projectId = body.projectId || '';
  const documentId = body.documentId || '';
  const traceId = traceIdOf(res);

  // Look up document/project context from DB
  let dbMunicipality: string | null = body.municipality || null;
  let dbDecisionType: string | null = null;
  let dbWasteType: string | null = null;
  let dbActivityCode: string | null = body.activityCode || null;
  let subject = '';

  try {
    if (documentId) {
      const doc = await prisma.documentRecord.findUnique({
        where: { id: documentId },
        select: {
          municipalityNormalized: true,
          decisionType: true,
          wasteType: true,
          activityCode: true,
          subject: true,
          metadataReviewStatus: true,
          municipalityConfidence: true,
        },
      });
      if (doc) {
        dbMunicipality = doc.municipalityNormalized ?? dbMunicipality;
        dbDecisionType = doc.decisionType;
        dbWasteType = doc.wasteType;
        dbActivityCode = doc.activityCode ?? dbActivityCode;
        subject = doc.subject;
      }
    } else if (projectId) {
      // Majority vote on municipality across project documents
      const majorityCounts = await prisma.$queryRawUnsafe<
        Array<{ municipalityNormalized: string; cnt: bigint }>
      >(
        `SELECT "municipalityNormalized", COUNT(*) AS cnt
         FROM "DocumentRecord"
         WHERE "projectId" = $1 AND "municipalityNormalized" IS NOT NULL
         GROUP BY "municipalityNormalized" ORDER BY cnt DESC LIMIT 1;`,
        projectId,
      );
      dbMunicipality = majorityCounts[0]?.municipalityNormalized ?? dbMunicipality;
    }
  } catch {
    /* proceed with body values */
  }

  // Rule-engine classification (existing deterministic logic)
  const actCode = dbActivityCode || '90.40'; // default to common waste handling
  const ewcCode = body.ewcCode || '';
  const volTon = Number(body.volumeTon || 0);

  const ruleResult = classifyActivity(
    { activity_code: actCode, ewc_code: ewcCode, volume_tons: volTon },
    traceId,
  );

  // RAG citations from real documents
  const ragQuery =
    [subject, ewcCode ? `EWC ${ewcCode}` : '', dbWasteType || '', dbActivityCode || actCode]
      .filter(Boolean)
      .join(' ') || 'avfallshantering mellanlagring';

  let citations: Array<{ source: string; snippet: string; municipality: string | null; documentId: string }> =
    [];
  if (projectId) {
    try {
      citations = await getRagCitations({
        projectId,
        organisationId: req.authUser?.organisationId || '',
        userId: req.authUser?.id || 'anonymous',
        query: ragQuery,
        topK: 4,
      });
    } catch {
      /* non-fatal */
    }
  }

  // Determine missing fields
  const missingFields: string[] = [];
  if (!dbMunicipality) missingFields.push('municipality');
  if (!dbWasteType) missingFields.push('wasteType');
  if (volTon === 0) missingFields.push('volumeTon');
  if (!dbActivityCode && actCode === '90.40') missingFields.push('activityCode');

  const confidence = Math.max(0.5, 0.95 - missingFields.length * 0.08 - (citations.length === 0 ? 0.05 : 0));
  const riskLevel =
    body.hazardous || (ewcCode && ewcCode.includes('*'))
      ? 'HIGH'
      : dbDecisionType?.toLowerCase().includes('föreläggande')
        ? 'MEDIUM'
        : 'LOW';

  appendAuditLog({
    userId: req.authUser?.id || 'anonymous',
    actionType: 'RULE_ENGINE_EVALUATION',
    modelVersions: ['RuleEngine-1.1', 'RAGCitations-1.0'],
    promptOrInput: body,
    ragDocumentsUsed: citations.map((c) => c.documentId),
    responseOrOutput: { classification: ruleResult.classification },
    verificationStatus: 'UNVERIFIED',
  });

  res.json({
    ok: true,
    traceId,
    classification: ruleResult.classification,
    wasteType: dbWasteType,
    suggestedCode: dbActivityCode || actCode,
    riskLevel,
    confidence: Number(confidence.toFixed(2)),
    missingFields,
    legalBasis: ruleResult.legal_basis,
    municipality: dbMunicipality,
    decisionType: dbDecisionType,
    citations: citations.map((c) => ({ source: c.source, snippet: c.snippet, municipality: c.municipality })),
    watermark: 'AUTO - MANUELL GRANSKNING KRÄVS',
  });
});

// ─── Legacy rule-engine classification (deterministic, no DB) ──────────────
router.post('/api/v1/classification/activity', requireCoreAuth, coreRateLimit, (req, res) => {
  const input = parseInput(res, classificationRequestSchema, req.body);
  if (!input) return;
  const traceId = traceIdOf(res);

  const result = classifyActivity(input, traceId);

  appendAuditLog({
    userId: req.authUser?.id || 'anonymous',
    actionType: 'RULE_ENGINE_EVALUATION',
    modelVersions: ['RuleEngine-1.1'],
    promptOrInput: input,
    ragDocumentsUsed: [],
    responseOrOutput: result,
    verificationStatus: 'VERIFIED',
  });

  sendValidatedOutput(res, classificationResponseSchema, result);
});

router.post('/api/v1/compliance/requirements', requireCoreAuth, coreRateLimit, async (req, res) => {
  const input = parseInput(res, complianceRequirementsRequestSchema, req.body);
  if (!input) return;
  const traceId = traceIdOf(res);

  try {
    const result = await getComplianceRequirements(input, traceId, req.authUser?.organisationId);
    sendValidatedOutput(res, complianceRequirementsResponseSchema, result);
  } catch (error) {
    sendError(
      res,
      500,
      'REQUIREMENTS_LOOKUP_FAILED',
      'Could not fetch compliance requirements.',
      String(error),
    );
  }
});

router.post('/api/v1/compliance/risk-analysis', requireCoreAuth, coreRateLimit, (req, res) => {
  const input = parseInput(res, riskAnalysisRequestSchema, req.body);
  if (!input) return;
  const traceId = traceIdOf(res);

  const result = analyzeRisk(input, traceId);
  sendValidatedOutput(res, riskAnalysisResponseSchema, result);
});

router.post('/api/v1/lab/validate', requireCoreAuth, coreRateLimit, (req, res) => {
  const input = parseInput(res, labValidateRequestSchema, req.body);
  if (!input) return;
  const traceId = traceIdOf(res);

  const result = validateLabResults(input, traceId);
  sendValidatedOutput(res, labValidateResponseSchema, result);
});

router.post('/api/v1/permit/generate', requireCoreAuth, coreRateLimit, async (req, res) => {
  const input = parseInput(res, permitGenerateRequestSchema, req.body);
  if (!input) return;
  try {
    const traceId = traceIdOf(res);
    const result = await generatePermitDraft(input, traceId);

    appendAuditLog({
      userId: req.authUser?.id || 'anonymous',
      actionType: 'DOCUMENT_GENERATION',
      modelVersions: ['GeminiPrimary+TemplateFallback'],
      promptOrInput: input,
      ragDocumentsUsed: [],
      responseOrOutput: { document_type: result.document_type },
      verificationStatus: 'UNVERIFIED',
    });

    sendValidatedOutput(res, permitGenerateResponseSchema, result);
  } catch (error) {
    sendError(res, 500, 'PERMIT_GENERATION_FAILED', 'Could not generate permit draft.', String(error));
  }
});

router.post('/api/v1/verification/check', requireCoreAuth, coreRateLimit, async (req, res) => {
  const input = parseInput(res, verificationCheckRequestSchema, req.body);
  if (!input) return;
  try {
    const traceId = traceIdOf(res);
    const result = await verifyAnalysis(input, traceId);
    sendValidatedOutput(res, verificationCheckResponseSchema, result);
  } catch (error) {
    sendError(res, 500, 'VERIFICATION_FAILED', 'Could not verify analysis.', String(error));
  }
});

router.post('/api/v1/document/export', requireCoreAuth, coreRateLimit, async (req, res) => {
  const input = parseInput(res, documentExportRequestSchema, req.body);
  if (!input) return;
  const traceId = traceIdOf(res);

  try {
    const buffer = await buildPermitDocxBuffer({
      documentType: input.document_type,
      draftText: input.draft_text,
    });
    const normalizedDocType = input.document_type.replace(/\s+/g, '_');
    const filename = `${normalizedDocType}_${Date.now()}.docx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('X-Trace-Id', traceId);
    res.status(200).send(buffer);
  } catch (error) {
    sendError(res, 500, 'DOCX_EXPORT_FAILED', 'Could not export DOCX document.', String(error));
  }
});

// ─── ADMIN ENDPOINTS: Metadata Review Queue ──────────────────────────────

router.get('/api/v1/admin/review-queue', requireCoreAuth, coreRateLimit, async (req, res) => {
  try {
    const queue = await prisma.metadataReviewQueue.findMany({
      where: { status: 'OPEN' },
      include: {
        document: {
          select: {
            id: true,
            subject: true,
            absolutePath: true,
            municipalityNormalized: true,
            legalStatus: true,
            decisionType: true,
            activityCode: true,
            wasteType: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    res.json({ ok: true, queue });
  } catch (error) {
    sendError(res, 500, 'QUEUE_FETCH_FAILED', 'Could not fetch review queue.', String(error));
  }
});

router.post(
  '/api/v1/admin/review-queue/clear-proposals',
  requireCoreAuth,
  coreRateLimit,
  async (req, res) => {
    const ids = Array.isArray(req.body?.ids)
      ? req.body.ids.filter(
          (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0,
        )
      : [];

    if (ids.length === 0) {
      sendError(res, 400, 'IDS_REQUIRED', 'At least one review queue id is required.');
      return;
    }

    try {
      const result = await prisma.metadataReviewQueue.updateMany({
        where: {
          id: { in: ids.slice(0, 100) },
          status: 'OPEN',
        },
        data: {
          proposedValue: null,
        },
      });

      res.json({ ok: true, cleared: result.count });
    } catch (error) {
      sendError(res, 500, 'CLEAR_PROPOSALS_FAILED', 'Could not clear proposed values.', String(error));
    }
  },
);

router.post('/api/v1/admin/review-queue/:id/resolve', requireCoreAuth, coreRateLimit, async (req, res) => {
  const id = req.params['id'] as string;
  const { action, value } = req.body as { action: 'APPROVE' | 'REJECT' | 'CLEAR_PROPOSAL'; value?: string };

  try {
    const item = await prisma.metadataReviewQueue.findUnique({
      where: { id },
      include: { document: true },
    });

    if (!item) {
      sendError(res, 404, 'ITEM_NOT_FOUND', 'Review item not found.');
      return;
    }

    if (action === 'CLEAR_PROPOSAL') {
      await prisma.metadataReviewQueue.update({
        where: { id },
        data: {
          proposedValue: null,
        },
      });
    } else if (action === 'APPROVE') {
      const finalValue = value !== undefined ? value : item.proposedValue;
      const fieldName = item.fieldName;

      // Map field names to DB columns
      const updateData: Record<string, unknown> = {
        updatedAt: new Date(),
        metadataReviewStatus: 'LOCKED', // Mark as manually verified
      };

      if (fieldName === 'municipality') {
        updateData.municipality = finalValue;
        updateData.municipalityRaw = finalValue;
        updateData.municipalityNormalized = finalValue; // Simplified for Core
        updateData.municipalityConfidence = 1.0;
        updateData.municipalitySource = 'manual_review';
      } else if (fieldName === 'legalStatus') {
        updateData.legalStatus = finalValue;
        updateData.diarieConfidence = 1.0;
        updateData.diarieSource = 'manual_review';
      } else {
        updateData[fieldName] = finalValue;
        updateData[`${fieldName}Confidence`] = 1.0;
        updateData[`${fieldName}Source`] = 'manual_review';
      }

      await prisma.$transaction([
        prisma.documentRecord.update({
          where: { id: item.documentId },
          data: updateData,
        }),
        prisma.metadataReviewQueue.update({
          where: { id },
          data: {
            status: 'APPROVED',
            reviewedAt: new Date(),
            reviewedBy: req.authUser?.id || 'admin',
          },
        }),
      ]);
    } else {
      await prisma.metadataReviewQueue.update({
        where: { id },
        data: {
          status: 'REJECTED',
          reviewedAt: new Date(),
          reviewedBy: req.authUser?.id || 'admin',
        },
      });
    }

    res.json({ ok: true });
  } catch (error) {
    sendError(res, 500, 'RESOLVE_FAILED', 'Could not resolve review item.', String(error));
  }
});

export default router;
