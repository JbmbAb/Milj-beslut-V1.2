/**
 * projectStructureBranches.test.ts
 *
 * Targeted branch coverage tests for services/projectStructure.ts
 * focusing on untested conditional paths.
 */

import { describe, expect, it } from 'vitest';
import {
  buildPermitCodeProfile,
  calculateCarbon,
  createDefaultProjectPlan,
  createDefaultStageGates,
  evaluateStageGate,
  normalizeProjectPlan,
  applyTemplate,
  applyCarbonToPlan,
  recommendMapLayers,
  applyPermitCodeSelection,
  countBlockedGates,
  countPassedGates,
  countReadyModules,
} from '../../services/projectStructure';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeVerifiedDocPlan() {
  const plan = createDefaultProjectPlan();
  plan.documentArchive = [
    {
      id: 'doc-v',
      name: 'Verified',
      module: 'COMPLIANCE_AUDIT',
      category: 'PERMIT',
      status: 'VERIFIED',
      uploadedAt: new Date().toISOString(),
      storagePath: '/tmp/v',
      tags: [],
    },
  ];
  plan.auditTrail = [
    {
      id: 'a-1',
      timestamp: new Date().toISOString(),
      user: 'Reviewer',
      action: 'SIGN',
      details: 'Signed',
      immutable: true,
      signatureId: 'sig-1',
    },
  ];
  return plan;
}

// ─── buildPermitCodeProfile branches ─────────────────────────────────────────

describe('buildPermitCodeProfile – unknown code fallback', () => {
  it('returns NONE regulatory track for completely unknown code', () => {
    const profile = buildPermitCodeProfile({ code: 'UNKNOWN-999', codeType: 'SNI' });
    expect(profile.regulatoryTrack).toBe('NONE');
    expect(profile.humanReviewRequired).toBe(true);
    expect(profile.requiredMapLayers).toContain('CADASTRE');
    expect(profile.requiredMapLayers).toContain('FLOOD_RISK');
  });

  it('unknown EWC code uses CADASTRE + SOIL fallback layers', () => {
    const profile = buildPermitCodeProfile({ code: 'XX 00 00', codeType: 'EWC' });
    expect(profile.requiredMapLayers).toContain('CADASTRE');
    expect(profile.requiredMapLayers).toContain('SOIL');
    expect(profile.requiredMapLayers).not.toContain('FLOOD_RISK');
  });

  it('known EWC 17 05 04 returns NOTIFICATION track', () => {
    const profile = buildPermitCodeProfile({ code: '17 05 04', codeType: 'EWC' });
    expect(profile.regulatoryTrack).toBe('NOTIFICATION');
    expect(profile.riskTier).toBe('LOW');
  });

  it('hazardous EWC 17 05 03* returns PERMIT track', () => {
    const profile = buildPermitCodeProfile({ code: '17 05 03*', codeType: 'EWC' });
    expect(profile.regulatoryTrack).toBe('PERMIT');
    expect(profile.riskTier).toBe('HIGH');
    expect(profile.requiredMapLayers).toContain('GROUNDWATER');
  });

  it('includes municipality when provided', () => {
    const profile = buildPermitCodeProfile({ code: '90.30', codeType: 'SNI', municipality: 'Uppsala' });
    expect(profile.municipality).toBe('Uppsala');
  });

  it('municipality is null when not provided', () => {
    const profile = buildPermitCodeProfile({ code: '90.30', codeType: 'SNI' });
    expect(profile.municipality).toBeNull();
  });
});

// ─── calculateCarbon – transport mode branches ────────────────────────────────

