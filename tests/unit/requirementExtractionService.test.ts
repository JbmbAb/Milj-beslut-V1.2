import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock prisma (vi.hoisted pattern) ────────────────────────────────────────

const mocks = vi.hoisted(() => {
  const outlookAttachmentFindMany = vi.fn();
  const extractedRequirementUpsert = vi.fn();
  const extractedRequirementFindMany = vi.fn();
  const extractedRequirementCount = vi.fn();
  const extractedRequirementGroupBy = vi.fn();
  const disconnect = vi.fn();

  const prismaInstance = {
    outlookAttachment: { findMany: outlookAttachmentFindMany },
    extractedRequirement: {
      upsert: extractedRequirementUpsert,
      findMany: extractedRequirementFindMany,
      count: extractedRequirementCount,
      groupBy: extractedRequirementGroupBy,
    },
    $disconnect: disconnect,
  };

  function PrismaClientMock(this: unknown) {
    return prismaInstance;
  }

  return {
    PrismaClientMock,
    outlookAttachmentFindMany,
    extractedRequirementUpsert,
    extractedRequirementFindMany,
    extractedRequirementCount,
    extractedRequirementGroupBy,
    disconnect,
  };
});

vi.mock('@prisma/client', () => ({
  PrismaClient: mocks.PrismaClientMock,
}));

// ─── Mock documentObjectStorage ──────────────────────────────────────────────

const { mockReadStorageFile } = vi.hoisted(() => ({ mockReadStorageFile: vi.fn() }));

vi.mock('../../server/services/documentObjectStorage', () => ({
  readStorageFile: mockReadStorageFile,
}));

// ─── Mock outlookIngestionService ────────────────────────────────────────────

const { mockMarkParsed, mockMarkFailed } = vi.hoisted(() => ({
  mockMarkParsed: vi.fn(),
  mockMarkFailed: vi.fn(),
}));

vi.mock('../../server/services/outlookIngestionService', () => ({
  markAttachmentParsed: mockMarkParsed,
  markAttachmentFailed: mockMarkFailed,
}));

import {
  segmentText,
  isRequirementCandidate,
  classifyByRules,
  extractLegalReference,
  classifyRequirementLevel,
  extractRequirementsFromText,
  processPendingAttachments,
  queryRequirements,
  getRequirementStats,
} from '../../server/services/requirementExtractionService';

// ─── segmentText ──────────────────────────────────────────────────────────────

describe('segmentText', () => {
  beforeEach(() => vi.resetAllMocks());

  it('splits a simple text into segments', () => {
    const text = 'Verksamheten ska rapportera utsläpp. All hantering ska dokumenteras.';
    const segments = segmentText(text);
    expect(segments.length).toBeGreaterThan(0);
    expect(segments[0]).toHaveProperty('text');
    expect(segments[0]).toHaveProperty('index');
  });

  it('filters out tiny fragments (< 20 chars)', () => {
    const text = 'OK.\n\nDetta är en längre mening som uppfyller minimikravet på längd.';
    const segments = segmentText(text);
    expect(segments.every((s) => s.text.length > 20)).toBe(true);
  });

  it('handles page breaks (\\f) and sets pageNumber', () => {
    const text =
      'Sida ett innehåller krav på säkerhet.\fSida två innehåller krav på avfall och rapportering.';
    const segments = segmentText(text);
    const page2 = segments.find((s) => s.pageNumber === 2);
    expect(page2).toBeDefined();
  });

  it('returns sequential index values', () => {
    const text = 'Krav ska uppfyllas regelbundet. Rapportering ska ske varje kvartal.';
    const segments = segmentText(text);
    for (let i = 0; i < segments.length; i++) {
      expect(segments[i].index).toBe(i);
    }
  });

  it('returns empty array for empty string', () => {
    expect(segmentText('')).toEqual([]);
  });
});

// ─── isRequirementCandidate ───────────────────────────────────────────────────

