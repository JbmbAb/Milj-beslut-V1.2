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
import { evaluateMpfCode } from '../services/mpfThresholdService';

const router = express.Router();

const validateCodesSchema = z.object({
  propertyDesignation: z.string().min(1, 'propertyDesignation kravs'),
  operationType: z.enum(['MELLANLAGRING', 'DEPONI']),
  quantityPerYear: z.number().finite().positive(),
  ewcCode: z.string().min(1, 'ewcCode kravs'),
  sniCode: z.string().min(1).optional(),
});

const operationsSchema = z.object({
  caseId: z.string().optional(),
  projectId: z.string().min(1),
  propertyDesignation: z.string().min(1),
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

router.post('/api/c-notification/mass/property-search', requireAuth, rateLimitByUser(30, 60_000), async (req, res) => {
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
});

router.post('/api/c-notification/mass/validate-codes', requireAuth, rateLimitByUser(30, 60_000), (req, res) => {
  try {
    if (!req.authUser) {
      res.status(401).json({ ok: false, error: 'Unauthorized' });
      return;
    }

    const input: ValidateCodesInput = validateCodesSchema.parse(req.body);
    const op = evaluateOperationCodes(input);

    res.json({
      ok: true,
      propertyDesignation: input.propertyDesignation,
      operationType: input.operationType,
      quantityPerYear: input.quantityPerYear,
      evaluations: {
        ewc: evaluateMpfCode({
          code: input.ewcCode,
          quantity: input.quantityPerYear,
          codeType: 'EWC',
        }),
        sni: input.sniCode
          ? evaluateMpfCode({
              code: input.sniCode,
              quantity: input.quantityPerYear,
              codeType: 'SNI',
            })
          : null,
      },
      gateDecision: op.gateDecision,
      requiresNotification: op.gateDecision === 'NOTIFICATION_REQUIRED',
      requiresPermit: op.gateDecision === 'PERMIT_REQUIRED',
    });
  } catch (error: unknown) {
    res.status(400).json(toSafeErrorResponse(error));
  }
});

router.post('/api/c-notification/mass/operations', requireAuth, rateLimitByUser(30, 60_000), async (req, res) => {
  try {
    if (!req.authUser) {
      res.status(401).json({ ok: false, error: 'Unauthorized' });
      return;
    }
    const input: OperationsInput = operationsSchema.parse(req.body);
    await assertProjectAccess(req.authUser, input.projectId, req.authUser.organisationId);
    const result = await upsertMassOperations(input.caseId, req.authUser, input);
    if (!sendOrchestratorResult(res, result)) return;
    res.status(input.caseId ? 200 : 201).json(result);
  } catch (error: unknown) {
    res.status(400).json(toSafeErrorResponse(error));
  }
});

router.post('/api/c-notification/mass/mass-flow', requireAuth, rateLimitByUser(20, 60_000), async (req, res) => {
  try {
    if (!req.authUser) {
      res.status(401).json({ ok: false, error: 'Unauthorized' });
      return;
    }
    const body: {
      caseId: string;
      wasteCode: string;
      volumeM3: number;
      sourceStorageAreaId?: string;
      destinationStorageAreaId?: string;
    } = z
      .object({
        caseId: z.string().min(1),
        wasteCode: z.string().min(1),
        volumeM3: z.number().finite().positive(),
        sourceStorageAreaId: z.string().optional(),
        destinationStorageAreaId: z.string().optional(),
      })
      .parse(req.body);

    const result = await recordMassFlowForCase(body.caseId, req.authUser, body);
    if (!sendOrchestratorResult(res, result)) return;
    res.json(result);
  } catch (error: unknown) {
    res.status(400).json(toSafeErrorResponse(error));
  }
});

router.post('/api/c-notification/mass/logistics', requireAuth, rateLimitByUser(10, 60_000), async (req, res) => {
  try {
    if (!req.authUser) {
      res.status(401).json({ ok: false, error: 'Unauthorized' });
      return;
    }
    const body: {
      caseId: string;
      sourceAddress: string;
      destinationAddress: string;
      estimatedTons: number;
      wasteType?: 'SOIL' | 'CONSTRUCTION' | 'INDUSTRIAL' | 'HAZARDOUS' | 'ORGANIC';
    } = z
      .object({
        caseId: z.string().min(1),
        sourceAddress: z.string().min(1),
        destinationAddress: z.string().min(1),
        estimatedTons: z.number().finite().positive(),
        wasteType: z.enum(['SOIL', 'CONSTRUCTION', 'INDUSTRIAL', 'HAZARDOUS', 'ORGANIC']).optional(),
      })
      .parse(req.body);

    const result = await generateLogisticsForCase(body.caseId, req.authUser, body);
    if (!sendOrchestratorResult(res, result)) return;
    res.json({ ok: true, plan: result.plan, warnings: 'warnings' in result ? result.warnings : undefined });
  } catch (error: unknown) {
    res.status(500).json(toSafeErrorResponse(error));
  }
});

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

router.get('/api/c-notification/mass/:caseId/export', requireAuth, rateLimitByUser(20, 60_000), async (req, res) => {
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
});

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
