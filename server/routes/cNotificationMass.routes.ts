/**
 * C-anmälan schaktmassor — canonical API (/api/c-notification/mass/*)
 */

import express from 'express';
import { z } from 'zod';
import { requireAuth } from '../security/auth';
import { assertProjectAccess } from '../security/projectAccess';
import { rateLimitByUser } from '../security/rateLimit';
import { toSafeErrorResponse } from '../security/secureErrors';
import {
  evaluateOperationCodes,
  exportMassCase,
  generateDocumentsForCase,
  generateLogisticsForCase,
  getMassCaseAuditTrail,
  recordMassFlowForCase,
  searchPropertyForMass,
  submitMassCase,
  upsertMassOperations,
} from '../modules/c-notification-mass/massOrchestrator';
import { analyzeMassSiteGis } from '../modules/c-notification-mass/massGisService';
import { resolveMassSiteSensitivity } from '../modules/c-notification-mass/massSpatialSensitivity';
import { classifyProjectRegulatoryTrack, toMpfDecisionSummary } from '../modules/mpf/public';
import type { MassGisSnapshot } from '../../src/types/mass';

const router = express.Router();

const validateCodesSchema = z.object({
  propertyDesignation: z.string().min(1, 'propertyDesignation kravs'),
  operationType: z.enum(['MELLANLAGRING', 'DEPONI']),
  quantityPerYear: z.number().finite().positive(),
  ewcCode: z.string().min(1, 'ewcCode kravs'),
  sniCode: z.string().min(1).optional(),
  isSensitiveArea: z.boolean().optional(),
  siteLat: z.number().finite().optional(),
  siteLng: z.number().finite().optional(),
});

const massGisSnapshotSchema = z.object({
  analysis: z
    .object({
      propertyDesignation: z.string(),
      timestamp: z.string(),
      centroid: z.object({ lat: z.number(), lng: z.number() }),
      siteConstraints: z.array(
        z.object({
          code: z.string(),
          label: z.string(),
          severity: z.enum(['LOW', 'MEDIUM', 'HIGH']),
        }),
      ),
      overallRiskScore: z.number(),
      logisticsSuitability: z.enum(['SUITABLE', 'REVIEW_REQUIRED', 'RESTRICTED']),
      warnings: z.array(z.string()),
      reasoning: z.array(z.string()),
    })
    .passthrough(),
  siteProfile: z
    .object({
      propertyDesignation: z.string(),
      centroid: z.object({ lat: z.number(), lng: z.number() }),
      recommendedZones: z.array(
        z.object({
          id: z.string(),
          label: z.string(),
          operationType: z.enum(['MELLANLAGRING', 'DEPONI', 'TRANSIT']),
          offsetM: z.number(),
        }),
      ),
      source: z.string(),
    })
    .passthrough(),
  analyzedAt: z.string(),
  propertySource: z.string().optional(),
});

const operationsSchema = z.object({
  caseId: z.string().optional(),
  projectId: z.string().min(1),
  propertyDesignation: z.string().min(1),
  gisSnapshot: massGisSnapshotSchema.optional(),
  operations: z
    .array(
      z.object({
        operationType: z.enum(['MELLANLAGRING', 'DEPONI']),
        ewcCode: z.string().min(1),
        quantityPerYear: z.number().finite().positive(),
        sniCode: z.string().optional(),
        capacityM3: z.number().finite().positive().optional(),
        receiverName: z.string().optional(),
        transportChain: z.array(z.string()).optional(),
        storageAreaId: z.string().optional(),
      }),
    )
    .min(1),
});

type ValidateCodesInput = z.infer<typeof validateCodesSchema>;
type OperationsInput = z.infer<typeof operationsSchema>;

function sendOrchestratorResult(
  res: express.Response,
  result: { ok: boolean; status?: unknown; error?: string },
) {
  if (!result.ok) {
    const statusCode = typeof result.status === 'number' ? result.status : 400;
    res.status(statusCode).json(result);
    return false;
  }
  return true;
}

router.post(
  '/api/c-notification/mass/property-search',
  requireAuth,
  rateLimitByUser(30, 60_000),
  async (req, res) => {
    try {
      if (!req.authUser) {
        res.status(401).json({ ok: false, error: 'Unauthorized' });
        return;
      }
      const result = await searchPropertyForMass(req.authUser, req.body);
      if (!result.ok) {
        res.status(result.status).json(result);
        return;
      }
      res.json({ ok: true, result: result.result, source: result.source, warnings: result.warnings });
    } catch (error: unknown) {
      res.status(400).json(toSafeErrorResponse(error));
    }
  },
);

