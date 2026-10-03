/**
 * API Routes for Localization Studies (Lokaliseringsutredning)
 */

import express from 'express';
import { prisma } from '../db/prisma';
import { requireAuth } from '../security/auth';
import { rateLimitByUser } from '../security/rateLimit';
import { toSafeErrorResponse } from '../security/secureErrors';
import { assertProjectAccess } from '../security/projectAccess';
import {
  buildLocalizationPdfData,
  fetchLocalizationAuditTrail,
  LocalizationDataUnavailableError,
  runLocalizationReport,
  resolveLuViewerPresentation,
  resolveCurrentLuAssessmentSummary,
  exportCurrentLuAssessmentPdf,
  verifyCurrentLuAssessment,
  generateLocalizationReportLegacy,
  listProjectsForProperty,
  createLocalizationProject,
  enqueueProjectContextBootstrapRequest,
  getBootstrapRequestStatusForProject,
  saveUserLocalizationGeometry,
  getCurrentLocalizationGeometryForProject,
  retryLocalizationIdentityProvisioning,
  ensureViewerCapabilityProvisioningEnqueuedForCompletedBootstrap,
  ASSESSMENT_RECORD_INTEGRITY_CODE,
  recordIntegrityDiagnosticWire,
  assertVerifyBootstrapFlagGate,
  verifyAnswerFields,
  type SiteAlternative,
} from '../modules/localization/public';
import { logger } from '../logger';
import { isPersistentStorageFault, retrySentenceSv } from '../modules/localization/storageFaultClassification';
import {
  classifyReadFault,
  isReadFaultClass,
  LuReadFaultError,
  projectAccessFailure,
  readFaultHttpStatus,
  readFaultOfClass,
  readFaultSentenceSv,
} from '../modules/localization/readFaultClassification';
import { presentBootstrapRequestStatus } from '../modules/localization/bootstrapFailurePresentation';

const router = express.Router();

/**
 * W-U20CDF6 (UI1 limit 1; the UI shows "Försök igen" ONLY on the server's `retryable: true`, and an answer without the
 * flag loses the button) -- EVERY failure answer on the LU routes carries `retryable` explicitly, derived from its
 * class with the shared classification (readFaultClassification.ts; no second classification):
 *  - an answer that states it keeps it (the typed fail-closed answers, the explicit plain ones below);
 *  - a failureClass of the shared read-fault classes: that class's own flag (READ_ERROR true, every other false);
 *  - otherwise by what the answer is: 429 (the rate limit's window) is transient -> true; any other 4xx -- a bad
 *    request, missing or failed authentication, a denial, an absence, a refusal, an integrity break -> false;
 *  - a sanitized 5xx (the app's error handler, after `next(error)`): the class of the error a route caught
 *    (classifyReadFault, read phase: an unknown error while reading is READ_ERROR -> true, a lasting storage fault,
 *    an artifact that must exist but is missing or a refusal -> false); false on a POST that creates, moves or writes
 *    something (localization-projects, bootstrap-retry, geometry, geometry-identity-retry, and -- W-TEXT2 (3; U6-4) --
 *    generate-report and generate-pdf-data, which run the report that persists an assessment): a repeat after an
 *    unknown failure could act twice, so nothing is promised there; and -- W-TEXT2 (3; U6-4) -- false on a 5xx the
 *    router did not catch at all (no flag, no class, no caught error): fail closed, nothing is promised.
 * The middleware below applies this to every JSON answer of /api/localization/* -- also the ones written by the
 * middleware in the route chain (requireAuth 401, rateLimitByUser 429) and by the app's error handler. It is scoped
 * to this router's paths; CSRF (mounted in createApp before this router) is outside it and states its own
 * `retryable: false` (server/security/csrf.ts).
 */
const LU_ERROR_KEY = 'luCaughtError';
const NON_REPEATABLE_POST =
  /^\/api\/localization\/(?:localization-projects|generate-report|generate-pdf-data|[^/]+\/(?:bootstrap-retry|geometry|geometry-identity-retry))$/;

export function luFailureRetryable(input: {
  readonly method: string;
  readonly path: string;
  readonly status: number;
  readonly body: Readonly<Record<string, unknown>>;
  readonly caughtError?: unknown;
}): boolean {
  if (typeof input.body.retryable === 'boolean') return input.body.retryable;
  if (isReadFaultClass(input.body.failureClass)) return readFaultOfClass(input.body.failureClass).retryable;
  if (input.status === 429) return readFaultOfClass('READ_ERROR').retryable;
  if (input.status < 500) return false;
  if (input.method.toLowerCase() === 'post' && NON_REPEATABLE_POST.test(input.path)) return false;
  // W-TEXT2 (3; U6-4): a 5xx the router did not catch has no class to derive from -- fail closed.
  if (input.caughtError === undefined) return false;
  return classifyReadFault(input.caughtError, 'read').retryable;
}

