import express from 'express';
import { prisma } from '../db/prisma';
import { requireAuth } from '../security/auth';
import { rateLimitByUser } from '../security/rateLimit';
import { assertProjectMembership } from '../repositories/projectAccessRepository';
import {
  createOrGetAdminProject,
} from '../repositories/searchRepository';
import {
  countProjectsForOrganisation,
  listProjectsPageForOrganisation,
} from '../modules/platform/public';
import {
  calculateCarbonForProject,
  getProjectPlanSnapshot,
  saveProjectPlanSnapshot,
} from '../services/projectPlanService';
import {
  getProjectEnvironmentalOnly,
  getProjectForCarbonView,
} from '../modules/platform/public';
import { buildProjectRiskMetrics } from '../services/projectRiskMetrics';
import { appendDomainAudit } from '../security/auditTrail';
import type { CarbonInput, ProjectPlan } from '../../types';
import { getPublicDatasourceSummary } from '../services/publicUiService';
import { getDispatchProviderRuntimeStatus } from '../services/transportDispatchService';
import { getBankIdMode } from '../services/bankIdService';
import { summarizeModuleAccess, listAccessibleProjects, parseOptionalText } from './routeHelpers';
import {
  createProjectSchema,
  projectPlanSchema,
  carbonInputSchema,
  paginationSchema,
} from '../schemas/api.schemas';

const router = express.Router();

router.get('/api/app/bootstrap', requireAuth, rateLimitByUser(60, 60_000), async (req, res, next) => {
  try {
    if (!req.authUser) return res.status(401).json({ ok: false, error: 'Unauthorized' });

    const requestedActiveProjectId = parseOptionalText(req.query.activeProjectId);
    const checkedAt = new Date().toISOString();

    const [organisation, projects, datasourceSummary] = await Promise.all([
      prisma.organisation.findUnique({
        where: { id: req.authUser.organisationId },
        select: { id: true, name: true, orgNumber: true },
      }),
      listAccessibleProjects({
        userId: req.authUser.id,
        organisationId: req.authUser.organisationId,
        role: req.authUser.role,
      }),
      getPublicDatasourceSummary(),
    ]);

    if (!organisation) {
      return res.status(404).json({ ok: false, error: 'Organisation not found' });
    }

    const accessibleProjectIds = new Set(projects.map((p) => p.id));
    const activeProjectId =
      requestedActiveProjectId && accessibleProjectIds.has(requestedActiveProjectId)
        ? requestedActiveProjectId
        : projects[0]?.id || null;

    const dispatch = getDispatchProviderRuntimeStatus();
    const dispatchStatus =
      dispatch.activeProvider === 'NOT_CONFIGURED'
        ? 'not_configured'
        : dispatch.fallbackActive
          ? 'unavailable'
          : 'ready';
    
    const datasourceStatus = datasourceSummary.cards.some((c) => c.status === 'CONNECTED')
      ? 'ready'
      : datasourceSummary.cards.length > 0
        ? 'unavailable'
        : 'not_configured';

    res.json({
      ok: true,
      bootstrap: {
        user: {
          id: req.authUser.id,
          displayName: req.authUser.bankidId,
          bankidId: req.authUser.bankidId,
          role: req.authUser.role,
          organisationId: req.authUser.organisationId,
        },
        organisation,
        projects,
        activeProjectId,
        moduleAccess: summarizeModuleAccess({
          activeProjectId,
          projectCount: projects.length,
          role: req.authUser.role,
        }),
        integrationAvailability: {
          app: { status: 'ready', reason: 'Bootstrap-data laddad.', checkedAt },
          dispatch: {
            status: dispatchStatus,
            reason: dispatchStatus === 'ready' ? `Aktiv: ${dispatch.activeProvider}` : 'Ej konfigurerad.',
            checkedAt,
          },
          bankId: {
            status: getBankIdMode() === 'real' ? 'ready' : 'unavailable',
            reason: getBankIdMode() === 'real' ? 'Real' : 'Mock',
            checkedAt,
          },
          dataSources: { status: datasourceStatus, reason: 'Status syncad.', checkedAt },
        },
        uiCapabilities: {
          authenticated: true,
          canCreateProjects: req.authUser.role === 'ADMIN',
          bankIdMode: getBankIdMode(),
          requiresProjectSelection: activeProjectId == null && projects.length > 0,
        },
        checkedAt,
      },
    });
  } catch (error) {
    next(error);
  }
});

