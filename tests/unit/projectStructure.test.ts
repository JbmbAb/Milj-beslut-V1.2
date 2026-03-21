import { describe, expect, it } from 'vitest';
import {
  applyPermitCodeSelection,
  applyCarbonToPlan,
  applyTemplate,
  calculateCarbon,
  createDefaultProjectPlan,
  evaluateStageGate,
  normalizeProjectPlan,
} from '../../services/projectStructure';

function withPermitDocument() {
  const plan = createDefaultProjectPlan();
  plan.documentArchive = [
    {
      id: 'DOC-PERMIT',
      name: 'Permit A',
      module: 'PERMIT_PORTAL',
      category: 'PERMIT',
      status: 'VERIFIED',
      uploadedAt: new Date().toISOString(),
      storagePath: '/tmp/permit-a',
      tags: ['permit'],
    },
  ];
  return plan;
}

describe('projectStructure', () => {
  it('normalizes null plan to defaults', () => {
    const normalized = normalizeProjectPlan(null);
    expect(normalized.name).toBe('Nytt Projekt');
    expect(normalized.stageGates.length).toBeGreaterThan(0);
  });

  it('creates a default WBS-like structure with phases and task sequencing', () => {
    const plan = createDefaultProjectPlan();
    expect(plan.phases.length).toBeGreaterThanOrEqual(3);
    expect(plan.phases.every((phase) => Array.isArray(phase.tasks) && phase.tasks.length > 0)).toBe(true);
    const weekStarts = plan.phases.map((phase) => phase.tasks[0].startWeek);
    expect(weekStarts[0]).toBeLessThan(weekStarts[1]);
    expect(weekStarts[1]).toBeLessThanOrEqual(weekStarts[2]);
  });

  it('applies template and updates core fields', () => {
    const plan = createDefaultProjectPlan();
    const next = applyTemplate(plan, 'REMEDIATION_STANDARD');

    expect(next.templateId).toBe('REMEDIATION_STANDARD');
    expect(next.projectType).toBe('REMEDIATION');
    expect(next.stageGates.some((gate) => gate.required)).toBe(true);
    expect(next.documentArchive.length).toBeGreaterThan(0);
  });

  it('evaluates permit gate to blocked when permit data is missing', () => {
    const plan = createDefaultProjectPlan();
    const gateId = plan.stageGates.find((gate) => gate.type === 'PERMIT_REQUIRED')!.id;

    const result = evaluateStageGate(plan, gateId, {
      permitType: '',
      permitSubmitted: false,
    });

    expect(result.gate.status).toBe('BLOCKED');
  });

  it('evaluates permit gate to passed with permit data and archive document', () => {
    const plan = withPermitDocument();
    const gateId = plan.stageGates.find((gate) => gate.type === 'PERMIT_REQUIRED')!.id;

    const result = evaluateStageGate(plan, gateId, {
      permitType: 'Anmalan 9 kap',
      permitSubmitted: true,
    });

    expect(result.gate.status).toBe('PASSED');
    expect(result.changed).toBe(true);
  });

  it('applies permit code profile and adjusts map layers plus gantt timing', () => {
    const plan = createDefaultProjectPlan();
    const originalPhase3Start = plan.phases[2].tasks[0].startWeek;

    const applied = applyPermitCodeSelection(plan, {
      code: '90.50',
      codeType: 'SNI',
      municipality: 'Haninge',
    });

    expect(applied.profile.regulatoryTrack).toBe('NOTIFICATION');
    expect(applied.plan.permitCodeProfile?.code).toBe('90.50');
    expect(applied.plan.mapLayerSelection.enabled).toContain('GROUNDWATER');
    expect(applied.plan.phases[2].tasks[0].startWeek).toBeGreaterThan(originalPhase3Start);
    expect(applied.plan.phases[1].tasks.some((task) => task.id === 'MPF-CODE-CHECK')).toBe(true);
  });

  it('keeps permit gate pending until required geofence layers are present', () => {
    const plan = withPermitDocument();
    const gateId = plan.stageGates.find((gate) => gate.type === 'PERMIT_REQUIRED')!.id;
    const applied = applyPermitCodeSelection(plan, {
      code: '90.50',
      codeType: 'SNI',
    });

    const pending = evaluateStageGate(applied.plan, gateId, {
      permitType: '90.50',
      codeType: 'SNI',
      permitSubmitted: true,
      mapLayerAvailable: ['CADASTRE'],
    });
    expect(pending.gate.status).toBe('PENDING');

    const passed = evaluateStageGate(applied.plan, gateId, {
      permitType: '90.50',
      codeType: 'SNI',
      permitSubmitted: true,
      mapLayerAvailable: ['CADASTRE', 'FLOOD_RISK', 'GROUNDWATER', 'NATURA2000'],
    });
    expect(passed.gate.status).toBe('PASSED');
  });

  it('evaluates risk gate for missing map context and then pass with docs', () => {
    const plan = createDefaultProjectPlan();
    plan.mapLayerSelection.enabled = [];
    const gateId = plan.stageGates.find((gate) => gate.type === 'RISK_REVIEW')!.id;

    const blocked = evaluateStageGate(plan, gateId, {});
    expect(blocked.gate.status).toBe('BLOCKED');

    plan.mapLayerSelection.enabled = ['CADASTRE'];
    plan.documentArchive.push({
      id: 'DOC-RISK',
      name: 'Risk register',
      module: 'PROJECT_MANAGER',
      category: 'RISK',
      status: 'VERIFIED',
      uploadedAt: new Date().toISOString(),
      storagePath: '/tmp/risk-register',
      tags: [],
    });

    const passed = evaluateStageGate(plan, gateId, { mapLayerAvailable: ['CADASTRE'] });
    expect(passed.gate.status).toBe('PASSED');
  });

  it('evaluates document control gate from blocked to passed when signatures exist', () => {
    const plan = createDefaultProjectPlan();
    const gateId = plan.stageGates.find((gate) => gate.type === 'DOCUMENT_CONTROL')!.id;

    let result = evaluateStageGate(plan, gateId, {});
    expect(result.gate.status).toBe('BLOCKED');

    plan.documentArchive.push({
      id: 'DOC-VERIFIED',
      name: 'Verified doc',
      module: 'COMPLIANCE_AUDIT',
      category: 'PERMIT',
      status: 'VERIFIED',
      uploadedAt: new Date().toISOString(),
      storagePath: '/tmp/verified',
      tags: [],
    });
    plan.auditTrail.push({
      id: 'AUDIT-1',
      timestamp: new Date().toISOString(),
      user: 'Reviewer',
      action: 'SIGN',
      details: 'Signed',
      immutable: true,
      signatureId: 'SIG-1',
    });

    result = evaluateStageGate(plan, gateId, {});
    expect(result.gate.status).toBe('PASSED');
  });

  it('blocks document control when booked transport has no verified journal', () => {
    const plan = createDefaultProjectPlan();
    const gateId = plan.stageGates.find((gate) => gate.type === 'DOCUMENT_CONTROL')!.id;
    const now = new Date().toISOString();

    plan.documentArchive.push({
      id: 'DOC-VERIFIED-2',
      name: 'Verified doc',
      module: 'COMPLIANCE_AUDIT',
      category: 'PERMIT',
      status: 'VERIFIED',
      uploadedAt: now,
      storagePath: '/tmp/verified-2',
      tags: [],
    });
    plan.auditTrail.push({
      id: 'AUDIT-2',
      timestamp: now,
      user: 'Reviewer',
      action: 'SIGN',
      details: 'Signed',
      immutable: true,
      signatureId: 'SIG-2',
    });
    plan.transportBookings.push({
      id: 'BOOKING-1',
      quoteId: 'QUOTE-1',
      provider: 'DEMO_FRAKTBORS',
      status: 'BOOKED',
      receiverId: 'R1',
      receiverName: 'Receiver 1',
      wasteCode: '17 05 04',
      tons: 10,
      distanceKm: 20,
      co2EstimateKg: 24,
      plannedPickupAt: now,
      plannedDeliveryAt: now,
      externalReference: 'FB-111111',
      createdAt: now,
      updatedAt: now,
    });

    const result = evaluateStageGate(plan, gateId, {});
    expect(result.gate.status).toBe('BLOCKED');
    expect(result.gate.reason).toContain('Driver journals');
  });

  it('requires verified LIMS for hazardous transport before document control passes', () => {
    const plan = createDefaultProjectPlan();
    const gateId = plan.stageGates.find((gate) => gate.type === 'DOCUMENT_CONTROL')!.id;
    const now = new Date().toISOString();

    plan.documentArchive.push({
      id: 'DOC-VERIFIED-3',
      name: 'Verified doc',
      module: 'COMPLIANCE_AUDIT',
      category: 'PERMIT',
      status: 'VERIFIED',
      uploadedAt: now,
      storagePath: '/tmp/verified-3',
      tags: [],
    });
    plan.auditTrail.push({
      id: 'AUDIT-3',
      timestamp: now,
      user: 'Reviewer',
      action: 'SIGN',
      details: 'Signed',
      immutable: true,
      signatureId: 'SIG-3',
    });
    plan.transportBookings.push({
      id: 'BOOKING-HAZ',
      quoteId: 'QUOTE-HAZ',
      provider: 'DEMO_FRAKTBORS',
      status: 'BOOKED',
      receiverId: 'R2',
      receiverName: 'Receiver 2',
      wasteCode: '17 05 03*',
      tons: 12,
      distanceKm: 18,
      co2EstimateKg: 25.92,
      plannedPickupAt: now,
      plannedDeliveryAt: now,
      externalReference: 'FB-222222',
      createdAt: now,
      updatedAt: now,
    });
    plan.driverJournals.push({
      id: 'JOURNAL-HAZ',
      bookingId: 'BOOKING-HAZ',
      driverName: 'Driver',
      vehicleId: 'ABC123',
      origin: 'Site A',
      destination: 'Site B',
      wasteCode: '17 05 03*',
      tons: 12,
      startedAt: now,
      endedAt: now,
      odometerStartKm: 1000,
      odometerEndKm: 1020,
      gpsTrackHash: 'hash',
      status: 'VERIFIED',
      signedByDriver: true,
      signedByReviewer: true,
      driverSignatureId: 'SIG-D',
      reviewerSignatureId: 'SIG-R',
      createdAt: now,
      updatedAt: now,
    });

    const blocked = evaluateStageGate(plan, gateId, {});
    expect(blocked.gate.status).toBe('BLOCKED');
    expect(blocked.gate.reason).toContain('LIMS');

    plan.limsReports.push({
      id: 'LIMS-HAZ',
      bookingId: 'BOOKING-HAZ',
      sampleId: 'S-1',
      labName: 'ALS',
      source: 'API',
      analyzedAt: now,
      rawReference: 'ALS-REF-1',
      metrics: [
        {
          key: 'Pb',
          value: 0.9,
          unit: 'mg/kg',
          maxAllowed: 1,
          exceeded: false,
        },
      ],
      passed: true,
      verifiedByHuman: true,
      reviewer: 'QA',
      reviewerSignatureId: 'SIG-LIMS',
      verifiedAt: now,
      createdAt: now,
    });

    const passed = evaluateStageGate(plan, gateId, {});
    expect(passed.gate.status).toBe('PASSED');
  });

  it('evaluates carbon gate based on carbon result availability', () => {
    const plan = createDefaultProjectPlan();
    const gateId = plan.stageGates.find((gate) => gate.type === 'CARBON_CHECK')!.id;

    const blocked = evaluateStageGate(plan, gateId, {});
    expect(blocked.gate.status).toBe('BLOCKED');

    const withCarbon = applyCarbonToPlan(plan, {
      tons: 10,
      transportMode: 'TRUCK',
      materialType: 'SOIL',
    });
    const passed = evaluateStageGate(withCarbon, gateId, {});
    expect(passed.gate.status).toBe('PASSED');
  });

  it('calculates carbon using routed, manual and fallback distances', () => {
    const routed = calculateCarbon({
      tons: 20,
      distanceKm: 12,
      transportMode: 'TRUCK',
      materialType: 'SOIL',
    });
    expect(routed.quality).toBe('ROUTED');

    const manual = calculateCarbon({
      tons: 20,
      manualDistanceKm: 30,
      transportMode: 'TRUCK',
      materialType: 'SOIL',
    });
    expect(manual.quality).toBe('MANUAL_DISTANCE');

    const fallback = calculateCarbon({
      tons: 20,
      transportMode: 'TRUCK',
      materialType: 'SOIL',
      emissionFactorKgCo2ePerTonKm: 0.5,
    });
    expect(fallback.quality).toBe('ESTIMATED');
    expect(fallback.distanceKmUsed).toBe(25);
    expect(fallback.emissionFactorKgCo2ePerTonKm).toBe(0.5);
  });

  it('marks not-required gate correctly', () => {
    const plan = createDefaultProjectPlan();
    const target = plan.stageGates.find((gate) => gate.type === 'CARBON_CHECK')!;
    target.required = false;
    target.status = 'PENDING';

    const result = evaluateStageGate(plan, target.id, {});
    expect(result.gate.status).toBe('NOT_REQUIRED');
  });
});
