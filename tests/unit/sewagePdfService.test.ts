import { beforeEach, describe, expect, it, vi } from 'vitest';

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
    addPage: vi.fn().mockReturnThis(),
    font: vi.fn().mockReturnThis(),
    bufferedPageRange: vi.fn(() => ({ count: 1 })),
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
      Object.values(docInstance).forEach((value) => {
        if (typeof value === 'function' && 'mockClear' in value) {
          (value as any).mockClear();
        }
      });
      docInstance.bufferedPageRange.mockReturnValue({ count: 1 });
    },
    setFinishHandler(handler: () => void) {
      finishHandler = handler;
    },
    createWriteStream: vi.fn(() => ({
      on: vi.fn((event: string, callback: () => void) => {
        if (event === 'finish') {
          finishHandler = callback;
          if (ended) {
            callback();
          }
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

describe('generateSewageDossierPdf', () => {
  beforeEach(() => {
    mocks.reset();
  });

  it('uses main activities in the summary and falls back for empty mitigation measures', async () => {
    const { generateSewageDossierPdf } = await import('../../server/services/sewagePdfService');

    const result = await generateSewageDossierPdf(
      {} as any,
      {
        id: 'permit-1',
        propertyDesignation: 'GÄVLE BRYNÄS 1:1',
        sniCode: '90.40',
        applicationSummary: {
          title: 'Tillståndsansökan',
          mainActivities: ['Infiltration', 'Provtagning'],
        },
        riskAnalysis: [
          {
            riskName: 'Hög grundvattennivå',
            severity: 'HIGH',
            mitigationMeasures: [],
          },
        ],
        complianceChecklist: [],
      } as any,
      'C:\\temp\\dossier.pdf',
    );

    expect(result).toBe('C:\\temp\\dossier.pdf');
    expect(mocks.textCalls).toContain('Infiltration, Provtagning');
    expect(mocks.textCalls).toContain('Skyddsåtgärd: Se teknisk beskrivning');
  });

  it('falls back to the title when no main activities exist', async () => {
    const { generateSewageDossierPdf } = await import('../../server/services/sewagePdfService');

    await generateSewageDossierPdf(
      {} as any,
      {
        id: 'permit-2',
        propertyDesignation: 'Stockholms kommun',
        sniCode: '90.30',
        applicationSummary: {
          title: 'Ansökan för mellanlagring',
          mainActivities: [],
        },
        riskAnalysis: [
          {
            riskName: 'Skyfall',
            severity: 'MEDIUM',
            mitigationMeasures: ['Fördröjningsmagasin'],
          },
        ],
        complianceChecklist: [{ requirement: 'Provtagning', relatedLaw: '' }],
      } as any,
      'C:\\temp\\dossier-2.pdf',
    );

    expect(mocks.textCalls).toContain('Ansökan för mellanlagring');
    expect(mocks.textCalls).toContain('Skyddsåtgärd: Fördröjningsmagasin');
    expect(mocks.textCalls).toContain('[ ] Provtagning (Allmänna råd)');
  });

  it('rejects when stream creation fails', async () => {
    mocks.createWriteStream.mockImplementationOnce(() => {
      throw new Error('disk full');
    });

    const { generateSewageDossierPdf } = await import('../../server/services/sewagePdfService');

    await expect(
      generateSewageDossierPdf(
        {} as any,
        {
          id: 'permit-3',
          propertyDesignation: 'GÄVLE BRYNÄS 1:1',
          sniCode: '90.40',
          applicationSummary: { title: 'T', mainActivities: [] },
          riskAnalysis: [],
          complianceChecklist: [],
        } as any,
        'C:\\temp\\dossier-3.pdf',
      ),
    ).rejects.toThrow('disk full');
  });
});
