import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  embedText: vi.fn(),
  queryTopSemanticChunks: vi.fn(),
  serverGenerateText: vi.fn(),
  documentRecordFindUnique: vi.fn(),
  requirementCaseFindUnique: vi.fn(),
  requirementCaseCreate: vi.fn(),
  requirementRecordCreate: vi.fn(),
  requirementCitationCreate: vi.fn(),
  loggerError: vi.fn(),
  loggerInfo: vi.fn(),
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

vi.mock('../../server/logger', () => ({
  logger: {
    error: mocks.loggerError,
    info: mocks.loggerInfo,
    warn: vi.fn(),
  },
}));

vi.mock('../../server/db/prisma', () => ({
  prisma: {
    documentRecord: { findUnique: mocks.documentRecordFindUnique },
    requirementCase: {
      findUnique: mocks.requirementCaseFindUnique,
      create: mocks.requirementCaseCreate,
    },
    requirementRecord: { create: mocks.requirementRecordCreate },
    requirementCitation: { create: mocks.requirementCitationCreate },
  },
}));

import { extractAndGenerateChecklistFromRag } from '../../server/services/checkListRagService';

const FAKE_EMBEDDING = { values: new Array(768).fill(0.1) };
const FAKE_HITS = [
  { documentId: 'doc-1', chunkText: 'Lakvatten ska provtas månadsvis.' },
  { documentId: 'doc-1', chunkText: 'Buller begränsas till 55 dB(A).' },
];
const FAKE_DOCUMENT = {
  id: 'doc-1',
  municipality: 'Göteborg',
  diskName: 'beslut.pdf',
  subject: 'Miljöbeslut 2024',
};
const FAKE_REQUIREMENTS_JSON = JSON.stringify([
  {
    documentId: 'doc-1',
    category: 'Lakvatten',
    subcategory: 'Provtagning',
    requirementTextQuote: 'Lakvatten ska provtas månadsvis.',
    interpretedRequirement: 'Monthly leachate sampling required.',
    level: 'mandatory',
    legalReference: 'Miljöbalken 9 kap',
  },
]);

beforeEach(() => {
  vi.resetAllMocks();

  mocks.embedText.mockResolvedValue(FAKE_EMBEDDING);
  mocks.queryTopSemanticChunks.mockResolvedValue(FAKE_HITS);
  mocks.serverGenerateText.mockResolvedValue(FAKE_REQUIREMENTS_JSON);
  mocks.documentRecordFindUnique.mockResolvedValue(FAKE_DOCUMENT);
  mocks.requirementCaseFindUnique.mockResolvedValue(null);
  mocks.requirementCaseCreate.mockResolvedValue({ id: 'rc-1', caseKey: 'case_doc-1' });
  mocks.requirementRecordCreate.mockResolvedValue({ id: 'rr-1' });
  mocks.requirementCitationCreate.mockResolvedValue({ id: 'cit-1' });
});

