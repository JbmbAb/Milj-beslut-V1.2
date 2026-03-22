import express from "express";
import { requireAuth } from "../security/auth";
import { rateLimitByUser } from "../security/rateLimit";
import { toSafeErrorResponse } from "../security/secureErrors";
import {
  getProjectPlanSnapshot,
  saveProjectPlanSnapshot,
  applyTemplateForProject,
  evaluateGateForProject,
  calculateCarbonForProject,
  recommendMapLayersForProject,
  createDispatchQuoteForProject,
  bookTransportForProject,
  upsertDriverJournalForProject,
  signDriverJournalForProject,
  ingestLimsReportForProject,
  verifyLimsReportForProject,
} from "../services/projectPlanService";
import { listProjectMembers, upsertProjectMember, removeProjectMember, isValidRole } from "../services/projectMemberService";
import { assertProjectMembership } from "../repositories/projectAccessRepository";
import { appendDomainAudit } from "../security/auditTrail";
import { notifyStageGate, sendProjectNotification } from "../services/notificationService";
import {
  asOptionalProjectPlan,
  parseMapLayerList,
  allowedStageGateTypes,
  parseOptionalDriverJournalStatus,
  parseOptionalLimsSource,
  parseOptionalText,
} from "../utils/routeUtils";
import { StageGateType, ProjectAccessRole, ProjectMemberRecord, CarbonInput } from "../../types";

const router = express.Router();

router.get("/api/projects/:projectId/plan", requireAuth, rateLimitByUser(30, 60_000), async (req, res) => {
  try {
    if (!req.authUser) {
      res.status(401).json({ ok: false, error: "Unauthorized" });
      return;
    }

    const projectId = String(req.params.projectId || "");
    if (!projectId) {
      res.status(400).json({ ok: false, error: "projectId is required" });
      return;
    }

    await assertProjectMembership({
      projectId,
      userId: req.authUser.id,
      organisationId: req.authUser.organisationId,
      role: req.authUser.role,
    });

    const plan = await getProjectPlanSnapshot(projectId, req.authUser.organisationId);
    res.json({ ok: true, plan });
  } catch (error: unknown) {
    res.status(400).json(toSafeErrorResponse(error));
  }
});

router.post("/api/projects/:projectId/plan/save", requireAuth, rateLimitByUser(30, 60_000), async (req, res) => {
  try {
    if (!req.authUser) {
      res.status(401).json({ ok: false, error: "Unauthorized" });
      return;
    }

    const projectId = String(req.params.projectId || "");
    if (!projectId) {
      res.status(400).json({ ok: false, error: "projectId is required" });
      return;
    }

    await assertProjectMembership({
      projectId,
      userId: req.authUser.id,
      organisationId: req.authUser.organisationId,
      role: req.authUser.role,
    });

    const plan = await saveProjectPlanSnapshot({
      projectId,
      organisationId: req.authUser.organisationId,
      plan: asOptionalProjectPlan(req.body?.plan),
    });

    await appendDomainAudit({
      entityType: "ProjectPlan",
      entityId: `${projectId}:save`,
      action: "PLAN_SAVE",
      userId: req.authUser.id,
      payload: {
        projectId,
        templateId: plan.templateId,
        projectType: plan.projectType,
      },
    });

    res.json({ ok: true, plan });
  } catch (error: unknown) {
    res.status(400).json(toSafeErrorResponse(error));
  }
});

router.post("/api/projects/:projectId/template/apply", requireAuth, rateLimitByUser(20, 60_000), async (req, res) => {
  try {
    if (!req.authUser) {
      res.status(401).json({ ok: false, error: "Unauthorized" });
      return;
    }

    const projectId = String(req.params.projectId || "");
    const templateId = String(req.body?.templateId || "");
    if (!projectId || !templateId) {
      res.status(400).json({ ok: false, error: "projectId and templateId are required" });
      return;
    }

    await assertProjectMembership({
      projectId,
      userId: req.authUser.id,
      organisationId: req.authUser.organisationId,
      role: req.authUser.role,
    });

    const plan = await applyTemplateForProject({
      projectId,
      organisationId: req.authUser.organisationId,
      templateId,
      plan: asOptionalProjectPlan(req.body?.plan),
    });

    await appendDomainAudit({
      entityType: "ProjectPlan",
      entityId: `${projectId}:template:${templateId}`,
      action: "TEMPLATE_APPLY",
      userId: req.authUser.id,
      payload: {
        projectId,
        templateId,
        projectType: plan.projectType,
      },
    });

    res.json({ ok: true, plan });
  } catch (error: unknown) {
    res.status(400).json(toSafeErrorResponse(error));
  }
});