router.get('/api/admin/projects', requireAuth, async (req, res, next) => {
  try {
    if (req.authUser?.role !== 'ADMIN') return res.status(403).json({ ok: false, error: 'Admin role required' });

    const { page, limit } = paginationSchema.parse(req.query);
    const organisationId = req.authUser.organisationId;
    const total = await countProjectsForOrganisation(organisationId);
    const skip = (page - 1) * limit;
    const projects = await listProjectsPageForOrganisation({ organisationId, skip, take: limit });

    res.json({
      ok: true,
      projects,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      hasMore: skip + limit < total,
    });
  } catch (error) {
    next(error);
  }
});

router.post('/api/admin/projects', requireAuth, async (req, res, next) => {
  try {
    if (req.authUser?.role !== 'ADMIN') return res.status(403).json({ ok: false, error: 'Admin only' });
    const { propertyDesignation } = createProjectSchema.parse(req.body);
    
    const result = await createOrGetAdminProject({
      organisationId: req.authUser.organisationId,
      userId: req.authUser.id,
      propertyDesignation,
    });
    res.json({ ok: true, project: result.project, created: result.created });
  } catch (error) {
    next(error);
  }
});

router.get('/api/projects/:projectId/plan', requireAuth, async (req, res, next) => {
  try {
    const projectId = req.params.projectId as string;
    await assertProjectMembership({
      projectId,
      userId: req.authUser!.id,
      organisationId: req.authUser!.organisationId,
      role: req.authUser!.role,
    });
    const plan = await getProjectPlanSnapshot(projectId, req.authUser!.organisationId);
    res.json({ ok: true, plan });
  } catch (error) {
    next(error);
  }
});

