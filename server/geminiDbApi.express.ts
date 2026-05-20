import crypto from 'node:crypto';
import bodyParser from 'body-parser';
import express from 'express';
import {
  getRequirementByCode,
  listRequirementCases,
  listRequirementCitations,
  listRequirementRows,
  type RequirementVerificationStatus,
} from './repositories/requirementsRepository';
import { rateLimitByUser } from './security/rateLimit';
import { requestLogger } from './security/requestLogging';
import { toSafeErrorResponse } from './security/secureErrors';

const router = express.Router();
router.use(bodyParser.json({ limit: '256kb' }));
router.use(requestLogger);

const requirementStatuses: RequirementVerificationStatus[] = ['AUTO', 'REVIEWED', 'VERIFIED', 'REJECTED'];

interface GeminiDbQueryFilters {
  page: number;
  pageSize: number;
  organisationId?: string;
  municipality?: string;
  documentType?: string;
  category?: string;
  caseId?: string;
  requirementCode?: string;
  verificationStatus?: RequirementVerificationStatus;
  includePreliminary: boolean;
}

function firstQueryValue(value: unknown): unknown {
  return Array.isArray(value) ? value[0] : value;
}

function parsePositiveInt(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(firstQueryValue(value));
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(parsed)));
}

function parseBoolean(value: unknown, fallback: boolean = false): boolean {
  if (value == null) return fallback;
  const normalized = String(firstQueryValue(value)).trim().toLowerCase();
  if (['1', 'true', 'yes', 'ja'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'nej'].includes(normalized)) return false;
  return fallback;
}

function parseOptionalText(value: unknown): string | undefined {
  const text = String(firstQueryValue(value) ?? '').trim();
  return text || undefined;
}

function parseOptionalRequirementStatus(value: unknown): RequirementVerificationStatus | undefined {
  const status = parseOptionalText(value);
  if (!status) return undefined;
  return requirementStatuses.includes(status as RequirementVerificationStatus)
    ? (status as RequirementVerificationStatus)
    : undefined;
}

function parseFilters(query: express.Request['query']): GeminiDbQueryFilters {
  return {
    page: parsePositiveInt(query.page, 1, 1, 10_000),
    pageSize: parsePositiveInt(query.pageSize, 50, 1, 200),
    organisationId: parseOptionalText(query.organisationId),
    municipality: parseOptionalText(query.municipality),
    documentType: parseOptionalText(query.documentType),
    category: parseOptionalText(query.category),
    caseId: parseOptionalText(query.caseId),
    requirementCode: parseOptionalText(query.requirementCode),
    verificationStatus: parseOptionalRequirementStatus(query.verificationStatus),
    includePreliminary: parseBoolean(query.includePreliminary, false),
  };
}

function requireOrganisationId(res: express.Response, filters: GeminiDbQueryFilters): string | null {
  if (filters.organisationId) {
    return filters.organisationId;
  }

  res.status(400).json({
    ok: false,
    error: 'organisationId is required for Gemini DB requirement queries.',
  });
  return null;
}

function isLoopbackRequest(req: express.Request): boolean {
  const ip = String(req.ip || '');
  return ip === '::1' || ip === '127.0.0.1' || ip.startsWith('::ffff:127.0.0.1');
}

function allowRemoteGeminiDbAccess(): boolean {
  return (
    String(process.env.GEMINI_DB_ALLOW_REMOTE || '')
      .trim()
      .toLowerCase() === 'true'
  );
}

function getExpectedGeminiDbKey(): string {
  return String(process.env.GEMINI_DB_API_KEY || '').trim();
}

function getProvidedGeminiDbKey(req: express.Request): string {
  const authHeader = req.header('authorization');
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.slice('Bearer '.length).trim();
  }

  const xKeyHeader = req.header('x-gemini-db-key');
  return xKeyHeader?.trim() ?? '';
}

function timingSafeEquals(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, 'utf8');
  const rightBuffer = Buffer.from(right, 'utf8');

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

