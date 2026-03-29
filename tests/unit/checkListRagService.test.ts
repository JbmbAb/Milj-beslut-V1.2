import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { extractAndGenerateChecklistFromRag as ExtractChecklist } from '../../server/services/checkListRagService';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const prismaMock = vi.hoisted(() => ({
  documentRecord: { findUnique: vi.fn() },
  requirementCase: {
    findUnique: vi.fn(),
    create: vi.fn(),
  },
  requirementRecord: { create: vi.fn() },
  requirementCitation: { create: vi.fn() },
}));

vi.mock('../../server/db/prisma', () => ({
  prisma: prismaMock,
}));

const mocks = vi.hoisted(() => ({
  embedText: vi.fn(),
  queryTopSemanticChunks: vi.fn(),
  serverGenerateText: vi.fn(),
}));

vi.mock('../../server/services/searchService', () => ({
  embedText: mocks.embedText,
}));

vi.mock('../../server/repositories/searchRepository', () => ({
  queryTopSemanticChunks: mocks.queryTopSemanticChunks,
}));

vi.mock('../../services/geminiService', () => ({
  serverGenerateText: mocks.serverGenerateText,
}));

// ─── Re-import helpers ────────────────────────────────────────────────────────

type ChecklistService = {
  extractAndGenerateChecklistFromRag: typeof ExtractChecklist;
};

let svc: ChecklistService;

