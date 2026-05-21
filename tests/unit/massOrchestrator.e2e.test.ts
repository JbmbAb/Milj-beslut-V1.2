/**
 * Fas 2 — Mass C-anmälan intern E2E (in-memory store)
 *
 * Verifierar att orchestratorns sekvens fungerar end-to-end:
 *   upsertMassOperations → generateLogisticsForCase → generateDocumentsForCase → submitMassCase
 *
 * Status-transitions som ska veriferas: DRAFT → VALIDATED → READY → SUBMITTED
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildMassExport,
  generateDocumentsForCase,
  generateLogisticsForCase,
  getMassCaseAuditTrail,
  submitMassCase,
  upsertMassOperations,
} from '../../server/modules/c-notification-mass/massOrchestrator';
import { getMassCaseById } from '../../server/repositories/cNotificationMassRepository';

// auditTrail skriver till Prisma — mockas för att hålla testet isolerat
vi.mock('../../server/services/auditTrailService', () => ({
  auditTrail: { logAction: vi.fn().mockResolvedValue(undefined) },
  getAuditTrail: vi.fn().mockResolvedValue([]),
}));

const authUser = {
  id: 'user-1',
  organisationId: 'org-1',
  role: 'ADMIN' as const,
};

const BASE_INPUT = {
  projectId: 'proj-mass-e2e',
  propertyDesignation: 'STOCKHOLM BRYNÄS 1:1',
  operations: [
    {
      operationType: 'MELLANLAGRING' as const,
      ewcCode: '17 05 08', // class C, tröskel 10000 ton/år
      quantityPerYear: 15000, // > tröskel → NOTIFICATION_REQUIRED
      sniCode: undefined,
      capacityM3: 5000,
      receiverName: 'AB Mottagning',
      transportChain: ['Lastbil'],
    },
    {
      operationType: 'DEPONI' as const,
      ewcCode: '17 05 04', // class B, tröskel 50000 ton/år
      quantityPerYear: 200, // < tröskel → EXEMPT
    },
  ],
};

describe('Mass C-anmälan — intern E2E (in-memory)', () => {
  let caseId: string;

  beforeEach(() => {
    caseId = '';
    vi.clearAllMocks();
  });

  it('Steg 1 — upsertMassOperations skapar ärende med korrekt gate-beslut', async () => {
    const result = await upsertMassOperations(undefined, authUser, BASE_INPUT);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.caseId).toBeTruthy();
    expect(result.referenceNumber).toBeTruthy();
    caseId = result.caseId;

    // MELLANLAGRING: 17 05 08 @ 15000 > 10000 → NOTIFICATION_REQUIRED
    expect(result.decisions.mellanlagring?.gateDecision).toBe('NOTIFICATION_REQUIRED');
    // DEPONI: 17 05 04 @ 200 < 50000 → EXEMPT
    expect(result.decisions.deponi?.gateDecision).toBe('EXEMPT');

    // Inga varningar för fullständig operation (båda typerna finns)
    const missingTypes = result.warnings.filter((w) => w.includes('Saknar delbeslut'));
    expect(missingTypes).toHaveLength(0);
  });

  it('Steg 2 — generateLogisticsForCase övergår till VALIDATED (med test-fallback)', async () => {
    const create = await upsertMassOperations(undefined, authUser, BASE_INPUT);
    expect(create.ok).toBe(true);
    if (!create.ok) return;
    caseId = create.caseId;

    // generateLogisticsPlan kastar (inget projekt i test-DB) → orchestratorn returnerar fallback
    const result = await generateLogisticsForCase(caseId, authUser, {
      sourceAddress: 'Byggvägen 1, Stockholm',
      destinationAddress: 'Deponigatan 5, Södertälje',
      estimatedTons: 500,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.id).toContain(caseId);

    // Status ska nu vara VALIDATED
    const record = await getMassCaseById(caseId);
    expect(record?.status).toBe('VALIDATED');
  });

  it('Steg 3 — generateDocumentsForCase sätter status READY och inkluderar humanInTheLoop', async () => {
    const create = await upsertMassOperations(undefined, authUser, BASE_INPUT);
    if (!create.ok) return;
    caseId = create.caseId;

    await generateLogisticsForCase(caseId, authUser, {
      sourceAddress: 'A',
      destinationAddress: 'B',
      estimatedTons: 100,
    });

    const result = await generateDocumentsForCase(caseId, authUser);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.documents.summary.humanInTheLoop).toContain('Handläggare ska verifiera');

    // Status ska vara READY
    const record = await getMassCaseById(caseId);
    expect(record?.status).toBe('READY');
    expect(record?.exportPayload).toBeDefined();
  });

  it('Steg 4 — submitMassCase ger status SUBMITTED och referensnummer', async () => {
    const create = await upsertMassOperations(undefined, authUser, BASE_INPUT);
    if (!create.ok) return;
    caseId = create.caseId;

    await generateLogisticsForCase(caseId, authUser, {
      sourceAddress: 'A',
      destinationAddress: 'B',
      estimatedTons: 100,
    });
    await generateDocumentsForCase(caseId, authUser);

    const result = await submitMassCase(caseId, authUser);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.referenceNumber).toMatch(/^C-ANM-MASS-\d+$/);
    expect(result.status).toBe('SUBMITTED');

    // Record ska ha status SUBMITTED och referensnummer
    const record = await getMassCaseById(caseId);
    expect(record?.status).toBe('SUBMITTED');
    expect(record?.municipalityReference).toBe(result.referenceNumber);
  });

  it('Steg 4 — submitMassCase blockeras om alla operationer är EXEMPT', async () => {
    // Skapa ärende med alla operationer under tröskel → EXEMPT
    const exemptInput = {
      ...BASE_INPUT,
      operations: [
        { operationType: 'MELLANLAGRING' as const, ewcCode: '17 05 04', quantityPerYear: 100 },
        { operationType: 'DEPONI' as const, ewcCode: '17 05 04', quantityPerYear: 100 },
      ],
    };
    const create = await upsertMassOperations(undefined, authUser, exemptInput);
    if (!create.ok) return;
    caseId = create.caseId;

    const result = await submitMassCase(caseId, authUser);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(422);
    expect(result.error).toBe('no_notification_required');
  });

  it('Fullständigt flöde — status-transition DRAFT → VALIDATED → READY → SUBMITTED', async () => {
    // Steg 1: Skapa ärende
    const create = await upsertMassOperations(undefined, authUser, BASE_INPUT);
    expect(create.ok).toBe(true);
    if (!create.ok) return;
    caseId = create.caseId;

    let record = await getMassCaseById(caseId);
    expect(record?.status).toBe('DRAFT');

    // Steg 2: Logistik → VALIDATED
    await generateLogisticsForCase(caseId, authUser, {
      sourceAddress: 'A',
      destinationAddress: 'B',
      estimatedTons: 100,
    });
    record = await getMassCaseById(caseId);
    expect(record?.status).toBe('VALIDATED');

    // Steg 3: Dokument → READY
    await generateDocumentsForCase(caseId, authUser);
    record = await getMassCaseById(caseId);
    expect(record?.status).toBe('READY');

    // Steg 4: Inlämning → SUBMITTED
    await submitMassCase(caseId, authUser);
    record = await getMassCaseById(caseId);
    expect(record?.status).toBe('SUBMITTED');
  });

  it('buildMassExport på inlämnat ärende innehåller korrekt data', async () => {
    const create = await upsertMassOperations(undefined, authUser, BASE_INPUT);
    if (!create.ok) return;
    caseId = create.caseId;

    await generateLogisticsForCase(caseId, authUser, {
      sourceAddress: 'A',
      destinationAddress: 'B',
      estimatedTons: 100,
    });
    await generateDocumentsForCase(caseId, authUser);

    const record = await getMassCaseById(caseId);
    expect(record).toBeDefined();

    const exportData = buildMassExport(record!);
    expect(exportData.decisions.mellanlagring).toHaveLength(1);
    expect(exportData.decisions.deponi).toHaveLength(1);
    expect(exportData.decisions.mellanlagring[0].gateDecision).toBe('NOTIFICATION_REQUIRED');
    expect(exportData.decisions.mellanlagring[0].receiverName).toBe('AB Mottagning');
    expect(exportData.propertyDesignation).toBe('STOCKHOLM BRYNÄS 1:1');
  });

  it('getMassCaseAuditTrail returnerar ok:true (auditTrail mockat)', async () => {
    const create = await upsertMassOperations(undefined, authUser, BASE_INPUT);
    if (!create.ok) return;
    caseId = create.caseId;

    await generateLogisticsForCase(caseId, authUser, {
      sourceAddress: 'A',
      destinationAddress: 'B',
      estimatedTons: 100,
    });
    await generateDocumentsForCase(caseId, authUser);
    await submitMassCase(caseId, authUser);

    const result = await getMassCaseAuditTrail(caseId, authUser);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.referenceNumber).toMatch(/^C-ANM-MASS-\d+$/);
  });

  it('getMassCaseById returnerar 404 för okänt ärende-id', async () => {
    const result = await getMassCaseAuditTrail('unknown-case-id', authUser);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(404);
  });
});