router.post(
  '/api/c-notification/mass/gis-analysis',
  requireAuth,
  rateLimitByUser(30, 60_000),
  async (req, res) => {
    try {
      if (!req.authUser) {
        res.status(401).json({ ok: false, error: 'Unauthorized' });
        return;
      }

      const parsed = z
        .object({
          projectId: z.string().min(1),
          propertyDesignation: z.string().min(1),
        })
        .parse(req.body);

      const result = await analyzeMassSiteGis(req.authUser, {
        projectId: parsed.projectId,
        propertyDesignation: parsed.propertyDesignation,
      });
      if (result.ok === false) {
        res.status(result.status).json(result);
        return;
      }

      res.json({
        ok: true,
        analysis: result.data.analysis,
        siteProfile: result.data.siteProfile,
        propertySource: result.data.propertySource,
      });
    } catch (error: unknown) {
      res.status(400).json(toSafeErrorResponse(error));
    }
  },
);

router.post(
  '/api/c-notification/mass/regulatory-classify',
  requireAuth,
  rateLimitByUser(30, 60_000),
  async (req, res) => {
    try {
      if (!req.authUser) {
        res.status(401).json({ ok: false, error: 'Unauthorized' });
        return;
      }

      const parsed = z
        .object({
          lat: z.number().finite(),
          lng: z.number().finite(),
          ewcCode: z.string().min(1),
          sniCode: z.string().min(1).optional(),
          annualVolume: z.number().finite().positive(),
        })
        .parse(req.body);

      const classification = await classifyProjectRegulatoryTrack({
        lat: parsed.lat,
        lng: parsed.lng,
        ewcCode: parsed.ewcCode,
        sniCode: parsed.sniCode,
        annualVolume: parsed.annualVolume,
      });
      res.json({
        ok: true,
        classification,
        mpfDecision: toMpfDecisionSummary(classification.mpfDetails),
      });
    } catch (error: unknown) {
      res.status(400).json(toSafeErrorResponse(error));
    }
  },
);

router.post(
  '/api/c-notification/mass/validate-codes',
  requireAuth,
  rateLimitByUser(30, 60_000),
  async (req, res) => {
    try {
      if (!req.authUser) {
        res.status(401).json({ ok: false, error: 'Unauthorized' });
        return;
      }

      const parsed: ValidateCodesInput = validateCodesSchema.parse(req.body);
      const siteSensitivity = await resolveMassSiteSensitivity({
        isSensitiveArea: parsed.isSensitiveArea,
        siteLat: parsed.siteLat,
        siteLng: parsed.siteLng,
      });

      const input = {
        propertyDesignation: parsed.propertyDesignation,
        operationType: parsed.operationType,
        quantityPerYear: parsed.quantityPerYear,
        ewcCode: parsed.ewcCode,
        sniCode: parsed.sniCode,
        isSensitiveArea: siteSensitivity.isSensitiveArea,
      };
      const op = evaluateOperationCodes(input);
      const mpfDecision = op.mpfDecision;

      res.json({
        ok: true,
        propertyDesignation: input.propertyDesignation,
        operationType: input.operationType,
        quantityPerYear: input.quantityPerYear,
        siteSensitivity,
        evaluations: {
          ewc: mpfDecision.ewcEvaluation,
          sni: mpfDecision.sniEvaluation,
        },
        mpfDecision,
        gateDecision: op.gateDecision,
        requiresNotification: op.gateDecision === 'NOTIFICATION_REQUIRED',
        requiresPermit: op.gateDecision === 'PERMIT_REQUIRED',
        notes: op.notes,
      });
    } catch (error: unknown) {
      res.status(400).json(toSafeErrorResponse(error));
    }
  },
);

router.post(
  '/api/c-notification/mass/operations',
  requireAuth,
  rateLimitByUser(30, 60_000),
  async (req, res) => {
    try {
      if (!req.authUser) {
        res.status(401).json({ ok: false, error: 'Unauthorized' });
        return;
      }
      const parsed: OperationsInput = operationsSchema.parse(req.body);
      const input = {
        projectId: parsed.projectId,
        propertyDesignation: parsed.propertyDesignation,
        gisSnapshot: parsed.gisSnapshot as MassGisSnapshot | undefined,
        operations: parsed.operations.map((operation) => ({
          operationType: operation.operationType,
          ewcCode: operation.ewcCode,
          quantityPerYear: operation.quantityPerYear,
          sniCode: operation.sniCode,
          capacityM3: operation.capacityM3,
          receiverName: operation.receiverName,
          transportChain: operation.transportChain,
          storageAreaId: operation.storageAreaId,
        })),
      };
      await assertProjectAccess(req.authUser, input.projectId, req.authUser.organisationId);
      const result = await upsertMassOperations(parsed.caseId, req.authUser, input);
      if (!sendOrchestratorResult(res, result)) return;
      res.status(parsed.caseId ? 200 : 201).json(result);
    } catch (error: unknown) {
      res.status(400).json(toSafeErrorResponse(error));
    }
  },
);

