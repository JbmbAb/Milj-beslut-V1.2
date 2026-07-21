import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CNotificationMassCaseRecord } from '../../server/repositories/cNotificationMassRepository';
import type { MassGisSnapshot } from '../../src/types/mass';

const mocks = vi.hoisted(() => {
  let finishHandler: (() => void) | undefined;
  let ended = false;
  const textCalls: string[] = [];
  const docInstance = {
    x: 10,
    y: 20,
    page: { height: 842 },
    pipe: vi.fn(),
    fontSize: vi.fn().mockReturnThis(),
    fillColor: vi.fn().mockReturnThis(),
    text: vi.fn((value: string) => {
      textCalls.push(value);
      return docInstance;
    }),
    moveDown: vi.fn().mockReturnThis(),
    rect: vi.fn().mockReturnThis(),
    stroke: vi.fn().mockReturnThis(),
    fillAndStroke: vi.fn().mockReturnThis(),
    circle: vi.fn().mockReturnThis(),
    addPage: vi.fn().mockReturnThis(),
    bufferedPageRange: vi.fn(() => ({ count: 2 })),
    switchToPage: vi.fn().mockReturnThis(),
    end: vi.fn(() => {
      ended = true;
      finishHandler?.();
      return docInstance;
    }),
  };

  return {
    textCalls,
    docInstance,
    reset() {
      textCalls.length = 0;
      finishHandler = undefined;
      ended = false;
    },
    createWriteStream: vi.fn(() => ({
      on: vi.fn((event: string, callback: () => void) => {
        if (event === 'finish') {
          finishHandler = callback;
          if (ended) callback();
        }
      }),
    })),
    PDFDocument: vi.fn(function MockPdfDocument() {
      return docInstance;
    }),
  };
});

vi.mock('pdfkit', () => ({
  default: mocks.PDFDocument,
}));

vi.mock('fs', () => ({
  createWriteStream: mocks.createWriteStream,
}));

const gisSnapshot: MassGisSnapshot = {
  analyzedAt: new Date('2026-06-01T10:00:00Z').toISOString(),
  propertySource: 'postgis',
  analysis: {
    propertyDesignation: 'STOCKHOLM 1:1',
    timestamp: new Date('2026-06-01T10:00:00Z').toISOString(),
    centroid: { lat: 59.33, lng: 18.07 },
    siteConstraints: [{ code: 'NVR', label: 'Skyddad natur i närheten', severity: 'MEDIUM' }],
    overallRiskScore: 42,
    logisticsSuitability: 'REVIEW_REQUIRED',
    warnings: ['Verifiera transportväg manuellt.'],
    reasoning: ['Nära vattenskydd.'],
    markCover: { nmdCode: 21, description: 'Åkermark' },
  },
  siteProfile: {
    propertyDesignation: 'STOCKHOLM 1:1',
    centroid: { lat: 59.33, lng: 18.07 },
    source: 'mass-gis',
    recommendedZones: [
      { id: 'z1', label: 'Mellanlagring A', operationType: 'MELLANLAGRING', offsetM: 40 },
      { id: 'z2', label: 'Deponi B', operationType: 'DEPONI', offsetM: 80 },
    ],
  },
};

const baseRecord: CNotificationMassCaseRecord = {
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
      transportChain: [],
      receiverName: 'AB Mottagning',
      capacityM3: 500,
    },
  ],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

describe('generateMassLogisticsPdf', () => {
  beforeEach(() => {
    mocks.reset();
  });

  it('generates PDF with property designation and human-in-the-loop text', async () => {
    const { generateMassLogisticsPdf } = await import('../../server/services/massLogisticsPdfService');

    const result = await generateMassLogisticsPdf(baseRecord, 'C:\\temp\\mass-logistics.pdf');

    expect(result).toBe('C:\\temp\\mass-logistics.pdf');
    const joined = mocks.textCalls.join(' ');
    expect(joined).toContain('STOCKHOLM 1:1');
    expect(joined).toContain('C-ANM-MASS-001');
    expect(joined).toContain('Human in the Loop');
    expect(joined).toContain('Handläggare ska verifiera');
  });

  it('includes GIS situationsplan content when gisSnapshot exists', async () => {
    const { generateMassLogisticsPdf } = await import('../../server/services/massLogisticsPdfService');

    await generateMassLogisticsPdf(
      { ...baseRecord, gisSnapshot },
      'C:\\temp\\mass-logistics-gis.pdf',
    );

    const joined = mocks.textCalls.join(' ');
    expect(joined).toContain('GIS & Situationsplan');
    expect(joined).toContain('Skyddad natur i närheten');
    expect(joined).toContain('Verifiera transportväg manuellt.');
  });

  it('notes missing GIS snapshot when gisSnapshot is absent', async () => {
    const { generateMassLogisticsPdf } = await import('../../server/services/massLogisticsPdfService');

    await generateMassLogisticsPdf(baseRecord, 'C:\\temp\\mass-logistics-no-gis.pdf');

    expect(mocks.textCalls.join(' ')).toContain('GIS-underlag saknas på ärendet');
  });
});