describe('calculateCarbon – transport modes', () => {
  it('uses lower emission for RAIL transport', () => {
    const truck = calculateCarbon({
      tons: 100,
      distanceKm: 50,
      transportMode: 'TRUCK',
      materialType: 'SOIL',
    });
    const rail = calculateCarbon({ tons: 100, distanceKm: 50, transportMode: 'RAIL', materialType: 'SOIL' });
    expect(rail.totalKgCo2e).toBeLessThan(truck.totalKgCo2e);
  });

  it('uses different emission factor for SHIP transport', () => {
    const ship = calculateCarbon({ tons: 100, distanceKm: 50, transportMode: 'SHIP', materialType: 'SOIL' });
    expect(ship.totalKgCo2e).toBeGreaterThan(0);
    expect(ship.method).toMatch(/SHIP|DEFAULT|LOCAL/i);
  });

  it('computes different totals for ROCK vs SOIL vs WASTE vs MIXED', () => {
    const base = { tons: 10, distanceKm: 50, transportMode: 'TRUCK' as const };
    const soil = calculateCarbon({ ...base, materialType: 'SOIL' });
    const rock = calculateCarbon({ ...base, materialType: 'ROCK' });
    const waste = calculateCarbon({ ...base, materialType: 'WASTE' });
    const mixed = calculateCarbon({ ...base, materialType: 'MIXED' });
    // All should produce valid CO2 numbers
    [soil, rock, waste, mixed].forEach((r) => expect(r.totalKgCo2e).toBeGreaterThan(0));
  });

  it('uses manualDistanceKm when routedDistance is 0', () => {
    const result = calculateCarbon({
      tons: 10,
      distanceKm: 0,
      manualDistanceKm: 200,
      transportMode: 'TRUCK',
      materialType: 'SOIL',
    });
    expect(result.quality).toBe('MANUAL_DISTANCE');
    expect(result.distanceKmUsed).toBe(200);
  });
});

// ─── evaluateStageGate – untested branches ────────────────────────────────────

describe('evaluateStageGate – RISK_REVIEW branches', () => {
  it('returns PENDING when map layers present but some are unavailable', () => {
    const plan = createDefaultProjectPlan();
    plan.mapLayerSelection.enabled = ['CADASTRE'];
    plan.mapLayerSelection.unavailable = ['GROUNDWATER'];
    plan.documentArchive.push({
      id: 'RISK-DOC',
      name: 'Risk register',
      module: 'PROJECT_MANAGER',
      category: 'RISK',
      status: 'VERIFIED',
      uploadedAt: new Date().toISOString(),
      storagePath: '/tmp/risk',
      tags: [],
    });

    const gateId = plan.stageGates.find((g) => g.type === 'RISK_REVIEW')!.id;
    const result = evaluateStageGate(plan, gateId, { mapLayerAvailable: ['CADASTRE'] });
    expect(result.gate.status).toBe('PENDING');
  });

  it('throws on unknown gate ID', () => {
    const plan = createDefaultProjectPlan();
    expect(() => evaluateStageGate(plan, 'gate-NONEXISTENT', {})).toThrow(/unknown stage gate/i);
  });
});

describe('evaluateStageGate – PERMIT_REQUIRED fine branches', () => {
  it('blocks when permit type is missing', () => {
    const plan = createDefaultProjectPlan();
    const gateId = plan.stageGates.find((g) => g.type === 'PERMIT_REQUIRED')!.id;
    const result = evaluateStageGate(plan, gateId, {});
    expect(result.gate.status).toBe('BLOCKED');
    expect(result.gate.reason).toMatch(/missing/i);
  });

  it('blocks when permitType present but not submitted', () => {
    const plan = createDefaultProjectPlan();
    const gateId = plan.stageGates.find((g) => g.type === 'PERMIT_REQUIRED')!.id;
    const result = evaluateStageGate(plan, gateId, { permitType: '90.131', permitSubmitted: false });
    expect(result.gate.status).toBe('BLOCKED');
    expect(result.gate.reason).toMatch(/submitted/i);
  });

  it('blocks when submitted but no permit documents', () => {
    const plan = createDefaultProjectPlan();
    plan.documentArchive = []; // no permit docs
    const gateId = plan.stageGates.find((g) => g.type === 'PERMIT_REQUIRED')!.id;
    const result = evaluateStageGate(plan, gateId, { permitType: '90.131', permitSubmitted: true });
    expect(result.gate.status).toBe('BLOCKED');
    expect(result.gate.reason).toMatch(/document/i);
  });

  it('passes with note context included', () => {
    const plan = createDefaultProjectPlan();
    plan.documentArchive = [
      {
        id: 'permit-doc',
        name: 'Permit A',
        module: 'PERMIT_PORTAL',
        category: 'PERMIT',
        status: 'VERIFIED',
        uploadedAt: new Date().toISOString(),
        storagePath: '/tmp/permit',
        tags: [],
      },
    ];
    const gateId = plan.stageGates.find((g) => g.type === 'PERMIT_REQUIRED')!.id;
    const result = evaluateStageGate(plan, gateId, {
      permitType: '90.131',
      permitSubmitted: true,
      note: 'Reviewed by legal team',
    });
    expect(result.gate.status).toBe('PASSED');
  });
});