router.post(
  '/api/c-notification/mass/mass-flow',
  requireAuth,
  rateLimitByUser(20, 60_000),
  async (req, res) => {
    try {
      if (!req.authUser) {
        res.status(401).json({ ok: false, error: 'Unauthorized' });
        return;
      }
      const parsed = z
        .object({
          caseId: z.string().min(1),
          wasteCode: z.string().min(1),
          volumeM3: z.number().finite().positive(),
          sourceStorageAreaId: z.string().optional(),
          destinationStorageAreaId: z.string().optional(),
        })
        .parse(req.body);
      const body = {
        caseId: parsed.caseId,
        wasteCode: parsed.wasteCode,
        volumeM3: parsed.volumeM3,
        sourceStorageAreaId: parsed.sourceStorageAreaId,
        destinationStorageAreaId: parsed.destinationStorageAreaId,
      };

      const result = await recordMassFlowForCase(body.caseId, req.authUser, body);
      if (!sendOrchestratorResult(res, result)) return;
      res.json(result);
    } catch (error: unknown) {
      res.status(400).json(toSafeErrorResponse(error));
    }
  },
);

router.post(
  '/api/c-notification/mass/logistics',
  requireAuth,
  rateLimitByUser(10, 60_000),
  async (req, res) => {
    try {
      if (!req.authUser) {
        res.status(401).json({ ok: false, error: 'Unauthorized' });
        return;
      }
      const parsed = z
        .object({
          caseId: z.string().min(1),
          sourceAddress: z.string().min(1),
          destinationAddress: z.string().min(1),
          estimatedTons: z.number().finite().positive(),
          wasteType: z.enum(['SOIL', 'CONSTRUCTION', 'INDUSTRIAL', 'HAZARDOUS', 'ORGANIC']).optional(),
        })
        .parse(req.body);
      const body = {
        caseId: parsed.caseId,
        sourceAddress: parsed.sourceAddress,
        destinationAddress: parsed.destinationAddress,
        estimatedTons: parsed.estimatedTons,
        wasteType: parsed.wasteType,
      };

      const result = await generateLogisticsForCase(body.caseId, req.authUser, body);
      if (!sendOrchestratorResult(res, result)) return;
      res.json({ ok: true, plan: result.plan, warnings: 'warnings' in result ? result.warnings : undefined });
    } catch (error: unknown) {
      res.status(500).json(toSafeErrorResponse(error));
    }
  },
);

router.post(
  '/api/c-notification/mass/generate-documents',
  requireAuth,
  rateLimitByUser(20, 60_000),
  async (req, res) => {
    try {
      if (!req.authUser) {
        res.status(401).json({ ok: false, error: 'Unauthorized' });
        return;
      }
      const { caseId } = z.object({ caseId: z.string().min(1) }).parse(req.body);
      const result = await generateDocumentsForCase(caseId, req.authUser);
      if (!sendOrchestratorResult(res, result)) return;
      res.json(result);
    } catch (error: unknown) {
      res.status(400).json(toSafeErrorResponse(error));
    }
  },
);

router.get(
  '/api/c-notification/mass/:caseId/export',
  requireAuth,
  rateLimitByUser(20, 60_000),
  async (req, res) => {
    try {
      if (!req.authUser) {
        res.status(401).json({ ok: false, error: 'Unauthorized' });
        return;
      }
      const caseId = String(req.params.caseId ?? '');
      const result = await exportMassCase(caseId, req.authUser);
      if (!sendOrchestratorResult(res, result)) return;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.json({ ok: true, caseId, export: result.export });
    } catch (error: unknown) {
      res.status(500).json(toSafeErrorResponse(error));
    }
  },
);

router.post('/api/c-notification/mass/submit', requireAuth, rateLimitByUser(10, 60_000), async (req, res) => {
  try {
    if (!req.authUser) {
      res.status(401).json({ ok: false, error: 'Unauthorized' });
      return;
    }
    const { caseId } = z.object({ caseId: z.string().min(1) }).parse(req.body);
    const result = await submitMassCase(caseId, req.authUser);
    if (!sendOrchestratorResult(res, result)) return;
    res.json(result);
  } catch (error: unknown) {
    res.status(500).json(toSafeErrorResponse(error));
  }
});

router.get('/api/c-notification/mass/:caseId/audit-trail', requireAuth, async (req, res) => {
  try {
    if (!req.authUser) {
      res.status(401).json({ ok: false, error: 'Unauthorized' });
      return;
    }
    const caseId = String(req.params.caseId ?? '');
    const result = await getMassCaseAuditTrail(caseId, req.authUser);
    if (!sendOrchestratorResult(res, result)) return;
    res.json({ ok: true, referenceNumber: result.referenceNumber, entries: result.entries });
  } catch (error: unknown) {
    res.status(500).json(toSafeErrorResponse(error));
  }
});

export default router;
