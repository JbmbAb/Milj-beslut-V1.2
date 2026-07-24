import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  let finishHandler: (() => void) | undefined;
  let ended = false;
  const textCalls: string[] = [];
  const docInstance = {
    x: 10,
    y: 20,
    page: {
      height: 842,
      width: 595,
      margins: { left: 50, right: 50, top: 50, bottom: 50 },
    },
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
    addPage: vi.fn().mockReturnThis(),
    font: vi.fn().mockReturnThis(),
    registerFont: vi.fn().mockReturnThis(),
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
    setFinishHandler(handler: () => void) {
      finishHandler = handler;
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

vi.mock('../../src/infrastructure/geo/static-map-generator', () => {
  return {
    StaticMapGenerator: class {
      drawMapToPdf() {
        return Promise.resolve(['Natura 2000: Mockområde']);
      }
    },
  };
});

const baseApplication = {
  id: 'app-1',
  referenceNumber: 'AVLOPP-2026-001',
  propertyDesignation: 'GÄVLE BRYNÄS 1:1',
  status: 'DRAFT',
  applicantName: 'Ada Testsson',
  applicantEmail: 'ada@example.com',
  latitude: 60.67,
  longitude: 17.14,
  pe: 5,
  systemType: 'INFILTRATION',
  domainSnapshot: {
    protectionProfile: {
      protectionLevel: 'NORMAL',
      reason: 'Normal skyddsnivå',
      nearestWell: { distance: 45 },
      nearestWaterCourse: { distance: 120 },
      distanceToPropertyLine: 8,
    },
    generatedDocuments: {
      situationPlanSVG: '<svg/>',
      crossSectionSVG: '<svg/>',
    },
  },
};

describe('generateSewageDossierPdf', () => {
  beforeEach(() => {
    mocks.reset();
  });

  it('generates a PDF path and includes property designation', async () => {
    const { generateSewageDossierPdf } = await import('../../server/services/sewagePdfService');

    const result = await generateSewageDossierPdf(baseApplication as any, 'C:\\temp\\dossier.pdf');

    expect(result).toBe('C:\\temp\\dossier.pdf');
    expect(mocks.textCalls.join(' ')).toContain('GÄVLE BRYNÄS 1:1');
    expect(mocks.textCalls.join(' ')).toContain('AVLOPP-2026-001');
  });

  it('includes protection profile details when present', async () => {
    const { generateSewageDossierPdf } = await import('../../server/services/sewagePdfService');

    await generateSewageDossierPdf(baseApplication as any, 'C:\\temp\\dossier-2.pdf');

    expect(mocks.textCalls.join(' ')).toContain('Normal skyddsnivå');
    expect(mocks.textCalls.join(' ')).toContain('INFILTRATION');
  });

  it('writes legal traceability metadata into the PDF footer', async () => {
    const { generateSewageDossierPdf } = await import('../../server/services/sewagePdfService');

    await generateSewageDossierPdf(baseApplication as any, 'C:\\temp\\dossier-trace.pdf', {
      traceability: {
        operator: 'Ada Testsson',
        modelId: 'gemini-test',
        correlationId: 'corr-avlopp-1',
        gitCommit: 'cafebabe',
        dbMigrationVersion: '20260512055145_init',
        datasetVersions: { topo10: 'vatten' },
      },
    });

    const joined = mocks.textCalls.join(' ');
    expect(joined).toContain('Op: Ada Testsson');
    expect(joined).toContain('Model: gemini-test');
    expect(joined).toContain('Corr: corr-avlopp-1');
    expect(joined).toContain('Git: cafebabe');
  });
});
