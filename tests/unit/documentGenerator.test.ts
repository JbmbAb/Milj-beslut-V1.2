import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Mock docx ────────────────────────────────────────────────────────────────
// documentGenerator builds a full docx document tree – mock all constructors
// and Packer.toBuffer so no real OOXML is generated in unit tests.

vi.mock('docx', () => {
  const makeCtor = () => vi.fn(function (this: Record<string, unknown>, _: unknown) {});
  return {
    Document: makeCtor(),
    Packer: { toBuffer: vi.fn().mockResolvedValue(Buffer.from('MOCK-DOCX')) },
    Paragraph: makeCtor(),
    TextRun: makeCtor(),
    Table: makeCtor(),
    TableRow: makeCtor(),
    TableCell: makeCtor(),
    HeadingLevel: { TITLE: 'TITLE', HEADING_1: 1, HEADING_2: 2 },
    AlignmentType: { CENTER: 'center', LEFT: 'left' },
    BorderStyle: { SINGLE: 'single' },
    WidthType: { PERCENTAGE: 'pct' },
    ShadingType: { SOLID: 'solid' },
  };
});

// ─── Mock fs ─────────────────────────────────────────────────────────────────

const fsMock = vi.hoisted(() => ({
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

vi.mock('fs', () => fsMock);

// ─── Mock @prisma/client ──────────────────────────────────────────────────────
// documentGenerator calls `new PrismaClient()` at module level (not via shared
// prisma singleton), so we must mock @prisma/client directly.

const prismaInstanceMock = vi.hoisted(() => ({
  documentRecord: { create: vi.fn() },
}));

vi.mock('@prisma/client', () => ({
  PrismaClient: vi.fn(function (this: Record<string, unknown>) {
    return prismaInstanceMock;
  }),
  DocumentRecord: {},
}));

// ─── Re-import helpers ────────────────────────────────────────────────────────

import type { generateApplicationDraft as GenerateApplicationDraft } from '../../server/services/documentGenerator';

type DocGenService = {
  generateApplicationDraft: typeof GenerateApplicationDraft;
};

let svc: DocGenService;

async function loadService() {
  vi.resetModules();
  svc = (await import('../../server/services/documentGenerator')) as unknown as DocGenService;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeDocumentRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: 'doc-001',
    projectId: 'proj-1',
    organisationId: 'org-1',
    entryId: 'DRAFT-123',
    subject: 'Miljöbeslut.se - Anmalan om mellanlagring - UTKAST',
    originalName: 'Anmalan_Utkast_123.docx',
    diskName: 'Anmalan_Utkast_123.docx',
    absolutePath: '/some/path/Anmalan_Utkast_123.docx',
    fileSize: BigInt(1024),
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    status: 'TEXT_EXTRACTED',
    legalStatus: 'DRAFT_UNVERIFIED',
    manifestMeta: {},
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

const baseOptions = {
  projectId: 'proj-1',
  organisationId: 'org-1',
  userId: 'user-1',
  requirementData: {
    requirements: [
      {
        title: 'Egenkontroll',
        description: 'Verksamhetsutövaren ska utföra egenkontroll.',
        legalReference: 'Miljöbalken 26 kap. 19 §',
      },
    ],
  },
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('documentGenerator – generateApplicationDraft', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await loadService();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── Happy path ───────────────────────────────────────────────────────────────

  it('returns the DocumentRecord created by Prisma', async () => {
    const record = makeDocumentRecord();
    prismaInstanceMock.documentRecord.create.mockResolvedValue(record);
    const result = await svc.generateApplicationDraft(baseOptions);
    expect(result).toBe(record);
  });

  it('calls prisma.documentRecord.create with correct projectId and organisationId', async () => {
    prismaInstanceMock.documentRecord.create.mockResolvedValue(makeDocumentRecord());
    await svc.generateApplicationDraft(baseOptions);
    expect(prismaInstanceMock.documentRecord.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          projectId: 'proj-1',
          organisationId: 'org-1',
        }),
      })
    );
  });

  it('sets legalStatus to DRAFT_UNVERIFIED', async () => {
    prismaInstanceMock.documentRecord.create.mockResolvedValue(makeDocumentRecord());
    await svc.generateApplicationDraft(baseOptions);
    expect(prismaInstanceMock.documentRecord.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ legalStatus: 'DRAFT_UNVERIFIED' }),
      })
    );
  });

  it('sets mimeType to docx MIME type', async () => {
    prismaInstanceMock.documentRecord.create.mockResolvedValue(makeDocumentRecord());
    await svc.generateApplicationDraft(baseOptions);
    expect(prismaInstanceMock.documentRecord.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        }),
      })
    );
  });

  it('embeds UTKAST watermark in manifestMeta', async () => {
    prismaInstanceMock.documentRecord.create.mockResolvedValue(makeDocumentRecord());
    await svc.generateApplicationDraft(baseOptions);
    const callArg = prismaInstanceMock.documentRecord.create.mock.calls[0][0];
    expect(callArg.data.manifestMeta).toMatchObject({
      watermark: expect.stringMatching(/UTKAST/i),
      generatedByAI: true,
      requiresSignature: true,
    });
  });

  it('creates the output directory via fs.mkdirSync', async () => {
    prismaInstanceMock.documentRecord.create.mockResolvedValue(makeDocumentRecord());
    await svc.generateApplicationDraft(baseOptions);
    expect(fsMock.mkdirSync).toHaveBeenCalledWith(
      expect.stringMatching(/drafts/),
      expect.objectContaining({ recursive: true })
    );
  });

  it('writes the docx buffer to disk via fs.writeFileSync', async () => {
    prismaInstanceMock.documentRecord.create.mockResolvedValue(makeDocumentRecord());
    await svc.generateApplicationDraft(baseOptions);
    expect(fsMock.writeFileSync).toHaveBeenCalledWith(
      expect.stringMatching(/\.docx$/),
      expect.any(Buffer)
    );
  });

  it('includes requirementContext in manifestMeta', async () => {
    prismaInstanceMock.documentRecord.create.mockResolvedValue(makeDocumentRecord());
    await svc.generateApplicationDraft(baseOptions);
    const callArg = prismaInstanceMock.documentRecord.create.mock.calls[0][0];
    expect(callArg.data.manifestMeta.requirementContext).toEqual(baseOptions.requirementData);
  });

  // ── Empty requirements ───────────────────────────────────────────────────────

  it('works when requirementData.requirements is an empty array', async () => {
    prismaInstanceMock.documentRecord.create.mockResolvedValue(makeDocumentRecord());
    const options = { ...baseOptions, requirementData: { requirements: [] } };
    await expect(svc.generateApplicationDraft(options)).resolves.toBeDefined();
  });

  it('works when requirementData has no requirements key', async () => {
    prismaInstanceMock.documentRecord.create.mockResolvedValue(makeDocumentRecord());
    const options = { ...baseOptions, requirementData: {} };
    await expect(svc.generateApplicationDraft(options)).resolves.toBeDefined();
  });

  it('works when requirementData is null-like (non-array requirements)', async () => {
    prismaInstanceMock.documentRecord.create.mockResolvedValue(makeDocumentRecord());
    const options = { ...baseOptions, requirementData: { requirements: 'not-an-array' } };
    await expect(svc.generateApplicationDraft(options)).resolves.toBeDefined();
  });

  // ── Multiple requirements ─────────────────────────────────────────────────────

  it('processes multiple requirements without error', async () => {
    prismaInstanceMock.documentRecord.create.mockResolvedValue(makeDocumentRecord());
    const options = {
      ...baseOptions,
      requirementData: {
        requirements: [
          { title: 'Krav 1', description: 'Desc 1', legalReference: 'MB 26:1' },
          { title: 'Krav 2', description: 'Desc 2' },
          { description: 'Krav utan titel' },
        ],
      },
    };
    await expect(svc.generateApplicationDraft(options)).resolves.toBeDefined();
  });

  // ── Error handling ────────────────────────────────────────────────────────────

  it('propagates Prisma errors to caller', async () => {
    prismaInstanceMock.documentRecord.create.mockRejectedValue(new Error('DB connection failed'));
    await expect(svc.generateApplicationDraft(baseOptions)).rejects.toThrow('DB connection failed');
  });

  it('propagates fs.writeFileSync errors to caller', async () => {
    fsMock.writeFileSync.mockImplementation(() => { throw new Error('Disk full'); });
    await expect(svc.generateApplicationDraft(baseOptions)).rejects.toThrow('Disk full');
  });

  // ── Output file naming ────────────────────────────────────────────────────────

  it('generates an entryId starting with DRAFT-', async () => {
    prismaInstanceMock.documentRecord.create.mockResolvedValue(makeDocumentRecord());
    await svc.generateApplicationDraft(baseOptions);
    const callArg = prismaInstanceMock.documentRecord.create.mock.calls[0][0];
    expect(callArg.data.entryId).toMatch(/^DRAFT-\d+$/);
  });

  it('generates a diskName ending with .docx', async () => {
    prismaInstanceMock.documentRecord.create.mockResolvedValue(makeDocumentRecord());
    await svc.generateApplicationDraft(baseOptions);
    const callArg = prismaInstanceMock.documentRecord.create.mock.calls[0][0];
    expect(callArg.data.diskName).toMatch(/\.docx$/);
  });

  it('uses status TEXT_EXTRACTED for the created record', async () => {
    prismaInstanceMock.documentRecord.create.mockResolvedValue(makeDocumentRecord());
    await svc.generateApplicationDraft(baseOptions);
    expect(prismaInstanceMock.documentRecord.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'TEXT_EXTRACTED' }),
      })
    );
  });
});
