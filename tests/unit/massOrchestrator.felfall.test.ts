/**
 * massOrchestrator — felfall och saknade grenar
 *
 * Täcker: 403-access, 404-not-found, varningar, update-vägen i upsert,
 * exportMassCase, recordMassFlowForCase, searchPropertyForMass.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  evaluateOperationCodes,
  exportMassCase,
  generateDocumentsForCase,
  generateLogisticsForCase,
  recordMassFlowForCase,
  searchPropertyForMass,
  submitMassCase,
  upsertMassOperations,
} from '../../server/modules/c-notification-mass/massOrchestrator';
import { __clearMassCaseStoreForTests } from '../../server/repositories/cNotificationMassRepository';

vi.mock('../../server/services/auditTrailService', () => ({
  auditTrail: { logAction: vi.fn().mockResolvedValue(undefined) },
  getAuditTrail: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../server/services/propertyUnitService', () => ({
  lookupPropertyByDesignationFromPostgis: vi.fn(),
}));

vi.mock('../../server/repositories/massFlowService', () => ({
  getMassFlowSnapshot: vi.fn().mockResolvedValue({ movements: [], totalM3: 0 }),
  recordMassMovement: vi.fn().mockResolvedValue(undefined),
}));

const org1User = {
  id: 'user-1',
  organisationId: 'org-1',
  bankidId: 'bankid-user-1',
  role: 'ADMIN' as const,
};
const org2User = {
  id: 'user-2',
  organisationId: 'org-2',
  bankidId: 'bankid-user-2',
  role: 'ADMIN' as const,
};

const BASE_INPUT = {
  projectId: 'proj-1',
  propertyDesignation: 'TEST 1:1',
  operations: [
    { operationType: 'MELLANLAGRING' as const, ewcCode: '17 05 08', quantityPerYear: 15000 },
    { operationType: 'DEPONI' as const, ewcCode: '17 05 03*', quantityPerYear: 15 },
  ],
};

async function createCase() {
  const result = await upsertMassOperations(undefined, org1User, BASE_INPUT);
  if (!result.ok) throw new Error('createCase failed');
  return result.caseId;
}

describe('massOrchestrator — felfall och saknade grenar', () => {
  beforeEach(() => {
    __clearMassCaseStoreForTests();
    vi.clearAllMocks();
  });

  // ── upsertMassOperations ────────────────────────────────────────────────

  describe('upsertMassOperations', () => {
    it('varnar om MELLANLAGRING saknas', async () => {
      const result = await upsertMassOperations(undefined, org1User, {
        ...BASE_INPUT,
        operations: [{ operationType: 'DEPONI' as const, ewcCode: '17 05 03*', quantityPerYear: 15 }],
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.warnings.some((w) => w.includes('MELLANLAGRING'))).toBe(true);
    });

    it('varnar om DEPONI saknas', async () => {
      const result = await upsertMassOperations(undefined, org1User, {
        ...BASE_INPUT,
        operations: [
          { operationType: 'MELLANLAGRING' as const, ewcCode: '17 05 08', quantityPerYear: 15000 },
        ],
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.warnings.some((w) => w.includes('DEPONI'))).toBe(true);
    });

    it('uppdaterar befintligt ärende när caseId anges (update-vägen)', async () => {
      const caseId = await createCase();
      const updated = await upsertMassOperations(caseId, org1User, {
        ...BASE_INPUT,
        operations: [
          { operationType: 'MELLANLAGRING' as const, ewcCode: '17 05 08', quantityPerYear: 20000 },
          { operationType: 'DEPONI' as const, ewcCode: '17 05 03*', quantityPerYear: 20 },
        ],
      });
      expect(updated.ok).toBe(true);
      if (!updated.ok) return;
      expect(updated.caseId).toBe(caseId);
      expect(updated.operations[0].quantityPerYear).toBe(20000);
    });

    it('returnerar 404 vid update på okänt caseId', async () => {
      const result = await upsertMassOperations('nonexistent', org1User, BASE_INPUT);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.status).toBe(404);
    });

    it('returnerar 403 vid update på annat orgs ärende', async () => {
      const caseId = await createCase();
      const result = await upsertMassOperations(caseId, org2User, BASE_INPUT);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.status).toBe(403);
    });
  });

  // ── generateDocumentsForCase ────────────────────────────────────────────

  describe('generateDocumentsForCase', () => {
    it('returnerar 404 för okänt caseId', async () => {
      const result = await generateDocumentsForCase('bad-id', org1User);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.status).toBe(404);
    });

    it('returnerar 403 för fel org', async () => {
      const caseId = await createCase();
      const result = await generateDocumentsForCase(caseId, org2User);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.status).toBe(403);
    });

    it('lägger till varning när gisSnapshot saknas', async () => {
      const caseId = await createCase();
      const result = await generateDocumentsForCase(caseId, org1User);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.warnings.some((w) => w.includes('GIS'))).toBe(true);
    });
  });

  // ── exportMassCase ──────────────────────────────────────────────────────

  describe('exportMassCase', () => {
    it('returnerar export med humanInTheLoop', async () => {
      const caseId = await createCase();
      await generateDocumentsForCase(caseId, org1User);
      const result = await exportMassCase(caseId, org1User);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const exported = result.export as { humanInTheLoop: string };
      expect(exported.humanInTheLoop).toContain('verifiera');
    });

    it('bygger export on-the-fly om exportPayload saknas', async () => {
      const caseId = await createCase();
      // Hoppar över generateDocumentsForCase → exportPayload = undefined
      const result = await exportMassCase(caseId, org1User);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const exported = result.export as { decisions: { mellanlagring: unknown[] } };
      expect(exported.decisions.mellanlagring).toHaveLength(1);
    });

    it('returnerar 404 för okänt caseId', async () => {
      const result = await exportMassCase('bad-id', org1User);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.status).toBe(404);
    });

    it('returnerar 403 för fel org', async () => {
      const caseId = await createCase();
      const result = await exportMassCase(caseId, org2User);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.status).toBe(403);
    });
  });

  // ── submitMassCase ──────────────────────────────────────────────────────

  describe('submitMassCase', () => {
    it('returnerar 404 för okänt caseId', async () => {
      const result = await submitMassCase('unknown', org1User);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.status).toBe(404);
    });

    it('returnerar 403 för fel org', async () => {
      const caseId = await createCase();
      const result = await submitMassCase(caseId, org2User);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.status).toBe(403);
    });
  });

  // ── generateLogisticsForCase ────────────────────────────────────────────

  describe('generateLogisticsForCase', () => {
    it('returnerar 404 för okänt caseId', async () => {
      const result = await generateLogisticsForCase('bad-id', org1User, {
        sourceAddress: 'A',
        destinationAddress: 'B',
        estimatedTons: 10,
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.status).toBe(404);
    });

    it('returnerar 403 för fel org', async () => {
      const caseId = await createCase();
      const result = await generateLogisticsForCase(caseId, org2User, {
        sourceAddress: 'A',
        destinationAddress: 'B',
        estimatedTons: 10,
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.status).toBe(403);
    });
  });

  // ── recordMassFlowForCase ───────────────────────────────────────────────

  describe('recordMassFlowForCase', () => {
    it('sparar massflöde och returnerar snapshot', async () => {
      const caseId = await createCase();
      const result = await recordMassFlowForCase(caseId, org1User, {
        wasteCode: '17 05 08',
        volumeM3: 200,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.snapshot).toBeDefined();
    });

    it('returnerar 404 för okänt caseId', async () => {
      const result = await recordMassFlowForCase('bad', org1User, {
        wasteCode: '17 05 08',
        volumeM3: 100,
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.status).toBe(404);
    });

    it('returnerar 403 för fel org', async () => {
      const caseId = await createCase();
      const result = await recordMassFlowForCase(caseId, org2User, {
        wasteCode: '17 05 08',
        volumeM3: 100,
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.status).toBe(403);
    });
  });

  // ── searchPropertyForMass ───────────────────────────────────────────────

  describe('searchPropertyForMass', () => {
    it('returnerar resultat från PostGIS när tillgängligt', async () => {
      const { lookupPropertyByDesignationFromPostgis } =
        await import('../../server/services/propertyUnitService');
      (lookupPropertyByDesignationFromPostgis as any).mockResolvedValueOnce({
        propertyDesignation: 'TEST 1:1',
        centroid: { lat: 59.33, lng: 18.07 },
      });
      const result = await searchPropertyForMass(org1User, { propertyDesignation: 'TEST 1:1' });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.source).toBe('postgis');
    });

    it('returnerar 400 om propertyDesignation saknas', async () => {
      const result = await searchPropertyForMass(org1User, {});
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.status).toBe(400);
    });

    it('varnar och returnerar placeholder om PostGIS kastar i icke-produktion', async () => {
      const { lookupPropertyByDesignationFromPostgis } =
        await import('../../server/services/propertyUnitService');
      (lookupPropertyByDesignationFromPostgis as any).mockRejectedValueOnce(new Error('DB offline'));
      const result = await searchPropertyForMass(org1User, { propertyDesignation: 'OKÄND 9:9' });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.warnings.some((w) => w.includes('PostGIS'))).toBe(true);
      expect((result.result as any)._devOnly).toBe(true);
    });

    it('returnerar null-resultat som placeholder när PostGIS ger null', async () => {
      const { lookupPropertyByDesignationFromPostgis } =
        await import('../../server/services/propertyUnitService');
      (lookupPropertyByDesignationFromPostgis as any).mockResolvedValueOnce(null);
      const result = await searchPropertyForMass(org1User, { propertyDesignation: 'SAKNAS 1:1' });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect((result.result as any)._devOnly).toBe(true);
    });
  });

  // ── evaluateOperationCodes SNI+EWC interaktion ──────────────────────────

  describe('evaluateOperationCodes — SNI+EWC interaktion', () => {
    it('EXEMPT EWC står kvar även när SNI signalerar PERMIT_REQUIRED', () => {
      const result = evaluateOperationCodes({
        propertyDesignation: 'TEST 1:1',
        operationType: 'MELLANLAGRING',
        quantityPerYear: 5, // EWC 17 05 03* klass A tröskel 10 → EXEMPT (5 < 10)
        ewcCode: '17 05 03*',
        sniCode: '38.21', // SNI 38.21 klass A tröskel 1 → PERMIT_REQUIRED (5 >= 1)
      });
      expect(result.gateDecision).toBe('EXEMPT');
      expect(result.notes).toContain('EWC-koden styr gate-beslutet');
    });

    it('PERMIT_REQUIRED EWC slår alla SNI-beslut', () => {
      const result = evaluateOperationCodes({
        propertyDesignation: 'TEST 1:1',
        operationType: 'DEPONI',
        quantityPerYear: 15, // EWC 17 05 03* klass A → PERMIT_REQUIRED
        ewcCode: '17 05 03*',
        sniCode: '38.11',
      });
      expect(result.gateDecision).toBe('PERMIT_REQUIRED');
    });
  });
});