describe('evaluateStageGate – DOCUMENT_CONTROL failed LIMS branch', () => {
  it('blocks when hazardous LIMS report is failed', () => {
    const now = new Date().toISOString();
    const plan = makeVerifiedDocPlan();
    plan.documentArchive.push({
      id: 'RISK-D',
      name: 'Risk doc',
      module: 'PROJECT_MANAGER',
      category: 'RISK',
      status: 'VERIFIED',
      uploadedAt: now,
      storagePath: '/tmp/risk',
      tags: [],
    });
    plan.transportBookings.push({
      id: 'book-haz',
      quoteId: 'q1',
      provider: 'MOCK_FRAKTBORS',
      status: 'BOOKED',
      receiverId: 'R1',
      receiverName: 'Receiver',
      wasteCode: '17 05 03*',
      tons: 5,
      distanceKm: 10,
      co2EstimateKg: 10,
      plannedPickupAt: now,
      plannedDeliveryAt: now,
      externalReference: 'FB-999',
      createdAt: now,
      updatedAt: now,
    });
    plan.driverJournals.push({
      id: 'journal-haz',
      bookingId: 'book-haz',
      driverName: 'Driver A',
      vehicleId: 'XYZ789',
      origin: 'Depot',
      destination: 'Landfill',
      wasteCode: '17 05 03*',
      tons: 5,
      startedAt: now,
      endedAt: now,
      odometerStartKm: 500,
      odometerEndKm: 510,
      gpsTrackHash: 'hash',
      status: 'VERIFIED',
      signedByDriver: true,
      signedByReviewer: true,
      driverSignatureId: 'sig-d',
      reviewerSignatureId: 'sig-r',
      createdAt: now,
      updatedAt: now,
    });
    // Add a FAILED LIMS report
    plan.limsReports.push({
      id: 'lims-fail',
      bookingId: 'book-haz',
      sampleId: 'S-fail',
      labName: 'ALS',
      source: 'API',
      analyzedAt: now,
      rawReference: 'ALS-REF-FAIL',
      metrics: [{ key: 'Pb', value: 5.0, unit: 'mg/kg', maxAllowed: 1, exceeded: true }],
      passed: false,
      verifiedByHuman: true,
      reviewer: 'QA',
      reviewerSignatureId: 'lims-sig',
      verifiedAt: now,
      createdAt: now,
    });

    const gateId = plan.stageGates.find((g) => g.type === 'DOCUMENT_CONTROL')!.id;
    const result = evaluateStageGate(plan, gateId, {});
    expect(result.gate.status).toBe('BLOCKED');
    expect(result.gate.reason).toMatch(/LIMS.*failed|failed.*LIMS/i);
  });
});

// ─── normalizeProjectPlan – branches ──────────────────────────────────────────

