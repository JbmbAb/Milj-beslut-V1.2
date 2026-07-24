import { describe, expect, it } from 'vitest';
import {
  mergeGateDecisions,
  evaluateOperationCodes,
  buildMassExport,
} from '../../server/modules/c-notification-mass/massOrchestrator';
import type { CNotificationMassCaseRecord } from '../../server/repositories/cNotificationMassRepository';

// ─── mergeGateDecisions ───────────────────────────────────────────────────────

describe('mergeGateDecisions', () => {
  it('returns EXEMPT when all decisions are EXEMPT', () => {
    expect(mergeGateDecisions(['EXEMPT', 'EXEMPT'])).toBe('EXEMPT');
  });

  it('returns EXEMPT for empty array', () => {
    expect(mergeGateDecisions([])).toBe('EXEMPT');
  });

  it('PERMIT_REQUIRED beats NOTIFICATION_REQUIRED', () => {
    expect(mergeGateDecisions(['NOTIFICATION_REQUIRED', 'PERMIT_REQUIRED'])).toBe('PERMIT_REQUIRED');
  });

  it('PERMIT_REQUIRED beats UNKNOWN_CODE', () => {
    expect(mergeGateDecisions(['UNKNOWN_CODE', 'PERMIT_REQUIRED', 'EXEMPT'])).toBe('PERMIT_REQUIRED');
  });

  it('NOTIFICATION_REQUIRED beats UNKNOWN_CODE', () => {
    expect(mergeGateDecisions(['UNKNOWN_CODE', 'NOTIFICATION_REQUIRED', 'EXEMPT'])).toBe(
      'NOTIFICATION_REQUIRED',
    );
  });

  it('UNKNOWN_CODE beats EXEMPT', () => {
    expect(mergeGateDecisions(['EXEMPT', 'UNKNOWN_CODE'])).toBe('UNKNOWN_CODE');
  });

  it('single PERMIT_REQUIRED returns PERMIT_REQUIRED', () => {
    expect(mergeGateDecisions(['PERMIT_REQUIRED'])).toBe('PERMIT_REQUIRED');
  });

  it('single NOTIFICATION_REQUIRED returns NOTIFICATION_REQUIRED', () => {
    expect(mergeGateDecisions(['NOTIFICATION_REQUIRED'])).toBe('NOTIFICATION_REQUIRED');
  });

  it('single UNKNOWN_CODE returns UNKNOWN_CODE', () => {
    expect(mergeGateDecisions(['UNKNOWN_CODE'])).toBe('UNKNOWN_CODE');
  });

  it('full priority ordering: PERMIT > NOTIFICATION > UNKNOWN > EXEMPT', () => {
    const all = ['EXEMPT', 'UNKNOWN_CODE', 'NOTIFICATION_REQUIRED', 'PERMIT_REQUIRED'] as const;
    expect(mergeGateDecisions([...all])).toBe('PERMIT_REQUIRED');
    expect(mergeGateDecisions(['EXEMPT', 'UNKNOWN_CODE', 'NOTIFICATION_REQUIRED'])).toBe(
      'NOTIFICATION_REQUIRED',
    );
    expect(mergeGateDecisions(['EXEMPT', 'UNKNOWN_CODE'])).toBe('UNKNOWN_CODE');
  });
});

// ─── evaluateOperationCodes ───────────────────────────────────────────────────