function luAnswersCarryRetryable(req: express.Request, res: express.Response, next: express.NextFunction): void {
  const json = res.json.bind(res);
  res.json = ((body: unknown) => {
    if (res.statusCode >= 400 && body && typeof body === 'object' && !Array.isArray(body) && typeof (body as { retryable?: unknown }).retryable !== 'boolean') {
      const record = body as Record<string, unknown>;
      return json({
        ...record,
        retryable: luFailureRetryable({
          method: req.method,
          path: req.originalUrl.split('?')[0] ?? req.path,
          status: res.statusCode,
          body: record,
          caughtError: res.locals[LU_ERROR_KEY],
        }),
      });
    }
    return json(body);
  }) as typeof res.json;
  next();
}

/** W-U20CDF6: the error a route hands on to the app's error handler -- its class decides the sanitized answer's retryable. */
function keepCaughtError(res: express.Response, error: unknown): void {
  res.locals[LU_ERROR_KEY] = error;
}

router.use('/api/localization', luAnswersCarryRetryable);

/**
 * DEMO M1a / D9(a): every `{ ok: false }` service result goes out through here, so a fail-closed
 * localization-geometry currentness failure keeps its structured class (code / failureClass /
 * reasonCode) on the wire instead of being reduced to a message string. Other failures are unchanged.
 * OD-R3: a result that states whether it is `retryable` keeps that flag too (a configuration error is
 * technical but not retryable).
 */
function failureBody(result: { readonly error: string; readonly status?: number }): Record<string, unknown> {
  const structured = result as { code?: string; failureClass?: string; reasonCode?: string; retryable?: unknown; record_integrity?: unknown };
  // U20CDF4 (owner decision 2026-10-03 (4) point 1): the 424 for a record integrity error keeps the
  // stored findings in view -- only as the whitelisted, non-authoritative diagnostic, rebuilt field by
  // field (recordIntegrityDiagnosticWire), never the stored record or any of its free text.
  const recordIntegrity =
    structured.code === ASSESSMENT_RECORD_INTEGRITY_CODE ? recordIntegrityDiagnosticWire(structured.record_integrity) : null;
  return {
    ok: false,
    error: result.error,
    ...(structured.code ? { code: structured.code, failureClass: structured.failureClass, reasonCode: structured.reasonCode } : {}),
    // W-U20CDF6 (UI1 limit 1): the answer's own flag, coded or not; an answer without one gets the derived flag from
    // luAnswersCarryRetryable (every failure answer of this router carries it).
    ...(typeof structured.retryable === 'boolean' ? { retryable: structured.retryable } : {}),
    ...(recordIntegrity ? { record_integrity: recordIntegrity } : {}),
  };
}

/**
 * U20-D: the optional explicit assessment id for export/verify. Absent -> unchanged behaviour (the
 * project's current assessment). Present -> must be one well-formed artifact id; the orchestrator
 * then refuses (409 ASSESSMENT_ID_MISMATCH) unless it is exactly the current, verified assessment.
 */
function optionalAssessmentArtifactId(raw: unknown): { ok: true; value: string | undefined } | { ok: false } {
  if (raw === undefined || raw === null || raw === '') return { ok: true, value: undefined };
  if (typeof raw !== 'string' || raw.length > 200 || !/^[A-Za-z0-9._:-]+$/.test(raw)) return { ok: false };
  return { ok: true, value: raw };
}

function invalidAssessmentId(res: express.Response): void {
  res.status(400).json({
    ok: false,
    error: 'assessmentArtifactId must be a single artifact id.',
    code: 'INVALID_ASSESSMENT_ARTIFACT_ID',
    // W-U20CDF6: a bad request answers the same when repeated.
    retryable: false,
  });
}

/**
 * U20CDF2 (coordinator add-on 1; OD-R2, U30-R3 K1): packages/mps-lu's LuReExecutionStorageError is
 * recognized by its stable code (it is deliberately not exported from the package root). A storage
 * fault met while re-executing is a technical error, never a verification verdict and never a
 * generic 500.
 */
const LU_REEXECUTION_STORAGE_FAULT = 'LU_REEXECUTION_STORAGE_FAULT';