async function loadService() {
  vi.resetModules();
  svc = (await import('../../server/services/checkListRagService')) as unknown as ChecklistService;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function mockEmbedding(values: number[] = [0.1, 0.2, 0.3]) {
  mocks.embedText.mockResolvedValue({ values });
}

function mockSemanticHits(hits: Array<{ documentId: string; chunkText: string }>) {
  mocks.queryTopSemanticChunks.mockResolvedValue(hits);
}

function mockAiResponse(requirements: object[]) {
  mocks.serverGenerateText.mockResolvedValue(JSON.stringify(requirements));
}

function mockDocument(id: string) {
  prismaMock.documentRecord.findUnique.mockResolvedValue({
    id,
    municipality: 'Malmö',
    diskName: 'test.pdf',
    subject: 'Testärende',
  });
}

function mockRequirementCase(id: string) {
  prismaMock.requirementCase.findUnique.mockResolvedValue(null);
  prismaMock.requirementCase.create.mockResolvedValue({ id });
}

function mockRequirementRecord(id: string) {
  prismaMock.requirementRecord.create.mockResolvedValue({ id });
}

function mockRequirementCitation() {
  prismaMock.requirementCitation.create.mockResolvedValue({ id: 'cit-1' });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('checkListRagService – extractAndGenerateChecklistFromRag', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await loadService();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('throws when embedding fails (empty values)', async () => {
    mocks.embedText.mockResolvedValue({ values: [] });
    await expect(
      svc.extractAndGenerateChecklistFromRag('proj-1', 'org-1', 'lakvatten', '29.40'),
    ).rejects.toThrow(/embedding/i);
  });

  it('throws when embedText returns null', async () => {
    mocks.embedText.mockResolvedValue(null);
    await expect(
      svc.extractAndGenerateChecklistFromRag('proj-1', 'org-1', 'lakvatten', '29.40'),
    ).rejects.toThrow(/embedding/i);
  });

  it('returns zero counts when no semantic hits are found', async () => {
    mockEmbedding();
    mockSemanticHits([]);
    const result = await svc.extractAndGenerateChecklistFromRag('proj-1', 'org-1', 'lakvatten', '29.40');
    expect(result.requirementsCreated).toBe(0);
    expect(result.casesCreated).toBe(0);
    expect(result.citationsCreated).toBe(0);
    expect(result.message).toMatch(/no relevant/i);
  });

  it('returns zero counts when AI returns empty array', async () => {
    mockEmbedding();
    mockSemanticHits([{ documentId: 'doc-1', chunkText: 'Some text' }]);
    mockAiResponse([]);
    const result = await svc.extractAndGenerateChecklistFromRag('proj-1', 'org-1', 'lakvatten', '29.40');
    expect(result.requirementsCreated).toBe(0);
    expect(result.message).toMatch(/no requirements/i);
  });

  it('throws when AI returns non-JSON text', async () => {
    mockEmbedding();
    mockSemanticHits([{ documentId: 'doc-1', chunkText: 'Some text' }]);
    mocks.serverGenerateText.mockResolvedValue('not valid json at all');
    await expect(
      svc.extractAndGenerateChecklistFromRag('proj-1', 'org-1', 'lakvatten', '29.40'),
    ).rejects.toThrow(/JSON/i);
  });

  it('skips requirements where documentId is missing', async () => {
    mockEmbedding();
    mockSemanticHits([{ documentId: 'doc-1', chunkText: 'Some text' }]);
    mockAiResponse([
      { category: 'Buller', interpretedRequirement: 'No noise', requirementTextQuote: 'Quiet' },
    ]); // no documentId
    const result = await svc.extractAndGenerateChecklistFromRag('proj-1', 'org-1', 'lakvatten', '29.40');
    expect(result.requirementsCreated).toBe(0);
  });

  it('skips requirements where document is not found in DB', async () => {
    mockEmbedding();
    mockSemanticHits([{ documentId: 'doc-1', chunkText: 'Some text' }]);
    mockAiResponse([
      {
        documentId: 'doc-999',
        category: 'Buller',
        interpretedRequirement: 'No noise',
        requirementTextQuote: 'Quiet',
        level: 'mandatory',
      },
    ]);
    prismaMock.documentRecord.findUnique.mockResolvedValue(null);
    const result = await svc.extractAndGenerateChecklistFromRag('proj-1', 'org-1', 'lakvatten', '29.40');
    expect(result.requirementsCreated).toBe(0);
  });

  it('creates case, requirement, and citation for valid AI requirement', async () => {
    mockEmbedding();
    mockSemanticHits([{ documentId: 'doc-1', chunkText: 'Relevant text here' }]);
    mockAiResponse([
      {
        documentId: 'doc-1',
        category: 'Lakvatten',
        subcategory: 'Provtagning',
        requirementTextQuote: 'Provtagning krävs månadsvis.',
        interpretedRequirement: 'Månadsvis provtagning av lakvatten.',
        level: 'mandatory',
        legalReference: 'Miljöbalken 9 kap. 3 §',
      },
    ]);
    mockDocument('doc-1');
    mockRequirementCase('case-1');
    mockRequirementRecord('req-1');
    mockRequirementCitation();

    const result = await svc.extractAndGenerateChecklistFromRag('proj-1', 'org-1', 'lakvatten', '29.40');

    expect(result.requirementsCreated).toBe(1);
    expect(result.casesCreated).toBe(1);
    expect(result.citationsCreated).toBe(1);
    expect(result.message).toMatch(/1 requirements/i);
  });

  it('reuses existing RequirementCase when found in DB', async () => {
    mockEmbedding();
    mockSemanticHits([{ documentId: 'doc-1', chunkText: 'Some text' }]);
    mockAiResponse([
      {
        documentId: 'doc-1',
        category: 'Buller',
        requirementTextQuote: 'Quiet',
        interpretedRequirement: 'No noise',
        level: 'mandatory',
      },
    ]);
    mockDocument('doc-1');
    prismaMock.requirementCase.findUnique.mockResolvedValue({ id: 'existing-case' });
    prismaMock.requirementCase.create.mockResolvedValue({ id: 'new-case' });
    mockRequirementRecord('req-1');
    mockRequirementCitation();

    const result = await svc.extractAndGenerateChecklistFromRag('proj-1', 'org-1', 'buller', '29.40');

    expect(prismaMock.requirementCase.create).not.toHaveBeenCalled();
    expect(result.casesCreated).toBe(0);
    expect(result.requirementsCreated).toBe(1);
  });

  it('handles AI response wrapped in markdown JSON block', async () => {
    mockEmbedding();
    mockSemanticHits([{ documentId: 'doc-1', chunkText: 'text' }]);
    const req = [
      {
        documentId: 'doc-1',
        category: 'Damning',
        requirementTextQuote: 'Dammning kontrolleras',
        interpretedRequirement: 'Kontrollera damning regelbundet',
        level: 'mandatory',
      },
    ];
    // AI wraps in markdown block – service should still parse the raw array
    mocks.serverGenerateText.mockResolvedValue(`\`\`\`json\n${JSON.stringify(req)}\n\`\`\``);
    mockDocument('doc-1');
    mockRequirementCase('case-1');
    mockRequirementRecord('req-1');
    mockRequirementCitation();

    // Service extracts JSON via regex – should find the array inside the block
    const result = await svc.extractAndGenerateChecklistFromRag('proj-1', 'org-1', 'damning', '29.40');
    expect(result.requirementsCreated).toBe(1);
  });

  it('passes projectId and organisationId when querying semantic chunks', async () => {
    mockEmbedding([0.5, 0.6]);
    mocks.queryTopSemanticChunks.mockResolvedValue([]);
    await svc.extractAndGenerateChecklistFromRag('my-project', 'my-org', 'test query', '29.50');
    expect(mocks.queryTopSemanticChunks).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: 'my-project', organisationId: 'my-org', limit: 15 }),
    );
  });
});