describe('isRequirementCandidate', () => {
  beforeEach(() => vi.resetAllMocks());

  it('returns true when text contains "ska"', () => {
    expect(isRequirementCandidate('Verksamheten ska rapportera alla utsläpp till myndigheten.')).toBe(true);
  });

  it('returns true when text contains "måste"', () => {
    expect(isRequirementCandidate('Avfallet måste hanteras enligt föreskrift.')).toBe(true);
  });

  it('returns true for "får inte"', () => {
    expect(isRequirementCandidate('Ämnet får inte lagras utan täckning.')).toBe(true);
  });

  it('returns false for text with no requirement keywords', () => {
    expect(isRequirementCandidate('Det är soligt ute idag och temperaturen är behaglig.')).toBe(false);
  });

  it('is case-insensitive', () => {
    expect(isRequirementCandidate('Verksamheten SKA dokumentera alla åtgärder.')).toBe(true);
  });
});

// ─── classifyByRules ──────────────────────────────────────────────────────────

describe('classifyByRules', () => {
  beforeEach(() => vi.resetAllMocks());

  it('classifies water_management from signal words', () => {
    const result = classifyByRules('Dagvattenhantering och oljeavskiljare ska installeras.');
    expect(result.category).toBe('water_management');
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  it('classifies hazardous_waste from signal words', () => {
    const result = classifyByRules('Farligt avfall ska förvaras åtskilt med märkning.');
    expect(result.category).toBe('hazardous_waste');
  });

  it('classifies documentation from signal words', () => {
    const result = classifyByRules('Egenkontroll och dokumentation ska föras i journal.');
    expect(result.category).toBe('documentation');
  });

  it('returns confidence 0.55 and a category (not "other") for text with no matching signals', () => {
    // Score formula is 0.55 + hits*0.15, so even 0 hits yields 0.55 > default 0.5.
    // The first category in the loop always wins; "other" is unreachable.
    const result = classifyByRules('Nothing here matches any signal word.');
    expect(result.confidence).toBe(0.55);
    expect(result.category).not.toBe('other');
  });

  it('confidence does not exceed 0.95', () => {
    const result = classifyByRules(
      'Dagvatten lakvatten grundvatten oljeavskiljare uppsamling recipient hantering.',
    );
    expect(result.confidence).toBeLessThanOrEqual(0.95);
  });
});

// ─── extractLegalReference ────────────────────────────────────────────────────

describe('extractLegalReference', () => {
  beforeEach(() => vi.resetAllMocks());

  it('extracts Miljöbalken reference', () => {
    const ref = extractLegalReference('Enligt miljöbalken 2 kap. 3 § ska åtgärder vidtas.');
    expect(ref).toContain('Miljöbalken');
  });

  it('extracts NFS reference', () => {
    const ref = extractLegalReference('Enligt NFS 2006:9 ska provtagning ske.');
    expect(ref).toContain('Naturvårdsverkets föreskrift');
  });

  it('returns null when no legal reference found', () => {
    expect(extractLegalReference('Det finns inga lagkrav nämnda här.')).toBeNull();
  });

  it('extracts Avfallsförordningen reference', () => {
    const ref = extractLegalReference('Avfallsförordningen 6 kap. reglerar detta.');
    expect(ref).toContain('Avfallsförordningen');
  });

  it('extracts generic SFS reference', () => {
    const ref = extractLegalReference('Se förordning 2020:614 för detaljer.');
    expect(ref).not.toBeNull();
  });
});

// ─── classifyRequirementLevel ─────────────────────────────────────────────────

describe('classifyRequirementLevel', () => {
  beforeEach(() => vi.resetAllMocks());

  it('returns mandatory for "ska"', () => {
    expect(classifyRequirementLevel('Verksamheten ska rapportera.')).toBe('mandatory');
  });

  it('returns mandatory for "skall"', () => {
    expect(classifyRequirementLevel('Åtgärder skall vidtas omedelbart.')).toBe('mandatory');
  });

  it('returns mandatory for "krävs"', () => {
    expect(classifyRequirementLevel('Tillstånd krävs för denna verksamhet.')).toBe('mandatory');
  });

  it('returns recommended for "bör"', () => {
    expect(classifyRequirementLevel('Verksamheten bör använda bästa teknik.')).toBe('recommended');
  });

  it('returns recommended for "rekommenderas"', () => {
    expect(classifyRequirementLevel('Det rekommenderas att använda filter.')).toBe('recommended');
  });

  it('returns conditional as default', () => {
    expect(classifyRequirementLevel('Vid behov vidtas ytterligare åtgärder.')).toBe('conditional');
  });
});

// ─── extractRequirementsFromText ──────────────────────────────────────────────

describe('extractRequirementsFromText', () => {
  beforeEach(() => vi.resetAllMocks());

  it('returns empty array for text with no requirement candidates', () => {
    const result = extractRequirementsFromText('Det är en vacker dag utomhus idag, sol och värme.');
    expect(result).toEqual([]);
  });

  it('extracts requirements from valid text', () => {
    const text = 'Dagvatten ska hanteras via oljeavskiljare och uppsamlingstank på anläggningen.';
    const result = extractRequirementsFromText(text);
    expect(result.length).toBeGreaterThan(0);
    expect(result[0]).toHaveProperty('requirementText');
    expect(result[0]).toHaveProperty('category');
    expect(result[0]).toHaveProperty('confidence');
  });

  it('sets correct requirementLevel', () => {
    const text = 'Farligt avfall ska förvaras åtskilt med korrekt märkning och klassificering.';
    const [req] = extractRequirementsFromText(text);
    expect(req.requirementLevel).toBe('mandatory');
  });

  it('extracts legalReference when present', () => {
    // Use a single run-on sentence so segmentText does not split it mid-reference
    const text =
      'Verksamheten ska hantera alla utsläpp och rapportera dessa till tillsynsmyndigheten i enlighet med miljöbalken 2 kap 3 §';
    const results = extractRequirementsFromText(text);
    const withRef = results.find((r) => r.legalReference != null);
    expect(withRef).toBeDefined();
  });

  it('handles multi-page text separated by form feed', () => {
    const text =
      'Dagvatten ska hanteras via oljeavskiljare.\fFarligt avfall ska förvaras åtskilt i märkta behållare.';
    const results = extractRequirementsFromText(text);
    expect(results.length).toBeGreaterThanOrEqual(1);
  });

  it('passes options without throwing', () => {
    const text = 'Provtagning ska utföras kvartalsvis för alla relevanta parametrar.';
    expect(() =>
      extractRequirementsFromText(text, { municipality: 'Göteborg', caseNumber: '2024-01' }),
    ).not.toThrow();
  });
});

// ─── processPendingAttachments ────────────────────────────────────────────────

describe('processPendingAttachments', () => {
  beforeEach(() => vi.resetAllMocks());

  it('returns zero stats when no pending attachments', async () => {
    mocks.outlookAttachmentFindMany.mockResolvedValue([]);
    mocks.disconnect.mockResolvedValue(undefined);

    const stats = await processPendingAttachments();
    expect(stats.processed).toBe(0);
    expect(stats.requirementsStored).toBe(0);
    expect(stats.errors).toEqual([]);
  });

  it('marks attachment failed when storedPath is null', async () => {
    mocks.outlookAttachmentFindMany.mockResolvedValue([
      { attachmentHash: 'hash1', filename: 'test.pdf', storedPath: null, parsed: false },
    ]);
    mockMarkFailed.mockResolvedValue(undefined);
    mocks.disconnect.mockResolvedValue(undefined);

    const stats = await processPendingAttachments();
    expect(mockMarkFailed).toHaveBeenCalledWith('hash1', expect.stringContaining('No extracted text'));
    expect(stats.errors.length).toBe(1);
  });

  it('marks attachment failed when file extension is not supported', async () => {
    mocks.outlookAttachmentFindMany.mockResolvedValue([
      { attachmentHash: 'hash2', filename: 'doc.pdf', storedPath: '/some/path/doc.pdf', parsed: false },
    ]);
    mockMarkFailed.mockResolvedValue(undefined);
    mocks.disconnect.mockResolvedValue(undefined);

    const stats = await processPendingAttachments();
    expect(mockMarkFailed).toHaveBeenCalled();
    expect(stats.errors.length).toBe(1);
  });

  it('processes attachment with valid .txt storedPath', async () => {
    mocks.outlookAttachmentFindMany.mockResolvedValue([
      { attachmentHash: 'hash3', filename: 'krav.txt', storedPath: '/docs/krav.txt', parsed: false },
    ]);
    mockReadStorageFile.mockResolvedValue(
      Buffer.from('Dagvatten ska hanteras via oljeavskiljare och uppsamlingstank på anläggningen.'),
    );
    mocks.extractedRequirementUpsert.mockResolvedValue({ id: 'r1' });
    mockMarkParsed.mockResolvedValue(undefined);
    mocks.disconnect.mockResolvedValue(undefined);

    const stats = await processPendingAttachments();
    expect(stats.processed).toBe(1);
    expect(stats.requirementsStored).toBeGreaterThan(0);
    expect(mockMarkParsed).toHaveBeenCalledWith('hash3', expect.any(String));
  });

  it('handles read errors and records in stats.errors', async () => {
    mocks.outlookAttachmentFindMany.mockResolvedValue([
      { attachmentHash: 'hash4', filename: 'err.txt', storedPath: '/docs/err.txt', parsed: false },
    ]);
    // loadExtractedText catches readFile errors and returns null, so the
    // service logs "No extracted text source available for attachment."
    mockReadStorageFile.mockRejectedValue(new Error('ENOENT: file not found'));
    mockMarkFailed.mockResolvedValue(undefined);
    mocks.disconnect.mockResolvedValue(undefined);

    const stats = await processPendingAttachments();
    expect(stats.errors.length).toBe(1);
    expect(stats.errors[0]).toContain('No extracted text');
  });
});

// ─── queryRequirements ────────────────────────────────────────────────────────

describe('queryRequirements', () => {
  beforeEach(() => vi.resetAllMocks());

  it('calls findMany with confidence threshold', async () => {
    mocks.extractedRequirementFindMany.mockResolvedValue([]);
    await queryRequirements({ minConfidence: 0.8, limit: 10 });
    const call = mocks.extractedRequirementFindMany.mock.calls[0][0];
    expect(call.where.confidence).toEqual({ gte: 0.8 });
    expect(call.take).toBe(10);
  });

  it('uses default confidence 0.6 when not specified', async () => {
    mocks.extractedRequirementFindMany.mockResolvedValue([]);
    await queryRequirements({});
    const call = mocks.extractedRequirementFindMany.mock.calls[0][0];
    expect(call.where.confidence).toEqual({ gte: 0.6 });
  });

  it('applies category filter when provided', async () => {
    mocks.extractedRequirementFindMany.mockResolvedValue([]);
    await queryRequirements({ category: 'sampling' });
    const call = mocks.extractedRequirementFindMany.mock.calls[0][0];
    expect(call.where.category).toBe('sampling');
  });

  it('applies municipality filter when provided', async () => {
    mocks.extractedRequirementFindMany.mockResolvedValue([]);
    await queryRequirements({ municipality: 'Malmö' });
    const call = mocks.extractedRequirementFindMany.mock.calls[0][0];
    expect(call.where.OR).toEqual([
      { municipality: 'Malmö' },
      {
        attachment: {
          document: {
            is: {
              OR: [{ municipalityNormalized: 'Malmö' }, { municipality: 'Malmö' }],
            },
          },
        },
      },
    ]);
  });
});

// ─── getRequirementStats ──────────────────────────────────────────────────────

describe('getRequirementStats', () => {
  beforeEach(() => vi.resetAllMocks());

  it('returns total, byCategory, and byMunicipality', async () => {
    mocks.extractedRequirementGroupBy.mockResolvedValueOnce([{ category: 'sampling', _count: { id: 4 } }]);
    mocks.extractedRequirementFindMany.mockResolvedValue([
      { municipality: 'Stockholm', attachment: { document: null } },
      {
        municipality: null,
        attachment: { document: { municipalityNormalized: 'Uppsala', municipality: null } },
      },
      { municipality: null, attachment: { document: null } },
    ]);
    mocks.extractedRequirementCount.mockResolvedValue(6);

    const stats = await getRequirementStats();
    expect(stats.total).toBe(6);
    expect(stats.byCategory).toHaveLength(1);
    expect(stats.byMunicipality).toEqual([
      { municipality: 'Stockholm', _count: { id: 1 } },
      { municipality: 'Uppsala', _count: { id: 1 } },
      { municipality: '(okänd)', _count: { id: 1 } },
    ]);
  });

  it('returns zero counts for empty database', async () => {
    mocks.extractedRequirementGroupBy.mockResolvedValue([]);
    mocks.extractedRequirementFindMany.mockResolvedValue([]);
    mocks.extractedRequirementCount.mockResolvedValue(0);

    const stats = await getRequirementStats();
    expect(stats.total).toBe(0);
    expect(stats.byCategory).toEqual([]);
    expect(stats.byMunicipality).toEqual([]);
  });
});