function isReExecutionStorageFault(error: unknown): error is { code: string; stage?: unknown; cause?: unknown } {
  return Boolean(error) && typeof error === 'object' && (error as { code?: unknown }).code === LU_REEXECUTION_STORAGE_FAULT;
}

/**
 * W-PLUMB-S (U30R6-REPORT K5; U30R5-VERIFICATION finding 4): packages/mps-lu's LuBootstrapAdmitFlagOutsideTestError --
 * MPS_LU_BOOTSTRAP_ADMIT set in a process that is not an explicit test process -- is recognized by its stable code (the
 * class is deliberately not exported). A configuration error of the PROCESS: never a verification outcome, never a
 * statement about the assessment, never retryable; a fixed Swedish text without any environment value.
 */
const BOOTSTRAP_ADMIT_FLAG_OUTSIDE_TEST = 'BOOTSTRAP_ADMIT_FLAG_OUTSIDE_TEST';

function isBootstrapAdmitFlagOutsideTest(error: unknown): error is { code: string; gate?: unknown } {
  return Boolean(error) && typeof error === 'object' && (error as { code?: unknown }).code === BOOTSTRAP_ADMIT_FLAG_OUTSIDE_TEST;
}

function bootstrapAdmitFlagOutsideTestBody(error: { gate?: unknown }): Record<string, unknown> {
  // W-T1TEXT (T1-WORDING-AUDIT top 6): the check is a reproducibility check, never a "verification"; the code is unchanged.
  const lead = error.gate === 'reexecution' ? 'Reproducerbarhetskontrollen kunde inte genomföras' : 'Begäran kunde inte genomföras';
  return {
    ok: false,
    error:
      `${lead}: servern har ett konfigurationsfel (en flagga som bara får vara satt i en uttrycklig testprocess är satt). ` +
      `Det är inget kontrollutfall och inget fel i bedömningen. ${retrySentenceSv(false)}`,
    code: BOOTSTRAP_ADMIT_FLAG_OUTSIDE_TEST,
    retryable: false,
  };
}

/**
 * W-PLUMB-S (U30R5-VERIFICATION finding 4): the verify route's bootstrap-flag gate, FIRST in its chain -- before
 * authentication (whose token check reads the database) and before verify reads the project access, the projection or
 * CAS -- so the flag outside an explicit test process is always the typed 503 configuration error, never a 401/404/409/424
 * a read would have given. The package's own rule (assertBootstrapAdmitFlagOnlyInExplicitTestProcess, gate
 * "reexecution"); not the server's start-up gate (U40-2).
 */
function refuseVerifyWithBootstrapFlagOutsideTest(_req: express.Request, res: express.Response, next: express.NextFunction): void {
  try {
    assertVerifyBootstrapFlagGate();
  } catch (error) {
    if (handleOrchestratorError(error, res)) return;
    keepCaughtError(res, error);
    next(error);
    return;
  }
  next();
}

function handleOrchestratorError(error: unknown, res: express.Response): boolean {
  if (isBootstrapAdmitFlagOutsideTest(error)) {
    res.status(503).json(bootstrapAdmitFlagOutsideTestBody(error));
    return true;
  }
  if (error instanceof LocalizationDataUnavailableError) {
    res.status(503).json({
      ok: false,
      error: error.message,
      code: error.code,
      // W-U20CDF6 (UI1 limit 1): the class's flag (data sources unavailable for now: READ_ERROR, retryable).
      retryable: error.retryable,
    });
    return true;
  }
  if (isReExecutionStorageFault(error)) {
    // Only stable codes leave the server: the stage of the replay chain and whether a retry can help
    // (a lasting fault -- object gone, torn index, corrupt bytes -- is not retryable).
    const stage = typeof error.stage === 'string' && /^[a-z_]{1,40}$/.test(error.stage) ? error.stage : 'okänt';
    const retryable = !isPersistentStorageFault(error.cause);
    res.status(503).json({
      ok: false,
      error:
        // W-T1TEXT (T1-WORDING-AUDIT top 6): a reproducibility check, never a "verification"; the code is unchanged.
        `Reproducerbarhetskontrollen kunde inte genomföras: ett tekniskt lagringsfel uppstod vid återexekveringen (steg: ${stage}). ` +
        `Det är inget kontrollutfall. ${retrySentenceSv(retryable)}`,
      code: LU_REEXECUTION_STORAGE_FAULT,
      failureClass: 'REEXECUTION_STORAGE_FAULT',
      reasonCode: stage.toUpperCase(),
      retryable,
    });
    return true;
  }
  return false;
}