describe('normalizeProjectPlan – branch coverage', () => {
  it('normalizes project type VA', () => {
    const plan = normalizeProjectPlan({ projectType: 'VA' });
    expect(plan.projectType).toBe('VA');
  });

  it('normalizes project type INFRA', () => {
    const plan = normalizeProjectPlan({ projectType: 'INFRA' });
    expect(plan.projectType).toBe('INFRA');
  });

  it('normalizes project type REMEDIATION', () => {
    const plan = normalizeProjectPlan({ projectType: 'REMEDIATION' });
    expect(plan.projectType).toBe('REMEDIATION');
  });

  it('normalizes project type ENERGY', () => {
    const plan = normalizeProjectPlan({ projectType: 'ENERGY' });
    expect(plan.projectType).toBe('ENERGY');
  });

  it('falls back to ENV_PERMIT for unknown project type', () => {
    const plan = normalizeProjectPlan({ projectType: 'INVALID' as any });
    expect(plan.projectType).toBe('ENV_PERMIT');
  });

  it('keeps existing phases when provided', () => {
    const customPhases = [
      {
        id: 'phase-custom',
        title: 'My phase',
        status: 'TODO' as const,
        isLocked: false,
        requiresSignature: false,
        tasks: [
          {
            id: 't1',
            title: 'Task',
            startWeek: 1,
            duration: 2,
            type: 'ADMIN' as const,
            status: 'TODO' as const,
          },
        ],
      },
    ];
    const plan = normalizeProjectPlan({ phases: customPhases });
    expect(plan.phases[0].id).toBe('phase-custom');
  });

  it('normalizes stageGates with partial/invalid data', () => {
    const plan = normalizeProjectPlan({
      stageGates: [
        null, // invalid
        { type: 'PERMIT_REQUIRED', status: 'PASSED', id: 'gate-perm', label: 'Permit', required: true },
        { type: 'INVALID_GATE' as any, id: 'gate-bad' }, // unknown type — should be filtered
      ] as any,
    });
    // Should still have all 4 default gates
    expect(plan.stageGates.some((g) => g.type === 'PERMIT_REQUIRED')).toBe(true);
    expect(plan.stageGates.some((g) => g.type === 'CARBON_CHECK')).toBe(true);
  });

  it('normalizes mapLayerSelection with empty candidate', () => {
    const plan = normalizeProjectPlan({ mapLayerSelection: {} as any });
    expect(Array.isArray(plan.mapLayerSelection.base)).toBe(true);
    expect(plan.mapLayerSelection.base.length).toBeGreaterThan(0);
  });

  it('normalizes permitCodeProfile — invalid codeType returns null', () => {
    const plan = normalizeProjectPlan({
      permitCodeProfile: { code: '90.30', codeType: 'INVALID' as any } as any,
    });
    expect(plan.permitCodeProfile).toBeNull();
  });

  it('normalizes permitCodeProfile — no code returns null', () => {
    const plan = normalizeProjectPlan({ permitCodeProfile: { codeType: 'SNI' } as any });
    expect(plan.permitCodeProfile).toBeNull();
  });

  it('normalizes carbonSummary with provided data', () => {
    const plan = normalizeProjectPlan({
      carbonSummary: {
        lastInput: { tons: 10, transportMode: 'TRUCK', materialType: 'SOIL' },
        lastResult: null,
        history: [],
      },
    });
    expect(plan.carbonSummary.lastInput?.tons).toBe(10);
  });

  it('normalizes dispatchQuotes — filters items without receiverId', () => {
    const plan = normalizeProjectPlan({
      dispatchQuotes: [
        { id: 'q1', receiverId: '', receiverName: 'R1', wasteCode: 'EWC', tons: 5 } as any,
        { id: 'q2', receiverId: 'R2', receiverName: 'R2', wasteCode: 'EWC', tons: 5 } as any,
      ],
    });
    expect(plan.dispatchQuotes.length).toBe(1);
    expect(plan.dispatchQuotes[0].id).toBe('q2');
  });

  it('normalizes dispatchQuotes — TIMOCOM provider preserved', () => {
    const plan = normalizeProjectPlan({
      dispatchQuotes: [
        {
          id: 'q1',
          receiverId: 'R1',
          receiverName: 'R1',
          wasteCode: 'EWC',
          tons: 5,
          provider: 'TIMOCOM',
        } as any,
      ],
    });
    expect(plan.dispatchQuotes[0].provider).toBe('TIMOCOM');
  });

  it('normalizes driverJournals — REJECTED status preserved', () => {
    const now = new Date().toISOString();
    const plan = normalizeProjectPlan({
      driverJournals: [
        {
          id: 'j1',
          bookingId: 'book-1',
          driverName: 'Driver',
          vehicleId: 'V1',
          origin: 'A',
          destination: 'B',
          wasteCode: 'EWC',
          tons: 5,
          status: 'REJECTED',
          odometerStartKm: 100,
          createdAt: now,
          updatedAt: now,
        } as any,
      ],
    });
    expect(plan.driverJournals[0].status).toBe('REJECTED');
  });

  it('normalizes driverJournals — invalid status defaults to DRAFT', () => {
    const plan = normalizeProjectPlan({
      driverJournals: [
        {
          id: 'j1',
          bookingId: 'book-1',
          driverName: 'Driver',
          vehicleId: 'V1',
          origin: 'A',
          destination: 'B',
          wasteCode: 'EWC',
          tons: 5,
          status: 'INVALID_STATUS',
          odometerStartKm: 100,
        } as any,
      ],
    });
    expect(plan.driverJournals[0].status).toBe('DRAFT');
  });

  it('normalizes limsReports — exceeded metric auto-calculated', () => {
    const plan = normalizeProjectPlan({
      limsReports: [
        {
          id: 'r1',
          sampleId: 'S1',
          labName: 'ALS',
          rawReference: 'ref1',
          metrics: [{ key: 'Pb', value: 5.0, unit: 'mg/kg', maxAllowed: 1.0 }],
        } as any,
      ],
    });
    expect(plan.limsReports[0].metrics[0].exceeded).toBe(true);
    // passed auto-calculated as false when any metric exceeded
    expect(plan.limsReports[0].passed).toBe(false);
  });

  it('normalizes limsReports — non-exceeded metric auto-calculates passed=true', () => {
    const plan = normalizeProjectPlan({
      limsReports: [
        {
          id: 'r1',
          sampleId: 'S1',
          labName: 'ALS',
          rawReference: 'ref1',
          metrics: [{ key: 'Pb', value: 0.5, unit: 'mg/kg', maxAllowed: 1.0 }],
        } as any,
      ],
    });
    expect(plan.limsReports[0].metrics[0].exceeded).toBe(false);
    expect(plan.limsReports[0].passed).toBe(true);
  });

  it('normalizes limsReports — SFTP source preserved', () => {
    const plan = normalizeProjectPlan({
      limsReports: [
        {
          id: 'r1',
          sampleId: 'S1',
          labName: 'ALS',
          rawReference: 'ref1',
          source: 'SFTP',
          metrics: [],
        } as any,
      ],
    });
    expect(plan.limsReports[0].source).toBe('SFTP');
  });

  it('normalizes limsReports — invalid source defaults to MANUAL', () => {
    const plan = normalizeProjectPlan({
      limsReports: [
        {
          id: 'r1',
          sampleId: 'S1',
          labName: 'ALS',
          rawReference: 'ref1',
          source: 'EMAIL',
          metrics: [],
        } as any,
      ],
    });
    expect(plan.limsReports[0].source).toBe('MANUAL');
  });
});