describe('evaluateOperationCodes', () => {
  it('returns PERMIT_REQUIRED for hazardous EWC above threshold (class A, >10 ton/år)', () => {
    const result = evaluateOperationCodes({
      propertyDesignation: 'STOCKHOLM 1:1',
      operationType: 'DEPONI',
      quantityPerYear: 15,
      ewcCode: '17 05 03*',
    });
    expect(result.gateDecision).toBe('PERMIT_REQUIRED');
    expect(result.ewcCode).toBe('17 05 03*');
    expect(result.operationType).toBe('DEPONI');
    expect(result.propertyDesignation).toBe('STOCKHOLM 1:1');
    expect(result.mpfDecision?.primaryCodeType).toBe('EWC');
  });

  it('returns EXEMPT for hazardous EWC below threshold (class A, <10 ton/år)', () => {
    const result = evaluateOperationCodes({
      propertyDesignation: 'STOCKHOLM 1:1',
      operationType: 'MELLANLAGRING',
      quantityPerYear: 5,
      ewcCode: '17 05 03*',
    });
    expect(result.gateDecision).toBe('EXEMPT');
  });

  it('quantity exactly at threshold: class A 17 05 03* at 10 ton/år → PERMIT_REQUIRED', () => {
    const result = evaluateOperationCodes({
      propertyDesignation: 'TEST 1:1',
      operationType: 'DEPONI',
      quantityPerYear: 10,
      ewcCode: '17 05 03*',
    });
    expect(result.gateDecision).toBe('PERMIT_REQUIRED');
  });

  it('quantity one unit below threshold: 9 ton/år < 10 ton/år → EXEMPT', () => {
    const result = evaluateOperationCodes({
      propertyDesignation: 'TEST 1:1',
      operationType: 'DEPONI',
      quantityPerYear: 9,
      ewcCode: '17 05 03*',
    });
    expect(result.gateDecision).toBe('EXEMPT');
  });

  it('class B EWC above threshold returns PERMIT_REQUIRED (17 05 04, >50000)', () => {
    const result = evaluateOperationCodes({
      propertyDesignation: 'TEST 1:1',
      operationType: 'DEPONI',
      quantityPerYear: 60000,
      ewcCode: '17 05 04',
    });
    expect(result.gateDecision).toBe('PERMIT_REQUIRED');
  });

  it('class C EWC above threshold returns NOTIFICATION_REQUIRED (17 05 08, >10000)', () => {
    const result = evaluateOperationCodes({
      propertyDesignation: 'TEST 1:1',
      operationType: 'MELLANLAGRING',
      quantityPerYear: 15000,
      ewcCode: '17 05 08',
    });
    expect(result.gateDecision).toBe('NOTIFICATION_REQUIRED');
  });

  it('unknown EWC code returns UNKNOWN_CODE', () => {
    const result = evaluateOperationCodes({
      propertyDesignation: 'TEST 1:1',
      operationType: 'DEPONI',
      quantityPerYear: 100,
      ewcCode: '99 99 99',
    });
    expect(result.gateDecision).toBe('UNKNOWN_CODE');
  });

  it('SNI code provided: EWC remains gate driver in phase 1', () => {
    // EWC 17 05 04 at 100 ton → EXEMPT (below 50000 threshold)
    // SNI 38.21 at 100 ton → PERMIT_REQUIRED, but only advisory in phase 1
    const result = evaluateOperationCodes({
      propertyDesignation: 'TEST 1:1',
      operationType: 'DEPONI',
      quantityPerYear: 100,
      ewcCode: '17 05 04',
      sniCode: '38.21',
    });
    expect(result.gateDecision).toBe('EXEMPT');
    expect(result.notes).toContain('EWC-koden styr gate-beslutet');
  });

  it('without SNI code: only EWC evaluated', () => {
    const result = evaluateOperationCodes({
      propertyDesignation: 'TEST 1:1',
      operationType: 'MELLANLAGRING',
      quantityPerYear: 100,
      ewcCode: '17 05 04',
    });
    expect(result.gateDecision).toBe('EXEMPT');
  });

  it('preserves all input fields in returned record', () => {
    const result = evaluateOperationCodes({
      propertyDesignation: 'GÄVLE BRYNÄS 1:1',
      operationType: 'MELLANLAGRING',
      quantityPerYear: 500,
      ewcCode: '17 05 08',
      sniCode: '38.11',
    });
    expect(result.propertyDesignation).toBe('GÄVLE BRYNÄS 1:1');
    expect(result.operationType).toBe('MELLANLAGRING');
    expect(result.quantityPerYear).toBe(500);
    expect(result.ewcCode).toBe('17 05 08');
    expect(result.sniCode).toBe('38.11');
    expect(result.notes).toBeTruthy();
    expect(result.mpfDecision?.ewcEvaluation.code).toBe('17 05 08');
  });

  it('returns required map layers in mpfDecision summary', () => {
    const result = evaluateOperationCodes({
      propertyDesignation: 'TEST 1:1',
      operationType: 'MELLANLAGRING',
      quantityPerYear: 100,
      ewcCode: '17 05 04',
    });

    expect(result.mpfDecision?.requiredMapLayers).toContain('CADASTRE');
    expect(result.mpfDecision?.requiredMapLayers).toContain('SOIL');
    expect(result.mpfDecision?.geofenceLayers.length).toBeGreaterThan(0);
    expect(result.mpfDecision?.registryVersion).toBeTruthy();
  });

  it('applies sensitive area when explicitly requested', () => {
    const baseline = evaluateOperationCodes({
      propertyDesignation: 'TEST 1:1',
      operationType: 'DEPONI',
      quantityPerYear: 100,
      ewcCode: '17 05 04',
    });
    const sensitive = evaluateOperationCodes({
      propertyDesignation: 'TEST 1:1',
      operationType: 'DEPONI',
      quantityPerYear: 15000,
      ewcCode: '17 05 04',
      isSensitiveArea: true,
    });

    expect(baseline.gateDecision).toBe('EXEMPT');
    expect(sensitive.gateDecision).toBe('PERMIT_REQUIRED');
    expect(sensitive.mpfDecision?.isSensitiveArea).toBe(true);
  });
});