/** W-CATCH2 #13: the governed viewer's capability (or the binding it needs) could not be read or verified. */
const VIEWER_CAPABILITY_UNRESOLVED = 'VIEWER_CAPABILITY_UNRESOLVED';

const VIEWER_READ_FAULT_SUBJECT_SV: Readonly<Record<string, string>> = {
  'viewer-capability': 'Kartvisningens behörighet (kapabilitet)',
  'current-binding': 'Projektets koppling till fastigheten',
};

/**
 * W-CATCH2 #13 (OD-R1/OD-R2): a capability that could not be read or verified -- or the current binding
 * it is bound to -- is never "not configured" (404) and never a generic 500: 503 (retryable only for a
 * read error) or 409 for a refusal, with the shared class and a Swedish text. The fault stays
 * server-side; the reasonCode is the refusal token or the subject, never free text.
 */
function viewerCapabilityReadFaultBody(error: LuReadFaultError): Record<string, unknown> {
  const subjectSv = VIEWER_READ_FAULT_SUBJECT_SV[error.subject] ?? 'Kartvisningens underlag';
  return {
    ok: false,
    error: `${readFaultSentenceSv(error, subjectSv)} Kartan kan inte visa kontrollresultaten. Ingen annan behörighet används i dess ställe.`,
    code: VIEWER_CAPABILITY_UNRESOLVED,
    failureClass: error.faultClass,
    reasonCode: error.refusalCode ?? error.subject.toUpperCase().replace(/-/g, '_'),
    retryable: error.retryable,
  };
}

/**
 * POST /api/localization/generate-report
 */
router.post(
  '/api/localization/generate-report',
  requireAuth,
  rateLimitByUser(30, 60_000),
  async (req, res, next) => {
    try {
      const result = await runLocalizationReport({
        authUser: req.authUser!,
        projectId: String(req.body?.projectId || ''),
        siteAlternatives: req.body?.siteAlternatives,
      });
      if (result.ok === false) {
        res.status(result.status).json(failureBody(result));
        return;
      }
      res.status(200).json({
        ok: true,
        meta: result.meta,
        ...result.report,
      });
    } catch (error) {
      if (handleOrchestratorError(error, res)) return;
      keepCaughtError(res, error);
      next(error);
    }
  },
);

/**
 * POST /api/localization/generate-pdf-data
 */
router.post(
  '/api/localization/generate-pdf-data',
  requireAuth,
  rateLimitByUser(20, 60_000),
  async (req, res, next) => {
    try {
      const result = await runLocalizationReport({
        authUser: req.authUser!,
        projectId: String(req.body?.projectId || ''),
        siteAlternatives: req.body?.siteAlternatives,
        // U20-C: this older route is the one existing consumer of the ungoverned observations; it
        // gets them in their labelled block (never in gating, verdict or reasoning).
        includeLegacyObservations: true,
      });
      if (result.ok === false) {
        res.status(result.status).json(failureBody(result));
        return;
      }
      const pdfData = buildLocalizationPdfData(result.report);
      res.status(200).json({ ok: true, pdfData, meta: result.meta });
    } catch (error) {
      if (handleOrchestratorError(error, res)) return;
      keepCaughtError(res, error);
      next(error);
    }
  },
);

// POST /api/localization/export-pdf -- retired (W3a, Q3/D-P5-5). Unreachable: the legacy PDF path
// is not the product path, and its only caller (components/LocalizationStudyUI.tsx) is itself
// retired in this same unit. The underlying exportLocalizationPdf() orchestrator function is left
// in place as unreferenced, forward-only dead code (no other caller exists), per the established
// no-drive-by-cleanup norm -- only the route registration that made it reachable is removed here.

/**
 * GET /api/localization/:projectId/audit-trail
 */
router.get(
  '/api/localization/:projectId/audit-trail',
  requireAuth,
  rateLimitByUser(60, 60_000),
  async (req, res, _next) => {
    try {
      const projectId = String(req.params.projectId || '').trim();
      if (!projectId) {
        res.status(400).json({ ok: false, error: 'projectId required', retryable: false });
        return;
      }
      const payload = await fetchLocalizationAuditTrail(projectId);
      res.status(200).json(payload);
    } catch (error) {
      // CATCH-REVIEWED: SANITIZED_500: the audit trail answers a sanitized 500 (no raw text) -- never "missing", never another record.
      // W-U20CDF6: retryable from the class of what failed (a read of the audit trail).
      res.status(500).json({ ...toSafeErrorResponse(error), retryable: classifyReadFault(error, 'read').retryable });
    }
  },
);