router.use((req, res, next) => {
  if (!req.path.startsWith('/api/gemini-db')) {
    next();
    return;
  }

  const expectedKey = getExpectedGeminiDbKey();
  if (!expectedKey) {
    res.status(503).json({
      ok: false,
      error: 'Gemini DB API is not configured. Set GEMINI_DB_API_KEY in server env.',
    });
    return;
  }

  if (!allowRemoteGeminiDbAccess() && !isLoopbackRequest(req)) {
    res.status(403).json({
      ok: false,
      error: 'Gemini DB API is restricted to localhost unless GEMINI_DB_ALLOW_REMOTE=true.',
    });
    return;
  }

  const providedKey = getProvidedGeminiDbKey(req);
  if (!providedKey || !timingSafeEquals(providedKey, expectedKey)) {
    res.status(401).json({ ok: false, error: 'Invalid Gemini DB API key' });
    return;
  }

  next();
});

router.use(rateLimitByUser(120, 60_000));

router.get('/api/gemini-db/health', (_req, res) => {
  res.json({
    ok: true,
    readOnly: true,
    remoteAccessEnabled: allowRemoteGeminiDbAccess(),
    endpoints: [
      '/api/gemini-db/requirements/cases',
      '/api/gemini-db/requirements/rows',
      '/api/gemini-db/requirements/rows/:requirementCode',
      '/api/gemini-db/requirements/citations',
    ],
  });
});

router.get('/api/gemini-db/requirements/cases', async (req, res) => {
  try {
    const filters = parseFilters(req.query);
    const organisationId = requireOrganisationId(res, filters);
    if (!organisationId) return;
    const payload = await listRequirementCases({
      page: filters.page,
      pageSize: filters.pageSize,
      organisationId,
      municipality: filters.municipality,
      documentType: filters.documentType,
      verificationStatus: filters.verificationStatus,
    });

    res.json({ ok: true, ...payload, scope: 'READ_ONLY' });
  } catch (error: unknown) {
    res.status(400).json(toSafeErrorResponse(error));
  }
});

router.get('/api/gemini-db/requirements/rows', async (req, res) => {
  try {
    const filters = parseFilters(req.query);
    const organisationId = requireOrganisationId(res, filters);
    if (!organisationId) return;
    const payload = await listRequirementRows({
      page: filters.page,
      pageSize: filters.pageSize,
      organisationId,
      municipality: filters.municipality,
      documentType: filters.documentType,
      category: filters.category,
      caseId: filters.caseId,
      requirementCode: filters.requirementCode,
      verificationStatus: filters.verificationStatus,
      includePreliminary: filters.includePreliminary,
    });

    res.json({
      ok: true,
      ...payload,
      includePreliminary: filters.includePreliminary,
      scope: filters.includePreliminary ? 'ALL' : 'VERIFIED_ONLY',
    });
  } catch (error: unknown) {
    res.status(400).json(toSafeErrorResponse(error));
  }
});

router.get('/api/gemini-db/requirements/rows/:requirementCode', async (req, res) => {
  try {
    const requirementCode = String(req.params.requirementCode || '').trim();
    const organisationId = parseOptionalText(req.query.organisationId);
    if (!requirementCode) {
      res.status(400).json({ ok: false, error: 'requirementCode is required' });
      return;
    }
    if (!organisationId) {
      res.status(400).json({ ok: false, error: 'organisationId is required' });
      return;
    }

    const row = await getRequirementByCode(requirementCode, organisationId);
    if (!row) {
      res.status(404).json({ ok: false, error: 'Requirement not found' });
      return;
    }

    res.json({ ok: true, row, scope: 'READ_ONLY' });
  } catch (error: unknown) {
    res.status(400).json(toSafeErrorResponse(error));
  }
});

router.get('/api/gemini-db/requirements/citations', async (req, res) => {
  try {
    const filters = parseFilters(req.query);
    const organisationId = requireOrganisationId(res, filters);
    if (!organisationId) return;
    const payload = await listRequirementCitations({
      page: filters.page,
      pageSize: filters.pageSize,
      organisationId,
      requirementCode: filters.requirementCode,
      verificationStatus: filters.verificationStatus,
      includePreliminary: filters.includePreliminary,
    });

    res.json({
      ok: true,
      ...payload,
      includePreliminary: filters.includePreliminary,
      scope: filters.includePreliminary ? 'ALL' : 'VERIFIED_ONLY',
    });
  } catch (error: unknown) {
    res.status(400).json(toSafeErrorResponse(error));
  }
});

export default router;