router.post("/api/projects/:projectId/stage-gates/:gateId/evaluate", requireAuth, rateLimitByUser(40, 60_000), async (req, res) => {
  try {
    if (!req.authUser) {
      res.status(401).json({ ok: false, error: "Unauthorized" });
      return;
    }

    const projectId = String(req.params.projectId || "");
    const gateId = String(req.params.gateId || "");
    if (!projectId || !gateId) {
      res.status(400).json({ ok: false, error: "projectId and gateId are required" });
      return;
    }

    const gateType = gateId.startsWith("gate-") ? gateId.replace(/^gate-/, "") : gateId;
    if (!allowedStageGateTypes.includes(gateType as StageGateType)) {
      res.status(400).json({ ok: false, error: "Invalid gateId" });
      return;
    }

    await assertProjectMembership({
      projectId,
      userId: req.authUser.id,
      organisationId: req.authUser.organisationId,
      role: req.authUser.role,
    });

    const evaluated = await evaluateGateForProject({
      projectId,
      organisationId: req.authUser.organisationId,
      gateId,
      plan: asOptionalProjectPlan(req.body?.plan),
      context: {
        permitType: req.body?.permitType ? String(req.body.permitType) : undefined,
        codeType:
          req.body?.codeType === "SNI" || req.body?.codeType === "EWC"
            ? req.body.codeType
            : undefined,
        permitSubmitted: typeof req.body?.permitSubmitted === "boolean" ? req.body.permitSubmitted : undefined,
        mapLayerAvailable: parseMapLayerList(req.body?.mapLayerAvailable),
        note: req.body?.note ? String(req.body.note) : undefined,
      },
    });

    if (!evaluated.idempotent) {
      await appendDomainAudit({
        entityType: "ProjectPlan",
        entityId: `${projectId}:${evaluated.gate.id}`,
        action: "STAGE_GATE_EVALUATE",
        userId: req.authUser.id,
        payload: {
          projectId,
          gateId: evaluated.gate.id,
          status: evaluated.gate.status,
          changed: evaluated.changed,
        },
      });

      void notifyStageGate({
        projectId,
        gateId: evaluated.gate.id,
        status: String(evaluated.gate.status ?? 'BLOCKED'),
        actingUserId: req.authUser.id,
      }).catch(() => {/* best-effort */});
    }

    res.json({
      ok: true,
      gate: evaluated.gate,
      changed: evaluated.changed,
      idempotent: evaluated.idempotent,
      plan: evaluated.plan,
    });
  } catch (error: unknown) {
    res.status(400).json(toSafeErrorResponse(error));
  }
});

router.get("/api/projects/:projectId/members", requireAuth, rateLimitByUser(30, 60_000), async (req, res) => {
  try {
    if (!req.authUser) { res.status(401).json({ ok: false, error: "Unauthorized" }); return; }
    const projectId = String(req.params.projectId || "");
    if (!projectId) { res.status(400).json({ ok: false, error: "projectId is required" }); return; }

    await assertProjectMembership({
      projectId,
      userId: req.authUser.id,
      organisationId: req.authUser.organisationId,
      role: req.authUser.role,
    });

    const members: ProjectMemberRecord[] = await listProjectMembers(projectId);
    res.json({ ok: true, members });
  } catch (error: unknown) {
    res.status(400).json(toSafeErrorResponse(error));
  }
});

router.put("/api/projects/:projectId/members", requireAuth, rateLimitByUser(20, 60_000), async (req, res) => {
  try {
    if (!req.authUser) { res.status(401).json({ ok: false, error: "Unauthorized" }); return; }
    const projectId = String(req.params.projectId || "");
    const targetBankidId = String(req.body?.bankidId ?? "").trim();
    const role = String(req.body?.role ?? "") as ProjectAccessRole;

    if (!projectId || !targetBankidId || !role) {
      res.status(400).json({ ok: false, error: "projectId, bankidId and role are required" });
      return;
    }
    if (!isValidRole(role)) {
      res.status(400).json({ ok: false, error: `Invalid role. Must be one of: OWNER, CONTRIBUTOR, REVIEWER, AUDITOR` });
      return;
    }

    await assertProjectMembership({
      projectId,
      userId: req.authUser.id,
      organisationId: req.authUser.organisationId,
      role: req.authUser.role,
    });

    const member = await upsertProjectMember({
      projectId,
      targetBankidId,
      role,
      actingUserId: req.authUser.id,
    });

    void sendProjectNotification({
      projectId,
      event: 'MEMBER_ADDED',
      subjectUserId: member.userId,
      actingUserId: req.authUser.id,
      message: `Användare ${targetBankidId} lades till i projekt ${projectId} med roll ${role}.`,
    }).catch(() => {/* best-effort */});

    res.json({ ok: true, member });
  } catch (error: unknown) {
    res.status(400).json(toSafeErrorResponse(error));
  }
});