/**
 * GET /api/localization/property-projects?propertyDesignation=...
 *
 * PRODUCT-LU-PROJECT-CONTEXT-BOOTSTRAP-01 Phase B. Property-first discovery: every localization
 * project (any status) the caller's organisation already has for this property. Read-only, no
 * project creation, no bootstrap side effects.
 */
router.get(
  '/api/localization/property-projects',
  requireAuth,
  rateLimitByUser(60, 60_000),
  async (req, res, next) => {
    try {
      const propertyDesignation = String(req.query.propertyDesignation || '').trim();
      if (!propertyDesignation) {
        res.status(400).json({ ok: false, error: 'propertyDesignation required', retryable: false });
        return;
      }
      const projects = await listProjectsForProperty({
        organisationId: req.authUser!.organisationId,
        propertyDesignation,
      });
      res.status(200).json({ ok: true, projects });
    } catch (error) {
      keepCaughtError(res, error);
      next(error);
    }
  },
);

/**
 * POST /api/localization/localization-projects
 *
 * PRODUCT-LU-PROJECT-CONTEXT-BOOTSTRAP-01 Phase B. The property-first "create new localization"
 * primitive. ALWAYS inserts a new Project (never reuses one by propertyDesignation -- see
 * localizationProjectDiscovery.ts), makes the caller its real ProjectMember{OWNER}, and enqueues
 * a bootstrap request. Returns immediately with PENDING status; the standalone bootstrap worker
 * (a separate process holding the owner signing key, never this web process) does the actual
 * PropertyContext/ProjectContext/ProjectContextBinding issuance asynchronously. This route never
 * accepts or constructs an artifact ref, issuer ref, or signature -- only propertyDesignation and
 * a human-chosen name.
 */
router.post(
  '/api/localization/localization-projects',
  requireAuth,
  rateLimitByUser(20, 60_000),
  async (req, res, next) => {
    try {
      const propertyDesignation = String(req.body?.propertyDesignation || '').trim();
      const name = String(req.body?.name || '').trim();
      if (!propertyDesignation || !name) {
        res.status(400).json({ ok: false, error: 'propertyDesignation and name are required', retryable: false });
        return;
      }
      const project = await createLocalizationProject({
        organisationId: req.authUser!.organisationId,
        propertyDesignation,
        name,
        userId: req.authUser!.id,
      });
      const bootstrapRequest = await enqueueProjectContextBootstrapRequest({
        projectId: project.id,
        requestedByUserId: req.authUser!.id,
        propertyDesignation,
      });
      res.status(201).json({
        ok: true,
        project,
        bootstrapRequestId: bootstrapRequest.id,
        bootstrapStatus: bootstrapRequest.status,
      });
    } catch (error) {
      keepCaughtError(res, error);
      next(error);
    }
  },
);

/**
 * GET /api/localization/:projectId/bootstrap-status
 *
 * PRODUCT-LU-PROJECT-CONTEXT-BOOTSTRAP-01 Phase B. Live-runtime read of the async bootstrap
 * outcome for a project the caller has real access to. Never mints or verifies anything itself --
 * purely reads the durable queue row the worker maintains.
 */
router.get(
  '/api/localization/:projectId/bootstrap-status',
  requireAuth,
  rateLimitByUser(60, 60_000),
  async (req, res, next) => {
    try {
      const projectId = String(req.params.projectId || '').trim();
      if (!projectId) {
        res.status(400).json({ ok: false, error: 'projectId required', retryable: false });
        return;
      }
      try {
        await assertProjectAccess(req.authUser!, projectId, req.authUser!.organisationId);
      } catch (error) {
        // W-CATCH2 #14: 403 only for the access check's own denial; a failed READ of the access facts
        // (database down) is a technical 503, never "not authorized".
        const { status: httpStatus, ...body } = projectAccessFailure(error);
        res.status(httpStatus).json(body);
        return;
      }
      const status = await getBootstrapRequestStatusForProject(projectId);
      if (!status) {
        // W-U20CDF6: a proven absence -- retryable false, explicitly.
        res.status(404).json({ ok: false, error: 'No bootstrap request exists for this project.', retryable: false });
        return;
      }
      // PRODUCT-LU-VIEWER-CAPABILITY-PROVISIONING-01 Phase B: the canonical automatic trigger for
      // ViewerCapability provisioning -- fires once the ProjectContext bootstrap prerequisite is
      // observed COMPLETED. Idempotent (ensureViewerCapabilityProvisioningRequested skips if a
      // request for this exact subject already exists), and best-effort: a failure here must
      // never break this status response, since bootstrap itself already succeeded.
      if (status.status === 'COMPLETED' && status.contextBindingArtifactId) {
        ensureViewerCapabilityProvisioningEnqueuedForCompletedBootstrap({
          projectId,
          contextBindingArtifactId: status.contextBindingArtifactId,
          requestedByUserId: req.authUser!.id,
        }).catch((error) => {
          // CATCH-REVIEWED: BEST_EFFORT_LOGGED: the capability trigger is idempotent and retried on the next status read; its failure is logged and decides nothing.
          logger.warn(
            `viewer-capability trigger: could not enqueue for project ${projectId}: ${error instanceof Error ? error.message : String(error)}`,
          );
        });
      }
      // W-CATCH2 #4: a FAILED request is shown by its stable code (Swedish text, derived retryable) --
      // never its stored failureDetail, which on older rows can hold raw storage paths or SQL.
      res.status(200).json({ ok: true, status: presentBootstrapRequestStatus(status) });
    } catch (error) {
      keepCaughtError(res, error);
      next(error);
    }
  },
);

