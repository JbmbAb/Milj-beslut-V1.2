import express from 'express';
import { requireAuth } from '../security/auth';
import { rateLimitByUser } from '../security/rateLimit';
import { assertProjectMembership } from '../repositories/projectAccessRepository';
import { toSafeErrorResponse } from '../security/secureErrors';
import { generateGreenCheck } from '../services/greenCheckGeneratorService';
import { generateLogisticsPlan } from '../services/logisticsGeneratorService';
import { generatePermitApplication } from '../services/permitApplicationGeneratorService';
import { generateProjectPlan } from '../services/projectPlanGeneratorService';

const router = express.Router();

function parseOptionalNumber(value: unknown): number | undefined {
  if (value === '' || value == null) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

router.post('/api/green-check/generate', requireAuth, rateLimitByUser(20, 60_000), async (req, res) => {
  try {
    const organizationNumber = String(req.body?.organizationNumber ?? '').trim();
    const projectDescription = String(req.body?.projectDescription ?? '').trim();

    if (!organizationNumber || !projectDescription) {
      return res.status(400).json({
        ok: false,
        error: 'Missing required fields: organizationNumber, projectDescription',
      });
    }

    const assessment = await generateGreenCheck({
      organizationNumber,
      organizationName: req.body?.organizationName,
      projectDescription,
      investmentAmount: parseOptionalNumber(req.body?.investmentAmount),
      sector: req.body?.sector,
      latitude: parseOptionalNumber(req.body?.latitude),
      longitude: parseOptionalNumber(req.body?.longitude),
    });

    res.json({ ok: true, assessment });
  } catch (error: unknown) {
    res.status(400).json(toSafeErrorResponse(error));
  }
});

router.post(
  '/api/projects/:projectId/logistics/generate',
  requireAuth,
  rateLimitByUser(20, 60_000),
  async (req, res) => {
    try {
      const projectId = String(req.params.projectId);
      await assertProjectMembership({
        projectId,
        userId: req.authUser!.id,
        organisationId: req.authUser!.organisationId,
        role: req.authUser!.role,
      });

      const wasteType = String(req.body?.wasteType ?? '').trim();
      const sourceAddress = String(req.body?.sourceAddress ?? '').trim();
      const destinationAddress = String(req.body?.destinationAddress ?? '').trim();
      const transportMode = String(req.body?.transportMode ?? '').trim();
      const estimatedTons = Number(req.body?.estimatedTons);

      if (
        !wasteType ||
        !sourceAddress ||
        !destinationAddress ||
        !transportMode ||
        !Number.isFinite(estimatedTons)
      ) {
        return res.status(400).json({
          ok: false,
          error:
            'Missing required fields: wasteType, estimatedTons, sourceAddress, destinationAddress, transportMode',
        });
      }

      const plan = await generateLogisticsPlan({
        projectId,
        wasteType: wasteType as Parameters<typeof generateLogisticsPlan>[0]['wasteType'],
        estimatedTons,
        sourceAddress,
        destinationAddress,
        transportMode: transportMode as Parameters<typeof generateLogisticsPlan>[0]['transportMode'],
        tillståndsId: req.body?.tillståndsId,
        contaminants: Array.isArray(req.body?.contaminants) ? req.body.contaminants : [],
      });

      res.json({ ok: true, plan });
    } catch (error: unknown) {
      res.status(400).json(toSafeErrorResponse(error));
    }
  },
);

router.post(
  '/api/projects/:projectId/permit/generate',
  requireAuth,
  rateLimitByUser(20, 60_000),
  async (req, res) => {
    try {
      const projectId = String(req.params.projectId);
      await assertProjectMembership({
        projectId,
        userId: req.authUser!.id,
        organisationId: req.authUser!.organisationId,
        role: req.authUser!.role,
      });

      const propertyDesignation = String(req.body?.propertyDesignation ?? '').trim();
      const sniCode = String(req.body?.sniCode ?? '').trim();
      const description = String(req.body?.description ?? '').trim();

      if (!propertyDesignation || !sniCode || !description) {
        return res.status(400).json({
          ok: false,
          error: 'Missing required fields: propertyDesignation, sniCode, description',
        });
      }

      const application = await generatePermitApplication({
        projectId,
        propertyDesignation,
        sniCode,
        description,
        sniDescription: req.body?.sniDescription,
        budget: parseOptionalNumber(req.body?.budget),
        latitude: parseOptionalNumber(req.body?.latitude),
        longitude: parseOptionalNumber(req.body?.longitude),
      });

      res.json({ ok: true, application });
    } catch (error: unknown) {
      res.status(400).json(toSafeErrorResponse(error));
    }
  },
);

router.post(
  '/api/projects/:projectId/plan/generate',
  requireAuth,
  rateLimitByUser(20, 60_000),
  async (req, res) => {
    try {
      const projectId = String(req.params.projectId);
      await assertProjectMembership({
        projectId,
        userId: req.authUser!.id,
        organisationId: req.authUser!.organisationId,
        role: req.authUser!.role,
      });

      const propertyId = String(req.body?.propertyId ?? '').trim();
      const projectType = String(req.body?.projectType ?? '').trim();
      const timeframe = String(req.body?.timeframe ?? '').trim();
      const description = String(req.body?.description ?? '').trim();
      const budget = Number(req.body?.budget);

      if (!propertyId || !projectType || !timeframe || !description || !Number.isFinite(budget)) {
        return res.status(400).json({
          ok: false,
          error: 'Missing required fields: propertyId, projectType, budget, timeframe, description',
        });
      }

      const plan = await generateProjectPlan({
        projectId,
        propertyId,
        projectType: projectType as Parameters<typeof generateProjectPlan>[0]['projectType'],
        budget,
        timeframe,
        description,
        latitude: parseOptionalNumber(req.body?.latitude),
        longitude: parseOptionalNumber(req.body?.longitude),
      });

      res.json({ ok: true, plan });
    } catch (error: unknown) {
      res.status(400).json(toSafeErrorResponse(error));
    }
  },
);

export default router;