router.post('/api/projects/:projectId/plan/save', requireAuth, async (req, res, next) => {
  try {
    const projectId = req.params.projectId as string;
    await assertProjectMembership({
      projectId,
      userId: req.authUser!.id,
      organisationId: req.authUser!.organisationId,
      role: req.authUser!.role,
    });
    const plan = projectPlanSchema.parse(req.body);
    await saveProjectPlanSnapshot({
      projectId,
      organisationId: req.authUser!.organisationId,
      plan,
    });
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

router.get('/api/projects/:projectId/carbon', requireAuth, async (req, res, next) => {
  try {
    const projectId = req.params.projectId as string;
    await assertProjectMembership({
      projectId,
      userId: req.authUser!.id,
      organisationId: req.authUser!.organisationId,
      role: req.authUser!.role,
    });

    const project = await getProjectForCarbonView(projectId);
    if (!project) {
      return res.status(404).json({ ok: false, error: 'Project not found' });
    }

    const allScoresMissing =
      project.environmentalScore == null &&
      project.complianceScore == null &&
      project.regulatoryRiskScore == null;

    const totalKgCo2e =
      project.environmentalScore != null ? project.environmentalScore * 100 : 0;

    const carbonResult =
      allScoresMissing || project.environmentalScore == null
        ? null
        : {
            totalKgCo2e,
            quality: 'CALCULATED' as const,
            method: 'DATABASE',
          };

    res.json({
      ok: true,
      carbonResult,
      esgRating: {
        overall: totalKgCo2e > 0 && totalKgCo2e < 5000 ? 'A' : totalKgCo2e < 10000 ? 'B' : 'C',
        carbonReady: totalKgCo2e > 0 && totalKgCo2e < 5000,
      },
      riskMetrics: buildProjectRiskMetrics(project),
    });
  } catch (error) {
    next(error);
  }
});

router.post('/api/projects/:projectId/carbon/calculate', requireAuth, async (req, res, next) => {
  try {
    const projectId = req.params.projectId as string;
    await assertProjectMembership({
      projectId,
      userId: req.authUser!.id,
      organisationId: req.authUser!.organisationId,
      role: req.authUser!.role,
    });

    const project = await getProjectEnvironmentalOnly(projectId);
    if (!project) {
      return res.status(404).json({ ok: false, error: 'Project not found' });
    }

    const rawInput = (req.body?.carbonInput || {}) as Partial<CarbonInput> & { materialKgCo2e?: number };
    const transportMode = String(rawInput.transportMode || 'TRUCK') as CarbonInput['transportMode'];
    const materialType = String(rawInput.materialType || 'SOIL') as CarbonInput['materialType'];
    const carbonInput: CarbonInput = {
      tons: Math.max(0, Number(rawInput.tons || 0)),
      distanceKm: rawInput.distanceKm ? Number(rawInput.distanceKm) : undefined,
      manualDistanceKm: rawInput.manualDistanceKm ? Number(rawInput.manualDistanceKm) : undefined,
      transportMode,
      materialType,
      emissionFactorKgCo2ePerTonKm: rawInput.emissionFactorKgCo2ePerTonKm
        ? Number(rawInput.emissionFactorKgCo2ePerTonKm)
        : undefined,
    };

    const payload = await calculateCarbonForProject({
      projectId,
      organisationId: req.authUser!.organisationId,
      carbonInput,
    });

    const materialKgCo2e = Number(rawInput.materialKgCo2e || 0);
    const transportKgCo2e = payload.result.breakdown.transportKgCo2e;

    await appendDomainAudit({
      entityType: 'ProjectPlan',
      entityId: `${projectId}:carbon`,
      action: 'CARBON_CALCULATE',
      userId: req.authUser!.id,
      payload: {
        projectId,
        totalKgCo2e: payload.result.totalKgCo2e,
        quality: payload.result.quality,
        method: payload.result.method,
      },
    });

    res.json({
      ok: true,
      result: {
        ...payload.result,
        breakdown: {
          transport: transportKgCo2e,
          material: materialKgCo2e,
        },
      },
      plan: payload.plan,
    });
  } catch (error) {
    next(error);
  }
});

router.get('/api/permits', requireAuth, rateLimitByUser(60, 60_000), async (req, res, next) => {
  try {
    if (!req.authUser) return res.status(401).json({ ok: false, error: 'Unauthorized' });

    const docs = await prisma.documentRecord.findMany({
      where: { organisationId: req.authUser.organisationId },
      orderBy: { receivedTime: 'desc' },
      take: 200,
      select: {
        id: true,
        originalName: true,
        fileSha256: true,
        receivedTime: true,
        municipalityNormalized: true,
        municipality: true,
        activityCode: true,
        wasteType: true,
        decisionType: true,
        updatedAt: true,
        createdAt: true,
      },
    });

    const permits = docs.map((doc) => ({
      id: doc.id,
      filename: doc.originalName,
      checksum: doc.fileSha256 ?? '',
      received_date: (doc.receivedTime ?? doc.createdAt).toISOString().slice(0, 10),
      property_id: '',
      municipality: doc.municipalityNormalized ?? doc.municipality ?? '',
      waste_codes: [doc.activityCode, doc.wasteType].filter(Boolean).join(', '),
      decision_type: (doc.decisionType as 'BIFALL' | 'AVSLAG') ?? 'BIFALL',
      full_text: '',
    }));

    res.json({ ok: true, permits });
  } catch (error) {
    next(error);
  }
});

export default router;