/**
 * POST /api/localization/:projectId/bootstrap-retry
 *
 * PRODUCT-LU-PROPERTY-FIRST-WORKFLOW-01 Phase B (UI wiring). Enqueues another
 * ProjectContextBootstrapRequest for an EXISTING project after a FAILED attempt -- never creates
 * a new project (that stays exclusively POST /api/localization/localization-projects). The
 * propertyDesignation is read from the project's own real row, never accepted from the request
 * body, so a caller cannot retry-with-a-different-property.
 */
router.post(
  '/api/localization/:projectId/bootstrap-retry',
  requireAuth,
  rateLimitByUser(10, 60_000),
  async (req, res, next) => {
    try {
      const projectId = String(req.params.projectId || '').trim();
      if (!projectId) {
        res.status(400).json({ ok: false, error: 'projectId required', retryable: false });
        return;
      }
      try {
        await assertProjectAccess(req.authUser!, projectId, req.authUser!.organisationId);
      } catch (error) {
        // W-CATCH2 #14: 403 only for a denial; a failed access read is a technical 503.
        const { status: httpStatus, ...body } = projectAccessFailure(error);
        res.status(httpStatus).json(body);
        return;
      }
      const project = await prisma.project.findUnique({ where: { id: projectId }, select: { propertyDesignation: true } });
      if (!project) {
        res.status(404).json({ ok: false, error: 'Project not found.', retryable: false });
        return;
      }
      const bootstrapRequest = await enqueueProjectContextBootstrapRequest({
        projectId,
        requestedByUserId: req.authUser!.id,
        propertyDesignation: project.propertyDesignation,
      });
      res.status(201).json({ ok: true, bootstrapRequestId: bootstrapRequest.id, bootstrapStatus: bootstrapRequest.status });
    } catch (error) {
      keepCaughtError(res, error);
      next(error);
    }
  },
);

/**
 * GET /api/localization/:projectId/viewer/evidence
 *
 * P3-LU-CESIUM-PRESENTATION-WIRING-01. The canonical governed LU presentation endpoint --
 * authenticated project access -> current ProjectContextBinding -> current assessment
 * projection -> verified, non-superseded ViewerCapability -> CAS -> ViewerKernel. This is NOT
 * a replacement for /api/spatial/evidence (which remains available for unrelated general GIS
 * exploration); it is the only endpoint the LU product Cesium flow may call.
 */
router.get(
  '/api/localization/:projectId/viewer/evidence',
  requireAuth,
  rateLimitByUser(60, 60_000),
  async (req, res, next) => {
    try {
      const result = await resolveLuViewerPresentation({
        authUser: req.authUser!,
        projectId: String(req.params.projectId || ''),
      });
      if (result.ok === false) {
        res.status(result.status).json(failureBody(result));
        return;
      }
      res.status(200).json(result.geojson);
    } catch (error) {
      if (error instanceof LuReadFaultError) {
        res.status(readFaultHttpStatus(error)).json(viewerCapabilityReadFaultBody(error));
        return;
      }
      if (handleOrchestratorError(error, res)) return;
      keepCaughtError(res, error);
      next(error);
    }
  },
);

/**
 * GET /api/localization/:projectId/current-assessment
 *
 * LU-ASSESSMENT-PERSISTENCE-READ-V1 (backend half). Read-only: resolves the already-persisted,
 * governed LocalizationAssessmentArtifact currently bound to this project's current
 * ProjectContextBinding (and current localization geometry, if any) -- never runs the kernel,
 * never re-evaluates rules. Lets a caller show the same result after logout/relogin/reopen without
 * requiring a fresh "Kör bedömning" run. UI wiring is a separate, later unit.
 */