describe('extractAndGenerateChecklistFromRag', () => {
  it('returns created counts on a successful run', async () => {
    const result = await extractAndGenerateChecklistFromRag('proj-1', 'org-1', 'lakvatten krav', '90.003-1');

    expect(result.requirementsCreated).toBe(1);
    expect(result.casesCreated).toBe(1);
    expect(result.citationsCreated).toBe(1);
    expect(result.message).toMatch(/1 requirements/i);
  });

  it('throws when embedding generation fails', async () => {
    mocks.embedText.mockResolvedValue(null);

    await expect(extractAndGenerateChecklistFromRag('proj-1', 'org-1', 'query', 'code')).rejects.toThrow(
      'Failed to generate embedding',
    );
  });

  it('throws when embedding returns empty values', async () => {
    mocks.embedText.mockResolvedValue({ values: [] });

    await expect(extractAndGenerateChecklistFromRag('proj-1', 'org-1', 'query', 'code')).rejects.toThrow(
      'Failed to generate embedding',
    );
  });

  it('returns zero counts when no semantic hits are found', async () => {
    mocks.queryTopSemanticChunks.mockResolvedValue([]);

    const result = await extractAndGenerateChecklistFromRag('proj-1', 'org-1', 'query', 'code');

    expect(result.requirementsCreated).toBe(0);
    expect(result.casesCreated).toBe(0);
    expect(result.message).toMatch(/No relevant documents/i);
  });

  it('throws when AI returns invalid JSON', async () => {
    mocks.serverGenerateText.mockResolvedValue('not json at all');

    await expect(extractAndGenerateChecklistFromRag('proj-1', 'org-1', 'query', 'code')).rejects.toThrow(
      'AI failed to return valid JSON format',
    );

    expect(mocks.loggerError).toHaveBeenCalled();
  });

  it('returns zero counts when AI returns empty array', async () => {
    mocks.serverGenerateText.mockResolvedValue('[]');

    const result = await extractAndGenerateChecklistFromRag('proj-1', 'org-1', 'query', 'code');

    expect(result.requirementsCreated).toBe(0);
    expect(result.message).toMatch(/No requirements could be extracted/i);
  });

  it('skips entries where documentId is missing', async () => {
    mocks.serverGenerateText.mockResolvedValue(
      JSON.stringify([{ category: 'Test', requirementTextQuote: 'Quote' }]),
    );

    const result = await extractAndGenerateChecklistFromRag('proj-1', 'org-1', 'query', 'code');

    expect(result.requirementsCreated).toBe(0);
    expect(mocks.documentRecordFindUnique).not.toHaveBeenCalled();
  });

  it('skips entries where document does not exist in DB', async () => {
    mocks.documentRecordFindUnique.mockResolvedValue(null);

    const result = await extractAndGenerateChecklistFromRag('proj-1', 'org-1', 'query', 'code');

    expect(result.requirementsCreated).toBe(0);
    expect(mocks.requirementCaseCreate).not.toHaveBeenCalled();
  });

  it('reuses an existing RequirementCase instead of creating a new one', async () => {
    const existingCase = { id: 'rc-existing', caseKey: 'case_doc-1' };
    mocks.requirementCaseFindUnique.mockResolvedValue(existingCase);

    const result = await extractAndGenerateChecklistFromRag('proj-1', 'org-1', 'query', 'code');

    expect(mocks.requirementCaseCreate).not.toHaveBeenCalled();
    expect(result.casesCreated).toBe(0);
    expect(result.requirementsCreated).toBe(1);
  });

  it('passes organisationId and projectId when creating RequirementCase', async () => {
    await extractAndGenerateChecklistFromRag('proj-42', 'org-99', 'query', 'code');

    expect(mocks.requirementCaseCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          projectId: 'proj-42',
          organisationId: 'org-99',
        }),
      }),
    );
  });

  it('creates one RequirementCitation per RequirementRecord', async () => {
    await extractAndGenerateChecklistFromRag('proj-1', 'org-1', 'query', 'code');

    expect(mocks.requirementCitationCreate).toHaveBeenCalledTimes(1);
    expect(mocks.requirementCitationCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          extractor: 'Gemini-2.5-Pro',
        }),
      }),
    );
  });

  it('handles multiple requirements across the same document', async () => {
    mocks.serverGenerateText.mockResolvedValue(
      JSON.stringify([
        {
          documentId: 'doc-1',
          category: 'Cat1',
          subcategory: 'Sub1',
          requirementTextQuote: 'Q1',
          interpretedRequirement: 'I1',
          level: 'mandatory',
          legalReference: 'MB',
        },
        {
          documentId: 'doc-1',
          category: 'Cat2',
          subcategory: 'Sub2',
          requirementTextQuote: 'Q2',
          interpretedRequirement: 'I2',
          level: 'mandatory',
          legalReference: 'MB',
        },
      ]),
    );
    // Second call to findUnique returns existing case
    mocks.requirementCaseFindUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'rc-1', caseKey: 'case_doc-1' });

    const result = await extractAndGenerateChecklistFromRag('proj-1', 'org-1', 'query', 'code');

    expect(result.requirementsCreated).toBe(2);
    expect(result.casesCreated).toBe(1);
    expect(result.citationsCreated).toBe(2);
  });
});