router.delete("/api/projects/:projectId/members/:memberId", requireAuth, rateLimitByUser(20, 60_000), async (req, res) => {
  try {
    if (!req.authUser) { res.status(401).json({ ok: false, error: "Unauthorized" }); return; }
    const projectId = String(req.params.projectId || "");
    const memberId = String(req.params.memberId || "");
    if (!projectId || !memberId) { res.status(400).json({ ok: false, error: "projectId and memberId are required" }); return; }

    await assertProjectMembership({
      projectId,
      userId: req.authUser.id,
      organisationId: req.authUser.organisationId,
      role: req.authUser.role,
    });

    await removeProjectMember({
      projectId,
      memberId,
      actingUserId: req.authUser.id,
    });

    void sendProjectNotification({
      projectId,
      event: 'MEMBER_REMOVED',
      actingUserId: req.authUser.id,
      message: `Projektmedlem ${memberId} togs bort från projekt ${projectId}.`,
    }).catch(() => {/* best-effort */});

    res.json({ ok: true });
  } catch (error: unknown) {
    res.status(400).json(toSafeErrorResponse(error));
  }
});

router.post("/api/projects/:projectId/carbon/calculate", requireAuth, rateLimitByUser(40, 60_000), async (req, res) => {
  try {
    if (!req.authUser) {
      res.status(401).json({ ok: false, error: "Unauthorized" });
      return;
    }

    const projectId = String(req.params.projectId || "");
    if (!projectId) {
      res.status(400).json({ ok: false, error: "projectId is required" });
      return;
    }

    await assertProjectMembership({
      projectId,
      userId: req.authUser.id,
      organisationId: req.authUser.organisationId,
      role: req.authUser.role,
    });

    const rawInput = (req.body?.carbonInput || {}) as Partial<CarbonInput>;
    const transportMode = String(rawInput.transportMode || "TRUCK") as CarbonInput["transportMode"];
    const materialType = String(rawInput.materialType || "SOIL") as CarbonInput["materialType"];
    if (!["TRUCK", "RAIL", "SHIP"].includes(transportMode) || !["SOIL", "ROCK", "WASTE", "MIXED"].includes(materialType)) {
      res.status(400).json({ ok: false, error: "Invalid carbon input mode or material type" });
      return;
    }

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
      organisationId: req.authUser.organisationId,
      carbonInput,
      plan: asOptionalProjectPlan(req.body?.plan),
    });

    await appendDomainAudit({
      entityType: "ProjectPlan",
      entityId: `${projectId}:carbon`,
      action: "CARBON_CALCULATE",
      userId: req.authUser.id,
      payload: {
        projectId,
        totalKgCo2e: payload.result.totalKgCo2e,
        quality: payload.result.quality,
        method: payload.result.method,
      },
    });

    res.json({ ok: true, result: payload.result, plan: payload.plan });
  } catch (error: unknown) {
    res.status(400).json(toSafeErrorResponse(error));
  }
});

router.post("/api/projects/:projectId/map-layers/recommend", requireAuth, rateLimitByUser(30, 60_000), async (req, res) => {
  try {
    if (!req.authUser) {
      res.status(401).json({ ok: false, error: "Unauthorized" });
      return;
    }

    const projectId = String(req.params.projectId || "");
    if (!projectId) {
      res.status(400).json({ ok: false, error: "projectId is required" });
      return;
    }

    await assertProjectMembership({
      projectId,
      userId: req.authUser.id,
      organisationId: req.authUser.organisationId,
      role: req.authUser.role,
    });

    const result = await recommendMapLayersForProject({
      projectId,
      organisationId: req.authUser.organisationId,
      plan: asOptionalProjectPlan(req.body?.plan),
    });

    res.json({ ok: true, ...result });
  } catch (error: unknown) {
    res.status(400).json(toSafeErrorResponse(error));
  }
});