router.get(
  '/api/localization/:projectId/current-assessment',
  requireAuth,
  rateLimitByUser(60, 60_000),
  async (req, res, next) => {
    try {
      const result = await resolveCurrentLuAssessmentSummary({
        authUser: req.authUser!,
        projectId: String(req.params.projectId || ''),
      });
      if (result.ok === false) {
        res.status(result.status).json(failureBody(result));
        return;
      }
      res.status(200).json({
        ok: true,
        assessmentArtifactId: result.assessmentArtifactId,
        findings: result.findings,
        ruleRefs: result.ruleRefs,
        evidenceRefs: result.evidenceRefs,
        systemSummary: result.systemSummary,
        localizationGeometry: result.localizationGeometry,
        // K0: machine-readable document check from the assessment's pinned evidence refs.
        documentCheck: result.documentCheck,
        // U20-D (additions only): the same layer checks as the fresh run, every pinned evidence
        // resolved from CAS, the property root, and the coverage-qualified overall statement.
        governedLayerChecks: result.governedLayerChecks,
        evidenceDetails: result.evidenceDetails,
        propertyRoot: result.propertyRoot,
        overallStatement: result.overallStatement,
        // U20-D, provisional and derived (owner decision pending); nothing in the product reads it.
        overall_summary: result.overall_summary,
      });
    } catch (error) {
      if (handleOrchestratorError(error, res)) return;
      keepCaughtError(res, error);
      next(error);
    }
  },
);

/**
 * GET /api/localization/:projectId/export-assessment-pdf
 *
 * LU-REPORT-EXPORT-UI-V1. Exports a PDF built ONLY from the current, resolved, tamper-verified
 * governed assessment (resolveCurrentLuAssessmentSummary + its own property/project context
 * refs) -- never re-runs the kernel, never accepts client-supplied findings/coordinates as
 * report authority. Deliberately GET (no body): the client identifies only the project, exactly
 * matching the read-only nature of this export.
 * U20-D: optional `?assessmentArtifactId=` binds the export to the assessment the UI shows; the
 * answer names the exported assessment in `X-Assessment-Artifact-Id`.
 */
router.get(
  '/api/localization/:projectId/export-assessment-pdf',
  requireAuth,
  rateLimitByUser(15, 60_000),
  async (req, res, next) => {
    try {
      const expected = optionalAssessmentArtifactId(req.query.assessmentArtifactId);
      if (expected.ok === false) {
        invalidAssessmentId(res);
        return;
      }
      const result = await exportCurrentLuAssessmentPdf({
        authUser: req.authUser!,
        projectId: String(req.params.projectId || ''),
        expectedAssessmentArtifactId: expected.value,
      });
      if (result.ok === false) {
        res.status(result.status).json(failureBody(result));
        return;
      }
      // U20-D: which assessment this PDF is (also printed in the PDF's verification block).
      res.setHeader('X-Assessment-Artifact-Id', result.assessmentArtifactId);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
      res.send(result.buffer);
    } catch (error) {
      if (handleOrchestratorError(error, res)) return;
      keepCaughtError(res, error);
      next(error);
    }
  },
);

/**
 * POST /api/localization/:projectId/verify-assessment
 *
 * LU-REEXECUTION-VERIFY-UI-V1. The narrowest authenticated wrapper around H15's existing,
 * already-PROVEN reExecuteLocalizationAssessment -- resolves which assessment is current for this
 * project (same identity resolution as current-assessment/export-assessment-pdf), then hands that
 * one id to H15 unchanged. No body content is read as report authority: the client identifies only
 * the project.
 * U20-D: an optional `assessmentArtifactId` (body or query) binds the verification to the
 * assessment the UI shows; any other current assessment is refused with 409, never verified instead.
 */
