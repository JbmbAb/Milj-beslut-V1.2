import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  embedText: vi.fn(),
  queryTopSemanticChunks: vi.fn(),
  searchGraph: vi.fn(),
  loggerWarn: vi.fn(),
  generateContent: vi.fn(),
}));

vi.mock('../../server/services/searchService', () => ({
  embedText: mocks.embedText,
}));

vi.mock('../../server/repositories/searchRepository', () => ({
  queryTopSemanticChunks: mocks.queryTopSemanticChunks,
}));

vi.mock('../../server/services/knowledgeGraphService', () => ({
  searchGraph: mocks.searchGraph,
}));

vi.mock('../../server/logger', () => ({
  logger: { warn: mocks.loggerWarn, info: vi.fn(), error: vi.fn() },
}));

// Mock @google/genai with a factory that the dynamic import() will pick up.
// Must use function (not arrow) to satisfy vitest v4 constructor mock requirement.
vi.mock('@google/genai', () => ({
  GoogleGenAI: vi.fn(function (this: Record<string, unknown>) {
    return { models: { generateContent: mocks.generateContent } };
  }),
}));

import { runRagSearch } from '../../server/services/ragSearchService';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const originalEnv = { ...process.env };

function setApiKey(key: string | undefined) {
  if (key === undefined) {
    delete process.env.GEMINI_API_KEY;
    delete process.env.VITE_GEMINI_API_KEY;
  } else {
    process.env.GEMINI_API_KEY = key;
  }
}

function makeParams(overrides: Partial<Parameters<typeof runRagSearch>[0]> = {}) {
  return {
    query: 'Vilka krav gäller för miljöfarlig verksamhet?',
    organisationId: 'org-1',
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('ragSearchService – runRagSearch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };

    // Default: no embedding, empty graph
    mocks.embedText.mockResolvedValue(null);
    mocks.searchGraph.mockResolvedValue({ nodes: [] });
    mocks.queryTopSemanticChunks.mockResolvedValue([]);
  });

  it('returns fallback answer when no embedding and no API key', async () => {
    setApiKey(undefined);

    const result = await runRagSearch(makeParams());

    expect(result.fallback).toBe(true);
    expect(result.answer).toContain(makeParams().query);
    expect(result.sources).toHaveLength(0);
    expect(result.graphNodes).toHaveLength(0);
  });

  it('returns structured result with generatedAt timestamp', async () => {
    setApiKey(undefined);

    const result = await runRagSearch(makeParams());

    expect(result.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(result.queryEmbeddingModel).toBe('none');
  });

  it('uses semantic chunks when embedding succeeds', async () => {
    setApiKey(undefined);
    mocks.embedText.mockResolvedValue({ values: [0.1, 0.2], model: 'text-embedding-004' });
    mocks.queryTopSemanticChunks.mockResolvedValue([
      {
        documentId: 'doc-1',
        chunkIndex: 0,
        chunkText: 'Miljöfarlig verksamhet regleras i 9 kap MB.',
        similarity: 0.92,
      },
    ]);

    const result = await runRagSearch(makeParams());

    expect(result.sources).toHaveLength(1);
    expect(result.sources[0].documentId).toBe('doc-1');
    expect(result.sources[0].score).toBeCloseTo(0.92);
    expect(result.queryEmbeddingModel).toBe('text-embedding-004');
  });

  it('includes graph nodes in result', async () => {
    setApiKey(undefined);
    mocks.searchGraph.mockResolvedValue({
      nodes: [{ id: 'n1', nodeType: 'LAW', name: 'Miljöbalken' }],
    });

    const result = await runRagSearch(makeParams());

    expect(result.graphNodes).toHaveLength(1);
    expect(result.graphNodes[0].name).toBe('Miljöbalken');
  });

  it('falls back gracefully when semantic chunk query fails', async () => {
    setApiKey(undefined);
    mocks.embedText.mockResolvedValue({ values: [0.1], model: 'model-x' });
    mocks.queryTopSemanticChunks.mockRejectedValue(new Error('pgvector error'));

    const result = await runRagSearch(makeParams());

    expect(result.sources).toHaveLength(0);
    expect(mocks.loggerWarn).toHaveBeenCalled();
  });

  it('falls back gracefully when graph search fails', async () => {
    setApiKey(undefined);
    mocks.searchGraph.mockRejectedValue(new Error('graph DB error'));

    const result = await runRagSearch(makeParams());

    expect(result.graphNodes).toHaveLength(0);
    expect(mocks.loggerWarn).toHaveBeenCalled();
  });

  it('uses Gemini to generate answer when API key is set and context exists', async () => {
    setApiKey('test-gemini-key');
    mocks.embedText.mockResolvedValue({ values: [0.1, 0.2], model: 'emb' });
    mocks.queryTopSemanticChunks.mockResolvedValue([
      {
        documentId: 'doc-1',
        chunkIndex: 0,
        chunkText: 'Miljöfarlig verksamhet kräver tillstånd.',
        similarity: 0.9,
      },
    ]);
    mocks.generateContent.mockResolvedValue({ text: 'AI-genererat svar om miljörätt.' });

    const result = await runRagSearch(makeParams());

    expect(result.fallback).toBe(false);
    expect(result.answer).toBe('AI-genererat svar om miljörätt.');
  });

  it('falls back to snippet answer when Gemini generation fails', async () => {
    setApiKey('test-gemini-key');
    mocks.embedText.mockResolvedValue({ values: [0.1], model: 'emb' });
    mocks.queryTopSemanticChunks.mockResolvedValue([
      {
        documentId: 'doc-1',
        chunkIndex: 0,
        chunkText: 'Snippet text here.',
        similarity: 0.8,
      },
    ]);
    mocks.generateContent.mockRejectedValue(new Error('Gemini API timeout'));

    const result = await runRagSearch(makeParams());

    expect(result.fallback).toBe(true);
    expect(result.answer).toContain('Snippet text here');
  });

  it('caps limit at 20', async () => {
    setApiKey(undefined);
    mocks.embedText.mockResolvedValue({ values: [0.1], model: 'emb' });
    mocks.queryTopSemanticChunks.mockResolvedValue([]);

    await runRagSearch(makeParams({ limit: 999 }));

    expect(mocks.queryTopSemanticChunks).toHaveBeenCalledWith(expect.objectContaining({ limit: 20 }));
  });

  it('passes projectId to chunk query when provided', async () => {
    setApiKey(undefined);
    mocks.embedText.mockResolvedValue({ values: [0.5], model: 'emb' });
    mocks.queryTopSemanticChunks.mockResolvedValue([]);

    await runRagSearch(makeParams({ projectId: 'proj-42' }));

    expect(mocks.queryTopSemanticChunks).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: 'proj-42', organisationId: 'org-1' }),
    );
  });
});