router.post("/api/projects/:projectId/dispatch/quote", requireAuth, rateLimitByUser(20, 60_000), async (req, res) => {
  try {
    if (!req.authUser) {
      res.status(401).json({ ok: false, error: "Unauthorized" });
      return;
    }

    const projectId = String(req.params.projectId || "");
    const receiverId = String(req.body?.receiverId || "").trim();
    const receiverName = String(req.body?.receiverName || "").trim();
    const wasteCode = String(req.body?.wasteCode || "").trim();
    const tons = Number(req.body?.tons || 0);
    const distanceKm = req.body?.distanceKm == null ? undefined : Number(req.body.distanceKm);

    if (!projectId || !receiverId || !receiverName || !wasteCode || !Number.isFinite(tons) || tons <= 0) {
      res.status(400).json({ ok: false, error: "projectId, receiverId, receiverName, wasteCode and positive tons are required" });
      return;
    }

    await assertProjectMembership({
      projectId,
      userId: req.authUser.id,
      organisationId: req.authUser.organisationId,
      role: req.authUser.role,
    });

    const payload = await createDispatchQuoteForProject({
      projectId,
      organisationId: req.authUser.organisationId,
      receiverId,
      receiverName,
      wasteCode,
      tons,
      distanceKm,
      plan: asOptionalProjectPlan(req.body?.plan),
    });

    res.json({ ok: true, quote: payload.quote, plan: payload.plan });
  } catch (error: unknown) {
    res.status(400).json(toSafeErrorResponse(error));
  }
});

router.post("/api/projects/:projectId/dispatch/book", requireAuth, rateLimitByUser(20, 60_000), async (req, res) => {
  try {
    if (!req.authUser) {
      res.status(401).json({ ok: false, error: "Unauthorized" });
      return;
    }

    const projectId = String(req.params.projectId || "");
    const quoteId = String(req.body?.quoteId || "").trim();
    const plannedPickupAt = parseOptionalText(req.body?.plannedPickupAt);

    if (!projectId || !quoteId) {
      res.status(400).json({ ok: false, error: "projectId and quoteId are required" });
      return;
    }

    await assertProjectMembership({
      projectId,
      userId: req.authUser.id,
      organisationId: req.authUser.organisationId,
      role: req.authUser.role,
    });

    const payload = await bookTransportForProject({
      projectId,
      organisationId: req.authUser.organisationId,
      quoteId,
      plannedPickupAt,
      plan: asOptionalProjectPlan(req.body?.plan),
    });

    res.json({ ok: true, booking: payload.booking, plan: payload.plan });
  } catch (error: unknown) {
    res.status(400).json(toSafeErrorResponse(error));
  }
});

router.post("/api/projects/:projectId/driver-journals/upsert", requireAuth, rateLimitByUser(30, 60_000), async (req, res) => {
  try {
    if (!req.authUser) {
      res.status(401).json({ ok: false, error: "Unauthorized" });
      return;
    }

    const projectId = String(req.params.projectId || "");
    const journal = req.body?.journal;
    const bookingId = String(journal?.bookingId || "").trim();
    const driverName = String(journal?.driverName || "").trim();
    const vehicleId = String(journal?.vehicleId || "").trim();
    const origin = String(journal?.origin || "").trim();
    const destination = String(journal?.destination || "").trim();
    const wasteCode = String(journal?.wasteCode || "").trim();
    const tons = Number(journal?.tons || 0);
    const odometerStartKm = Number(journal?.odometerStartKm || 0);

    if (
      !projectId ||
      !bookingId ||
      !driverName ||
      !vehicleId ||
      !origin ||
      !destination ||
      !wasteCode ||
      !Number.isFinite(tons) ||
      tons <= 0 ||
      !Number.isFinite(odometerStartKm) ||
      odometerStartKm < 0
    ) {
      res.status(400).json({
        ok: false,
        error: "projectId and complete journal payload are required",
      });
      return;
    }

    await assertProjectMembership({
      projectId,
      userId: req.authUser.id,
      organisationId: req.authUser.organisationId,
      role: req.authUser.role,
    });

    const payload = await upsertDriverJournalForProject({
      projectId,
      organisationId: req.authUser.organisationId,
      journal: {
        id: parseOptionalText(journal?.id),
        bookingId,
        driverName,
        vehicleId,
        origin,
        destination,
        wasteCode,
        tons,
        startedAt: parseOptionalText(journal?.startedAt),
        endedAt: journal?.endedAt == null ? undefined : parseOptionalText(journal?.endedAt) ?? null,
        odometerStartKm,
        odometerEndKm: journal?.odometerEndKm == null ? undefined : Number(journal.odometerEndKm),
        gpsTrackHash: parseOptionalText(journal?.gpsTrackHash),
        status: parseOptionalDriverJournalStatus(journal?.status),
      },
      plan: asOptionalProjectPlan(req.body?.plan),
    });

    res.json({ ok: true, journal: payload.journal, plan: payload.plan });
  } catch (error: unknown) {
    res.status(400).json(toSafeErrorResponse(error));
  }
});