router.post(
  '/api/localization/:projectId/verify-assessment',
  refuseVerifyWithBootstrapFlagOutsideTest,
  requireAuth,
  rateLimitByUser(15, 60_000),
  async (req, res, next) => {
    try {
      const expected = optionalAssessmentArtifactId(req.body?.assessmentArtifactId ?? req.query.assessmentArtifactId);
      if (expected.ok === false) {
        invalidAssessmentId(res);
        return;
      }
      const result = await verifyCurrentLuAssessment({
        authUser: req.authUser!,
        projectId: String(req.params.projectId || ''),
        expectedAssessmentArtifactId: expected.value,
      });
      if (result.ok === false) {
        res.status(result.status).json(failureBody(result));
        return;
      }
      // W-PLUMB-S (U30R6-REPORT K4, K21; contract server/modules/localization/verifyPresentationContract.ts): the
      // presentation is re-derived from the answer's own machine fields and must agree with the orchestrator's claim --
      // a missing, unknown or contradicting value is NOT_VERIFIED (strength null, neutral text), never green.
      const answer = verifyAnswerFields(result);
      res.status(200).json({
        ok: true,
        outcome: answer.outcome,
        assessmentArtifactId: result.assessmentArtifactId,
        mismatches: answer.mismatches,
        // U20CDF (U30-R2 follow-up): machine notices unchanged, Swedish text on top.
        notices: answer.notices,
        verification_binding: answer.verification_binding,
        presentation: answer.presentation,
        outcome_sv: answer.outcome_sv,
      });
    } catch (error) {
      if (handleOrchestratorError(error, res)) return;
      keepCaughtError(res, error);
      next(error);
    }
  },
);

/**
 * GET /api/localization/:projectId/geometry
 *
 * PRODUCT-LU-CESIUM-LOCALIZATION-DRAWING-01. The current LocalizationGeometry the UI shows --
 * either the user's own explicitly saved point, or (before any explicit point has ever been set)
 * the transitional property-centroid-derived point, so the UI always has something real and
 * governed to display, never a client-side guess.
 */
router.get(
  '/api/localization/:projectId/geometry',
  requireAuth,
  rateLimitByUser(60, 60_000),
  async (req, res, next) => {
    try {
      const result = await getCurrentLocalizationGeometryForProject({
        authUser: req.authUser!,
        projectId: String(req.params.projectId || ''),
      });
      if (result.ok === false) {
        res.status(result.status).json(failureBody(result));
        return;
      }
      res.status(200).json({ ok: true, geometry: result.data });
    } catch (error) {
      keepCaughtError(res, error);
      next(error);
    }
  },
);

/**
 * POST /api/localization/:projectId/geometry
 *
 * PRODUCT-LU-CESIUM-LOCALIZATION-DRAWING-01. The ONLY route that turns a user's Cesium click
 * into a real, persisted LocalizationGeometryArtifact. Request body carries ONLY the user's raw
 * input (geometry_type, coordinates as [lng, lat] WGS84, srid) -- never an artifact_id,
 * property_context_ref, project_context_binding_ref, content_hash, issuer, or signature. Every
 * authority-bearing field is derived/verified server-side by saveUserLocalizationGeometry.
 */
router.post(
  '/api/localization/:projectId/geometry',
  requireAuth,
  rateLimitByUser(20, 60_000),
  async (req, res, next) => {
    try {
      const result = await saveUserLocalizationGeometry({
        authUser: req.authUser!,
        projectId: String(req.params.projectId || ''),
        input: {
          geometry_type: req.body?.geometry_type,
          coordinates: req.body?.coordinates,
          srid: req.body?.srid,
        },
      });
      if (result.ok === false) {
        res.status(result.status).json(failureBody(result));
        return;
      }
      res.status(201).json({ ok: true, geometry: result.data });
    } catch (error) {
      keepCaughtError(res, error);
      next(error);
    }
  },
);

/**
 * POST /api/localization/:projectId/geometry-identity-retry
 *
 * PRODUCT-LU-EXECUTION-IDENTITY-V3-PROVISIONING-01 Phase B. Re-enqueues V3 identity provisioning
 * for the project's CURRENT localization geometry after a FAILED attempt -- never accepts a
 * geometryArtifactId from the caller, always resolves current fresh, so a retry naturally targets
 * wherever the user has since moved the point, not a stale failed one.
 */
router.post(
  '/api/localization/:projectId/geometry-identity-retry',
  requireAuth,
  rateLimitByUser(10, 60_000),
  async (req, res, next) => {
    try {
      const result = await retryLocalizationIdentityProvisioning({
        authUser: req.authUser!,
        projectId: String(req.params.projectId || ''),
      });
      if (result.ok === false) {
        res.status(result.status).json(failureBody(result));
        return;
      }
      res.status(201).json({ ok: true, geometry: result.data });
    } catch (error) {
      keepCaughtError(res, error);
      next(error);
    }
  },
);

/** Legacy shape kept for internal scripts — prefer orchestrator routes above. */
export async function generateLocalizationReportRouteHandler(
  projectId: string,
  siteAlternatives: SiteAlternative[],
  userId?: string,
) {
  return generateLocalizationReportLegacy(projectId, siteAlternatives, userId);
}

export default router;
