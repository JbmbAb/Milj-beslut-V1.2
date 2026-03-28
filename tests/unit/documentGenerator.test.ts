import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';

// 1. Mocka Prisma (hoistad)
const prismaMock = vi.hoisted(() => ({
  documentRecord: {
    create: vi.fn(),
  },
}));

vi.mock('../../server/db/prisma', () => ({
  prisma: prismaMock,
}));

// 2. Mocka fs
vi.mock('fs', () => ({
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

// 3. Mocka docx (Packer.toBuffer)
vi.mock('docx', () => {
  class Document {
    constructor(_options?: unknown) {}
  }
  class Paragraph {
    constructor(_options?: unknown) {}
  }
  class TextRun {
    constructor(_options?: unknown) {}
  }
  class Table {
    constructor(_options?: unknown) {}
  }
  class TableRow {
    constructor(_options?: unknown) {}
  }
  class TableCell {
    constructor(_options?: unknown) {}
  }

  return {
    Document,
    Packer: {
      toBuffer: vi.fn().mockResolvedValue(Buffer.from('dummy-content')),
    },
    Paragraph,
    TextRun,
    HeadingLevel: { TITLE: 'title', HEADING_1: 'h1', HEADING_2: 'h2' },
    AlignmentType: { CENTER: 'center' },
    BorderStyle: { SINGLE: 'single' },
    Table,
    TableRow,
    TableCell,
    WidthType: { PERCENTAGE: 'percentage' },
    ShadingType: { SOLID: 'solid' },
  };
});

// Import efter mocks
import { generateApplicationDraft } from '../../server/services/documentGenerator';

describe('documentGenerator unit tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const validOptions = {
    projectId: 'proj-123',
    organisationId: 'org-456',
    userId: 'user-789',
    requirementData: {
      requirements: [{ title: 'Markskydd', description: 'Täck', legalReference: 'MB 2 kap' }],
    },
  };

  it('should generate a docx buffer and save record to database', async () => {
    prismaMock.documentRecord.create.mockResolvedValue({
      id: 'doc-999',
    });

    const result = await generateApplicationDraft(validOptions);

    expect(fs.mkdirSync).toHaveBeenCalled();
    expect(fs.writeFileSync).toHaveBeenCalled();
    expect(prismaMock.documentRecord.create).toHaveBeenCalled();
    expect(result.id).toBe('doc-999');
  });

  it('should include correct manifestMeta when saving through Prisma', async () => {
    prismaMock.documentRecord.create.mockResolvedValue({ id: 'any' });

    await generateApplicationDraft(validOptions);

    const call = prismaMock.documentRecord.create.mock.calls[0][0];
    expect(call.data.legalStatus).toBe('DRAFT_UNVERIFIED');
    expect(call.data.manifestMeta.generatedByAI).toBe(true);
  });
});