router.post("/api/projects/:projectId/driver-journals/:journalId/sign", requireAuth, rateLimitByUser(40, 60_000), async (req, res) => {
  try {
    if (!req.authUser) {
      res.status(401).json({ ok: false, error: "Unauthorized" });
      return;
    }

    const projectId = String(req.params.projectId || "");
    const journalId = String(req.params.journalId || "");
    const signerRole = req.body?.signerRole === "REVIEWER" ? "REVIEWER" : req.body?.signerRole === "DRIVER" ? "DRIVER" : null;
    const signatureId = String(req.body?.signatureId || "").trim();

    if (!projectId || !journalId || !signerRole || !signatureId) {
      res.status(400).json({ ok: false, error: "projectId, journalId, signerRole and signatureId are required" });
      return;
    }

    await assertProjectMembership({
      projectId,
      userId: req.authUser.id,
      organisationId: req.authUser.organisationId,
      role: req.authUser.role,
    });

    const payload = await signDriverJournalForProject({
      projectId,
      organisationId: req.authUser.organisationId,
      journalId,
      signerRole,
      signatureId,
      plan: asOptionalProjectPlan(req.body?.plan),
    });

    res.json({ ok: true, journal: payload.journal, plan: payload.plan });
  } catch (error: unknown) {
    res.status(400).json(toSafeErrorResponse(error));
  }
});

router.post("/api/projects/:projectId/lims/ingest", requireAuth, rateLimitByUser(20, 60_000), async (req, res) => {
  try {
    if (!req.authUser) {
      res.status(401).json({ ok: false, error: "Unauthorized" });
      return;
    }

    const projectId = String(req.params.projectId || "");
    const report = req.body?.report;
    const sampleId = String(report?.sampleId || "").trim();
    const labName = String(report?.labName || "").trim();
    const rawReference = String(report?.rawReference || "").trim();
    const metrics = Array.isArray(report?.metrics) ? report.metrics : [];

    if (!projectId || !sampleId || !labName || !rawReference || metrics.length === 0) {
      res.status(400).json({ ok: false, error: "projectId and complete report payload are required" });
      return;
    }

    await assertProjectMembership({
      projectId,
      userId: req.authUser.id,
      organisationId: req.authUser.organisationId,
      role: req.authUser.role,
    });

    const payload = await ingestLimsReportForProject({
      projectId,
      organisationId: req.authUser.organisationId,
      report: {
        bookingId: report?.bookingId == null ? undefined : parseOptionalText(report.bookingId) ?? null,
        sampleId,
        labName,
        source: parseOptionalLimsSource(report?.source),
        analyzedAt: parseOptionalText(report?.analyzedAt),
        rawReference,
        metrics: metrics.map((metric: unknown) => {
          const value = metric && typeof metric === "object" ? (metric as Record<string, unknown>) : {};
          return {
            key: String(value.key || "").trim(),
            value: Number(value.value || 0),
            unit: String(value.unit || "").trim(),
            maxAllowed: value.maxAllowed == null ? undefined : Number(value.maxAllowed),
          };
        }),
        passed: typeof report?.passed === "boolean" ? report.passed : undefined,
      },
      plan: asOptionalProjectPlan(req.body?.plan),
    });

    res.json({ ok: true, report: payload.report, plan: payload.plan });
  } catch (error: unknown) {
    res.status(400).json(toSafeErrorResponse(error));
  }
});

router.post("/api/projects/:projectId/lims/:reportId/verify", requireAuth, rateLimitByUser(20, 60_000), async (req, res) => {
  try {
    if (!req.authUser) {
      res.status(401).json({ ok: false, error: "Unauthorized" });
      return;
    }

    const projectId = String(req.params.projectId || "");
    const reportId = String(req.params.reportId || "");
    const reviewer = String(req.body?.reviewer || "").trim();
    const signatureId = String(req.body?.signatureId || "").trim();

    if (!projectId || !reportId || !reviewer || !signatureId) {
      res.status(400).json({ ok: false, error: "projectId, reportId, reviewer and signatureId are required" });
      return;
    }

    await assertProjectMembership({
      projectId,
      userId: req.authUser.id,
      organisationId: req.authUser.organisationId,
      role: req.authUser.role,
    });

    const payload = await verifyLimsReportForProject({
      projectId,
      organisationId: req.authUser.organisationId,
      reportId,
      reviewer,
      signatureId,
      approved: typeof req.body?.approved === "boolean" ? req.body.approved : undefined,
      plan: asOptionalProjectPlan(req.body?.plan),
    });

    res.json({ ok: true, report: payload.report, plan: payload.plan });
  } catch (error: unknown) {
    res.status(400).json(toSafeErrorResponse(error));
  }
});

export default router;
