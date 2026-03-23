import { describe, expect, it } from 'vitest';
import { DecisionType } from '../../types';
import {
  applyPermitCodeSelection,
  applyCarbonToPlan,
  applyTemplate,
  buildPermitCodeProfile,
  calculateCarbon,
  countBlockedGates,
  countPassedGates,
  countReadyModules,
  createArchiveDocument,
  createDefaultCarbonSummary,
  createDefaultMapLayerSelection,
  createDefaultModuleIntegrations,
  createDefaultProjectPlan,
  createDefaultSamplingPreparation,
  createDefaultStageGates,
  createPermitArchiveDocument,
  evaluateStageGate,
  getTemplateById,
  getTemplatePacks,
  mergeArchiveDocument,
  normalizeProjectPlan,
  recommendMapLayers,
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

describe('getTemplatePacks / getTemplateById', () => {
  it('getTemplatePacks returns an array of template packs', () => {
    const packs = getTemplatePacks();
    expect(Array.isArray(packs)).toBe(true);
    expect(packs.length).toBeGreaterThan(0);
    expect(packs[0]).toHaveProperty('id');
    expect(packs[0]).toHaveProperty('projectType');
  });

  it('getTemplateById returns matching template', () => {
    const packs = getTemplatePacks();
    const first = packs[0];
    const found = getTemplateById(first.id);
    expect(found.id).toBe(first.id);
  });

  it('getTemplateById returns default template when id is undefined', () => {
    const defaultPack = getTemplateById(undefined);
    expect(defaultPack).toBeDefined();
    expect(defaultPack.id).toBeTruthy();
  });

  it('getTemplateById returns default for unknown id', () => {
    const defaultPack = getTemplateById('NON_EXISTENT_TEMPLATE_XYZ');
    expect(defaultPack).toBeDefined();
  });
});

describe('createDefaultModuleIntegrations', () => {
  it('returns array with PROJECT_MANAGER and PERMIT_PORTAL as READY', () => {
    const integrations = createDefaultModuleIntegrations();
    expect(Array.isArray(integrations)).toBe(true);
    expect(integrations.length).toBeGreaterThan(0);
    const manager = integrations.find((m) => m.module === 'PROJECT_MANAGER');
    const portal = integrations.find((m) => m.module === 'PERMIT_PORTAL');
    expect(manager?.readiness).toBe('READY');
    expect(portal?.readiness).toBe('READY');
  });

  it('returns non-core modules as NOT_READY', () => {
    const integrations = createDefaultModuleIntegrations();
    const logistics = integrations.find((m) => m.module === 'LOGISTICS_MARKET');
    expect(logistics?.readiness).toBe('NOT_READY');
  });
});

describe('createDefaultSamplingPreparation', () => {
  it('returns sampling preparation with expected defaults', () => {
    const prep = createDefaultSamplingPreparation();
    expect(prep.enabled).toBe(false);
    expect(prep.requiresPreparationNow).toBe(true);
    expect(typeof prep.protocolTemplate).toBe('string');
    expect(Array.isArray(prep.checklist)).toBe(true);
  });
});

describe('createDefaultMapLayerSelection', () => {
  it('returns map layer selection with base layers', () => {
    const layers = createDefaultMapLayerSelection();
    expect(Array.isArray(layers.base)).toBe(true);
    expect(Array.isArray(layers.enabled)).toBe(true);
    expect(layers.enabled.length).toBeGreaterThan(0);
  });

  it('accepts a custom templateId', () => {
    const packs = getTemplatePacks();
    const layers = createDefaultMapLayerSelection(packs[0].id);
    expect(layers).toBeDefined();
    expect(Array.isArray(layers.base)).toBe(true);
  });
});

describe('createDefaultStageGates', () => {
  it('returns all gate types', () => {
    const gates = createDefaultStageGates();
    expect(gates.some((g) => g.type === 'PERMIT_REQUIRED')).toBe(true);
    expect(gates.some((g) => g.type === 'CARBON_CHECK')).toBe(true);
    expect(gates.some((g) => g.type === 'DOCUMENT_CONTROL')).toBe(true);
    expect(gates.some((g) => g.type === 'RISK_REVIEW')).toBe(true);
  });
});

describe('createDefaultCarbonSummary', () => {
  it('returns empty carbon summary', () => {
    const summary = createDefaultCarbonSummary();
    expect(summary.lastInput).toBeNull();
    expect(summary.lastResult).toBeNull();
    expect(Array.isArray(summary.history)).toBe(true);
    expect(summary.history.length).toBe(0);
  });
});

describe('createArchiveDocument', () => {
  it('creates a document with required fields', () => {
    const doc = createArchiveDocument({
      name: 'Test Document',
      module: 'PERMIT_PORTAL',
      category: 'PERMIT',
    });
    expect(doc.id).toMatch(/^DOC-/);
    expect(doc.name).toBe('Test Document');
    expect(doc.module).toBe('PERMIT_PORTAL');
    expect(doc.category).toBe('PERMIT');
    expect(doc.status).toBe('DRAFT');
    expect(doc.storagePath).toContain('/archive/');
    expect(Array.isArray(doc.tags)).toBe(true);
  });

  it('uses provided storagePath and status', () => {
    const doc = createArchiveDocument({
      name: '  Trimmed Name  ',
      module: 'COMPLIANCE_AUDIT',
      category: 'OTHER',
      status: 'VERIFIED',
      storagePath: '/custom/path',
      tags: ['tag1', 'tag2'],
    });
    expect(doc.name).toBe('Trimmed Name');
    expect(doc.status).toBe('VERIFIED');
    expect(doc.storagePath).toBe('/custom/path');
    expect(doc.tags).toEqual(['tag1', 'tag2']);
  });
});

describe('mergeArchiveDocument', () => {
  it('adds a new document to archive', () => {
    const archive: ReturnType<typeof createArchiveDocument>[] = [];
    const doc = createArchiveDocument({ name: 'New Doc', module: 'PERMIT_PORTAL', category: 'PERMIT' });
    const merged = mergeArchiveDocument(archive, doc);
    expect(merged.length).toBe(1);
    expect(merged[0].name).toBe('New Doc');
  });

  it('does not add duplicate document (same name, module, category)', () => {
    const doc = createArchiveDocument({ name: 'Dup Doc', module: 'PERMIT_PORTAL', category: 'PERMIT' });
    const archive = [doc];
    const docDup = createArchiveDocument({ name: 'Dup Doc', module: 'PERMIT_PORTAL', category: 'PERMIT' });
    const merged = mergeArchiveDocument(archive, docDup);
    expect(merged.length).toBe(1);
  });

  it('is case-insensitive for name matching', () => {
    const doc = createArchiveDocument({ name: 'My Doc', module: 'PERMIT_PORTAL', category: 'PERMIT' });
    const archive = [doc];
    const docUpper = createArchiveDocument({ name: 'MY DOC', module: 'PERMIT_PORTAL', category: 'PERMIT' });
    const merged = mergeArchiveDocument(archive, docUpper);
    expect(merged.length).toBe(1);
  });
});

describe('createPermitArchiveDocument', () => {
  it('creates archive document for approved permit', () => {
    const permit = {
      id: 'permit-1',
      filename: 'permit.pdf',
      checksum: 'abc123',
      received_date: '2025-01-01',
      property_id: 'PROP-001',
      municipality: 'Stockholm',
      waste_codes: 'EWC-17 05 03*',
      decision_type: DecisionType.BIFALL,
      full_text: 'Full permit text',
      processed_at: '2025-01-02',
    };
    const doc = createPermitArchiveDocument(permit);
    expect(doc.status).toBe('VERIFIED');
    expect(doc.category).toBe('PERMIT');
    expect(doc.name).toContain('Stockholm');
    expect(doc.name).toContain('PROP-001');
  });

  it('creates draft document for non-approved permit', () => {
    const permit = {
      id: 'permit-2',
      filename: 'permit2.pdf',
      checksum: 'def456',
      received_date: '2025-01-01',
      property_id: 'PROP-002',
      municipality: 'Göteborg',
      waste_codes: 'EWC-17 05 03*',
      decision_type: DecisionType.AVSLAG,
      full_text: 'Full permit text',
      processed_at: '2025-01-02',
    };
    const doc = createPermitArchiveDocument(permit);
    expect(doc.status).toBe('DRAFT');
  });
});

describe('recommendMapLayers', () => {
  it('returns map layer selection for REMEDIATION project type', () => {
    const layers = recommendMapLayers('REMEDIATION');
    expect(Array.isArray(layers.base)).toBe(true);
    expect(layers.base.length).toBeGreaterThan(0);
  });

  it('returns map layer selection for unknown project type (falls back to default)', () => {
    const layers = recommendMapLayers('LOGISTICS' as any);
    expect(layers).toBeDefined();
    expect(Array.isArray(layers.base)).toBe(true);
  });
});

describe('buildPermitCodeProfile', () => {
  it('builds profile for a known EWC code', () => {
    const profile = buildPermitCodeProfile({ code: '17 05 03*', codeType: 'EWC' });
    expect(profile.code).toBe('17 05 03*');
    expect(profile.codeType).toBe('EWC');
    expect(profile.humanReviewRequired).toBe(true);
    expect(profile.requiresGeofencing).toBeDefined();
  });

  it('builds fallback profile for unknown code', () => {
    const profile = buildPermitCodeProfile({ code: 'UNKNOWN-CODE-XYZ', codeType: 'EWC', municipality: 'Uppsala' });
    expect(profile.code).toBe('UNKNOWN-CODE-XYZ');
    expect(profile.riskTier).toBe('MEDIUM');
    expect(profile.requiresGeofencing).toBe(true);
    expect(profile.municipality).toBe('Uppsala');
    expect(profile.legalReference).toContain('Manual');
  });

  it('builds fallback profile for unknown MPF code', () => {
    const profile = buildPermitCodeProfile({ code: 'UNKNOWN-MPF', codeType: 'SNI' });
    expect(profile.requiredMapLayers).toContain('CADASTRE');
    expect(profile.requiredMapLayers).toContain('FLOOD_RISK');
  });
});

describe('countReadyModules / countBlockedGates / countPassedGates', () => {
  it('countReadyModules counts READY integrations', () => {
    const plan = createDefaultProjectPlan();
    const readyCount = countReadyModules(plan);
    expect(readyCount).toBeGreaterThanOrEqual(0);
    const expectedCount = plan.moduleIntegrations.filter((m) => m.readiness === 'READY').length;
    expect(readyCount).toBe(expectedCount);
  });

  it('countBlockedGates counts required BLOCKED gates', () => {
    const plan = createDefaultProjectPlan();
    const count = countBlockedGates(plan);
    const expected = plan.stageGates.filter((g) => g.required && g.status === 'BLOCKED').length;
    expect(count).toBe(expected);
  });

  it('countPassedGates counts required PASSED gates', () => {
    const plan = createDefaultProjectPlan();
    const count = countPassedGates(plan);
    expect(count).toBe(0);

    // Force a gate to PASSED
    const requiredGate = plan.stageGates.find((g) => g.required);
    if (requiredGate) {
      requiredGate.status = 'PASSED';
      expect(countPassedGates(plan)).toBe(1);
    }
  });
});

describe('evaluateStageGate — DOCUMENT_CONTROL failedHazardousLims branch', () => {
  it('blocks DOCUMENT_CONTROL when LIMS report has passed=false for hazardous booking', () => {
    const plan = createDefaultProjectPlan();
    const gateId = plan.stageGates.find((gate) => gate.type === 'DOCUMENT_CONTROL')!.id;
    const now = new Date().toISOString();

    // Set up required documents
    plan.documentArchive = [
      {
        id: 'DOC-VER',
        name: 'Verified Doc',
        module: 'PERMIT_PORTAL',
        category: 'PERMIT',
        status: 'VERIFIED',
        uploadedAt: now,
        storagePath: '/tmp/doc',
        tags: [],
      },
    ];
    // Set up a signature event via auditTrail
    plan.auditTrail = [
      {
        id: 'AUDIT-1',
        timestamp: now,
        user: 'test-user',
        action: 'SIGN',
        details: 'BankID signature',
        immutable: true,
        signatureId: 'SIG-BANKID-1',
      },
    ];

    // Add a hazardous booking with LIMS report that FAILED
    plan.transportBookings = [
      {
        id: 'BOOKING-HAZ',
        quoteId: 'Q-1',
        provider: 'DEMO_FRAKTBORS',
        status: 'DELIVERED',
        receiverId: 'R-1',
        receiverName: 'Receiver',
        wasteCode: '17 05 03*',
        tons: 10,
        distanceKm: 50,
        co2EstimateKg: 100,
        plannedPickupAt: now,
        plannedDeliveryAt: now,
        externalReference: 'REF-1',
        createdAt: now,
        updatedAt: now,
      },
    ];
    plan.driverJournals = [
      {
        id: 'DJ-1',
        bookingId: 'BOOKING-HAZ',
        driverName: 'Driver',
        vehicleId: 'V-1',
        origin: 'Stockholm',
        destination: 'Göteborg',
        wasteCode: '17 05 03*',
        tons: 10,
        startedAt: now,
        endedAt: now,
        odometerStartKm: 0,
        odometerEndKm: 10,
        gpsTrackHash: 'h',
        status: 'VERIFIED',
        signedByDriver: true,
        signedByReviewer: true,
        driverSignatureId: 'SIG-D',
        reviewerSignatureId: 'SIG-R',
        createdAt: now,
        updatedAt: now,
      },
    ];
    plan.limsReports = [
      {
        id: 'LIMS-HAZ',
        bookingId: 'BOOKING-HAZ',
        sampleId: 'S-1',
        labName: 'ALS',
        source: 'API',
        analyzedAt: now,
        rawReference: 'REF-1',
        metrics: [],
        passed: false, // ← FAILED
        verifiedByHuman: true,
        reviewer: 'QA',
        reviewerSignatureId: 'SIG-L',
        verifiedAt: now,
        createdAt: now,
      },
    ];

    const result = evaluateStageGate(plan, gateId, {});
    expect(result.gate.status).toBe('BLOCKED');
    expect(result.gate.reason).toContain('LIMS');
  });
});

describe('evaluateStageGate — RISK_REVIEW additional branches', () => {
  it('returns PENDING for RISK_REVIEW when some map layers are unavailable', () => {
    const plan = createDefaultProjectPlan();
    plan.mapLayerSelection.enabled = ['SGU_BEDROCK' as never];
    plan.mapLayerSelection.unavailable = ['LIDAR' as never];
    plan.documentArchive = [
      {
        id: 'RISK-DOC',
        name: 'Riskrapport',
        module: 'PROJECT_MANAGER',
        category: 'RISK',
        status: 'VERIFIED',
        uploadedAt: new Date().toISOString(),
        storagePath: '/tmp/risk',
        tags: [],
      },
    ];

    const gateId = plan.stageGates.find((g) => g.type === 'RISK_REVIEW')!.id;
    const result = evaluateStageGate(plan, gateId, {});

    expect(result.gate.status).toBe('PENDING');
    expect(result.gate.reason).toContain('unavailable');
  });

  it('returns BLOCKED for RISK_REVIEW when risk document is missing but layers present', () => {
    const plan = createDefaultProjectPlan();
    plan.mapLayerSelection.enabled = ['SGU_BEDROCK' as never];
    plan.mapLayerSelection.unavailable = [];
    plan.documentArchive = [];

    const gateId = plan.stageGates.find((g) => g.type === 'RISK_REVIEW')!.id;
    const result = evaluateStageGate(plan, gateId, {});

    expect(result.gate.status).toBe('BLOCKED');
    expect(result.gate.reason).toContain('Risk document');
  });
});

describe('evaluateStageGate — PERMIT_REQUIRED submitted branch', () => {
  it('returns BLOCKED when permit type is provided but not submitted', () => {
    const plan = createDefaultProjectPlan();
    const gateId = plan.stageGates.find((g) => g.type === 'PERMIT_REQUIRED')!.id;

    const result = evaluateStageGate(plan, gateId, {
      permitType: '29.40',
      permitSubmitted: false,
    });

    expect(result.gate.status).toBe('BLOCKED');
    expect(result.gate.reason).toContain('submitted');
  });

  it('returns BLOCKED when permit submitted but no permit documents in archive', () => {
    const plan = createDefaultProjectPlan();
    plan.documentArchive = [];
    const gateId = plan.stageGates.find((g) => g.type === 'PERMIT_REQUIRED')!.id;

    const result = evaluateStageGate(plan, gateId, {
      permitType: '29.40',
      permitSubmitted: true,
    });

    expect(result.gate.status).toBe('BLOCKED');
    expect(result.gate.reason).toContain('No permit documents');
  });
});

describe('normalizeProjectPlan — edge cases', () => {
  it('handles undefined input by returning default plan', () => {
    const plan = normalizeProjectPlan(undefined);
    expect(plan.name).toBe('Nytt Projekt');
    expect(plan.stageGates.length).toBeGreaterThan(0);
  });

  it('preserves custom name from partial plan', () => {
    const plan = normalizeProjectPlan({ name: 'Mitt Projekt' });
    expect(plan.name).toBe('Mitt Projekt');
  });

  it('creates default transport bookings when missing', () => {
    const plan = normalizeProjectPlan({ transportBookings: undefined });
    expect(Array.isArray(plan.transportBookings)).toBe(true);
  });
});