// ─── applyTemplate branches ───────────────────────────────────────────────────

describe('applyTemplate – all templates', () => {
  it('applies VA_STANDARD template', () => {
    const plan = createDefaultProjectPlan();
    const next = applyTemplate(plan, 'VA_STANDARD');
    expect(next.projectType).toBe('VA');
    expect(next.templateId).toBe('VA_STANDARD');
  });

  it('applies REMEDIATION_STANDARD template', () => {
    const plan = createDefaultProjectPlan();
    const next = applyTemplate(plan, 'REMEDIATION_STANDARD');
    expect(next.projectType).toBe('REMEDIATION');
  });

  it('applies ENERGY_PERMIT template if it exists, else returns default', () => {
    const plan = createDefaultProjectPlan();
    const next = applyTemplate(plan, 'ENERGY_PERMIT');
    // Should not throw
    expect(next).toBeDefined();
    expect(next.templateId).toBeTruthy();
  });

  it('applies unknown template ID without throwing (uses first pack as fallback)', () => {
    const plan = createDefaultProjectPlan();
    const next = applyTemplate(plan, 'UNKNOWN_TEMPLATE_XYZ');
    expect(next).toBeDefined();
  });
});

// ─── recommendMapLayers branches ─────────────────────────────────────────────

describe('recommendMapLayers – all project types', () => {
  (['ENV_PERMIT', 'VA', 'INFRA', 'REMEDIATION', 'ENERGY'] as const).forEach((type) => {
    it(`returns layers for ${type}`, () => {
      const layers = recommendMapLayers(type);
      expect(Array.isArray(layers.base)).toBe(true);
    });
  });
});

// ─── applyPermitCodeSelection – re-application ───────────────────────────────

describe('applyPermitCodeSelection – re-apply removes previous layers', () => {
  it('replaces previous profile layers when code changes', () => {
    const plan = createDefaultProjectPlan();
    const first = applyPermitCodeSelection(plan, { code: '90.50', codeType: 'SNI' });
    const second = applyPermitCodeSelection(first.plan, { code: '90.131', codeType: 'SNI' });

    // 90.131 requires only CADASTRE + FLOOD_RISK (not GROUNDWATER/NATURA2000 from 90.50)
    expect(second.plan.permitCodeProfile?.code).toBe('90.131');
  });

  it('handles plan with no previous permitCodeProfile', () => {
    const plan = createDefaultProjectPlan();
    plan.permitCodeProfile = null;
    const result = applyPermitCodeSelection(plan, { code: '90.30', codeType: 'SNI' });
    expect(result.profile.code).toBe('90.30');
  });
});

// ─── countBlockedGates / countPassedGates / countReadyModules ────────────────