// ─── buildMassExport ──────────────────────────────────────────────────────────

function makeRecord(overrides: Partial<CNotificationMassCaseRecord> = {}): CNotificationMassCaseRecord {
  return {
    id: 'case-1',
    referenceNumber: 'C-ANM-MASS-001',
    organisationId: 'org-1',
    createdByUserId: 'user-1',
    projectId: 'proj-1',
    propertyDesignation: 'STOCKHOLM 1:1',
    status: 'READY',
    operations: [
      {
        operationType: 'MELLANLAGRING',
        propertyDesignation: 'STOCKHOLM 1:1',
        ewcCode: '17 05 04',
        quantityPerYear: 1000,
        gateDecision: 'EXEMPT',
        transportChain: ['Lastbil', 'Tåg'],
        receiverName: 'AB Mottagning',
        capacityM3: 500,
      },
      {
        operationType: 'DEPONI',
        propertyDesignation: 'STOCKHOLM 1:1',
        ewcCode: '17 05 03*',
        quantityPerYear: 15,
        gateDecision: 'PERMIT_REQUIRED',
        transportChain: [],
      },
    ],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('buildMassExport', () => {
  it('includes humanInTheLoop disclaimer', () => {
    const result = buildMassExport(makeRecord());
    expect(result.humanInTheLoop).toContain('Handläggare ska verifiera');
  });

  it('splits operations into mellanlagring and deponi arrays', () => {
    const result = buildMassExport(makeRecord());
    expect(result.decisions.mellanlagring).toHaveLength(1);
    expect(result.decisions.deponi).toHaveLength(1);
    expect(result.decisions.mellanlagring[0].ewcCode).toBe('17 05 04');
    expect(result.decisions.deponi[0].ewcCode).toBe('17 05 03*');
  });

  it('uses first operation EWC as primary classification', () => {
    const result = buildMassExport(makeRecord());
    expect(result.classification).toBe('17 05 04');
  });

  it('returns empty string as classification when no operations', () => {
    const result = buildMassExport(makeRecord({ operations: [] }));
    expect(result.classification).toBe('');
  });

  it('returns null gis when no gisSnapshot', () => {
    const result = buildMassExport(makeRecord({ gisSnapshot: undefined }));
    expect(result.gis).toBeNull();
  });

  it('includes referenceNumber and projectId', () => {
    const result = buildMassExport(makeRecord());
    expect(result.referenceNumber).toBe('C-ANM-MASS-001');
    expect(result.projectId).toBe('proj-1');
    expect(result.propertyDesignation).toBe('STOCKHOLM 1:1');
  });

  it('transportChain defaults to empty array when undefined', () => {
    const record = makeRecord();
    record.operations[1].transportChain = undefined;
    const result = buildMassExport(record);
    expect(result.decisions.deponi[0].transportChain).toEqual([]);
  });

  it('gateDecision preserved in operation output', () => {
    const result = buildMassExport(makeRecord());
    expect(result.decisions.mellanlagring[0].gateDecision).toBe('EXEMPT');
    expect(result.decisions.deponi[0].gateDecision).toBe('PERMIT_REQUIRED');
  });

  it('exportedAt is a valid ISO timestamp', () => {
    const result = buildMassExport(makeRecord());
    expect(() => new Date(result.exportedAt).toISOString()).not.toThrow();
  });
});