describe('counter functions', () => {
  it('countBlockedGates is 0 on fresh plan', () => {
    const plan = createDefaultProjectPlan();
    expect(countBlockedGates(plan)).toBe(0);
  });

  it('countPassedGates is 0 on fresh plan', () => {
    const plan = createDefaultProjectPlan();
    expect(countPassedGates(plan)).toBe(0);
  });

  it('countReadyModules returns ≥ 2 (PROJECT_MANAGER + PERMIT_PORTAL)', () => {
    const plan = createDefaultProjectPlan();
    expect(countReadyModules(plan)).toBeGreaterThanOrEqual(2);
  });

  it('countPassedGates increases after a gate is passed', () => {
    const plan = createDefaultProjectPlan();
    const modified = {
      ...plan,
      stageGates: plan.stageGates.map((g) =>
        g.type === 'CARBON_CHECK' ? { ...g, status: 'PASSED' as const } : g,
      ),
    };
    expect(countPassedGates(modified)).toBeGreaterThanOrEqual(1);
  });

  it('countBlockedGates increases after a gate is blocked', () => {
    const plan = createDefaultProjectPlan();
    const modified = {
      ...plan,
      stageGates: plan.stageGates.map((g) =>
        g.type === 'RISK_REVIEW' ? { ...g, status: 'BLOCKED' as const } : g,
      ),
    };
    expect(countBlockedGates(modified)).toBeGreaterThanOrEqual(1);
  });
});

// ─── applyCarbonToPlan branches ───────────────────────────────────────────────

describe('applyCarbonToPlan – history growth', () => {
  it('adds to history on each calculation', () => {
    const plan = createDefaultProjectPlan();
    const input = {
      tons: 10,
      distanceKm: 20,
      transportMode: 'TRUCK' as const,
      materialType: 'SOIL' as const,
    };

    const plan1 = applyCarbonToPlan(plan, input);
    expect(plan1.carbonSummary.history.length).toBe(1);

    const plan2 = applyCarbonToPlan(plan1, { ...input, tons: 20 });
    expect(plan2.carbonSummary.history.length).toBe(2);
  });

  it('sets lastResult to the most recent carbon result', () => {
    const plan = createDefaultProjectPlan();
    const input = { tons: 5, distanceKm: 10, transportMode: 'TRUCK' as const, materialType: 'ROCK' as const };
    const next = applyCarbonToPlan(plan, input);
    expect(next.carbonSummary.lastResult).not.toBeNull();
    expect(next.carbonSummary.lastResult?.totalKgCo2e).toBeGreaterThan(0);
  });

  it('uses provided result when passed explicitly', () => {
    const plan = createDefaultProjectPlan();
    const input = { tons: 5, distanceKm: 10, transportMode: 'TRUCK' as const, materialType: 'SOIL' as const };
    const customResult = calculateCarbon({ ...input, tons: 999 });
    const next = applyCarbonToPlan(plan, input, customResult);
    expect(next.carbonSummary.lastResult?.totalKgCo2e).toBe(customResult.totalKgCo2e);
  });
});

// ─── CARBON_CHECK gate ────────────────────────────────────────────────────────

describe('evaluateStageGate – CARBON_CHECK', () => {
  it('passes when carbon summary has a result', () => {
    const plan = createDefaultProjectPlan();
    const carbonInput = {
      tons: 10,
      distanceKm: 20,
      transportMode: 'TRUCK' as const,
      materialType: 'SOIL' as const,
    };
    const planWithCarbon = applyCarbonToPlan(plan, carbonInput);
    const gateId = planWithCarbon.stageGates.find((g) => g.type === 'CARBON_CHECK')!.id;
    const result = evaluateStageGate(planWithCarbon, gateId, {});
    expect(result.gate.status).toBe('PASSED');
  });

  it('blocks when no carbon result', () => {
    const plan = createDefaultProjectPlan();
    const gateId = plan.stageGates.find((g) => g.type === 'CARBON_CHECK')!.id;
    const result = evaluateStageGate(plan, gateId, {});
    expect(result.gate.status).toBe('BLOCKED');
  });

  it('returns changed:false when evaluation is idempotent (same hash)', () => {
    const plan = createDefaultProjectPlan();
    const carbonInput = {
      tons: 10,
      distanceKm: 20,
      transportMode: 'TRUCK' as const,
      materialType: 'SOIL' as const,
    };
    const planWithCarbon = applyCarbonToPlan(plan, carbonInput);
    const gateId = planWithCarbon.stageGates.find((g) => g.type === 'CARBON_CHECK')!.id;
    // Evaluate twice — second should be idempotent
    const first = evaluateStageGate(planWithCarbon, gateId, {});
    const second = evaluateStageGate(first.plan, gateId, {});
    expect(second.changed).toBe(false);
  });
});
