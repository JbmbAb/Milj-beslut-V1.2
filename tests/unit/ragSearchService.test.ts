import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  embedText: vi.fn(),
  queryTopSemanticChunks: vi.fn(),
  searchGraph: vi.fn(),
  loggerWarn: vi.fn(),
  loggerInfo: vi.fn(),
  generateText: vi.fn(),
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
  logger: {
    warn: mocks.loggerWarn,
    info: mocks.loggerInfo,
  },
}));

vi.mock('../../server/services/vertexAiService', () => ({
  generateJsonWithVertex: vi.fn(),
  vertexConfigStatus: vi.fn(),
  __resetVertexClientForTest: vi.fn(),
}));

vi.mock('../../server/services/aiProviderImplementation', () => ({
  getAiProvider: () => ({
    generateText: mocks.generateText,
  }),
}));

import { runRagSearch } from '../../server/services/ragSearchService';

describe('runRagSearch', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    process.env.VERTEX_PROJECT_ID = 'test-proj';
  });

  it('returns answer with sources and graph nodes on happy path', async () => {
    mocks.embedText.mockResolvedValue({ values: [0.1, 0.2], model: 'text-embedding-004' });
    mocks.queryTopSemanticChunks.mockResolvedValue([
      { documentId: 'doc1', chunkIndex: 0, chunkText: 'Some relevant text about miljö', similarity: 0.9 },
    ]);
    mocks.searchGraph.mockResolvedValue({
      nodes: [{ id: 'n1', nodeType: 'Regulation', name: 'MB 2 kap' }],
    });
    mocks.generateText.mockResolvedValue({ text: 'Svaret är att miljöbalken kräver tillstånd.' });

    const result = await runRagSearch({
      query: 'Vad krävs för tillstånd?',
      organisationId: 'org-1',
    });

    expect(result.answer).toBe('Svaret är att miljöbalken kräver tillstånd.');
    expect(result.fallback).toBe(false);
    expect(result.sources).toHaveLength(1);
    expect(result.sources[0].documentId).toBe('doc1');
    expect(result.sources[0].score).toBe(0.9);
    expect(result.graphNodes).toHaveLength(1);
    expect(result.graphNodes[0].name).toBe('MB 2 kap');
    expect(result.queryEmbeddingModel).toBe('text-embedding-004');
    expect(result.generatedAt).toBeTruthy();
  });

  it('uses fallback answer when Gemini fails', async () => {
    mocks.embedText.mockResolvedValue({ values: [0.1], model: 'text-embedding-004' });
    mocks.queryTopSemanticChunks.mockResolvedValue([
      { documentId: 'doc2', chunkIndex: 1, chunkText: 'Miljöbalkens bestämmelser', similarity: 0.7 },
    ]);
    mocks.searchGraph.mockResolvedValue({ nodes: [] });
    mocks.generateText.mockRejectedValue(new Error('API error'));

    const result = await runRagSearch({
      query: 'Miljöbalken?',
      organisationId: 'org-1',
    });

    expect(result.fallback).toBe(true);
    expect(result.answer).toContain('Baserat på tillgängliga dokument');
    expect(mocks.loggerWarn).toHaveBeenCalled();
  });

  it('uses fallback with no-document message when no sources or embedding', async () => {
    mocks.embedText.mockResolvedValue(null);
    mocks.searchGraph.mockResolvedValue({ nodes: [] });

    const result = await runRagSearch({
      query: 'okänd fråga',
      organisationId: 'org-1',
    });

    expect(result.fallback).toBe(true);
    expect(result.answer).toContain('Inga relevanta dokument');
    expect(result.sources).toHaveLength(0);
  });

  it('caps limit at 20', async () => {
    mocks.embedText.mockResolvedValue({ values: [0.5], model: 'm' });
    mocks.queryTopSemanticChunks.mockResolvedValue([]);
    mocks.searchGraph.mockResolvedValue({ nodes: [] });

    await runRagSearch({ query: 'test', organisationId: 'org-1', limit: 100 });

    expect(mocks.queryTopSemanticChunks).toHaveBeenCalledWith(expect.objectContaining({ limit: 20 }));
  });

  it('passes projectId to queryTopSemanticChunks when provided', async () => {
    mocks.embedText.mockResolvedValue({ values: [0.1], model: 'm' });
    mocks.queryTopSemanticChunks.mockResolvedValue([]);
    mocks.searchGraph.mockResolvedValue({ nodes: [] });

    await runRagSearch({ query: 'q', organisationId: 'org-1', projectId: 'proj-42' });

    expect(mocks.queryTopSemanticChunks).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: 'proj-42' }),
    );
  });

  it('warns and continues when semantic chunk query throws', async () => {
    mocks.embedText.mockResolvedValue({ values: [0.1], model: 'm' });
    mocks.queryTopSemanticChunks.mockRejectedValue(new Error('DB error'));
    mocks.searchGraph.mockResolvedValue({ nodes: [] });

    const result = await runRagSearch({ query: 'q', organisationId: 'org-1' });

    expect(result.sources).toHaveLength(0);
    expect(mocks.loggerWarn).toHaveBeenCalledWith(
      'rag-search: semantic chunk query failed',
      expect.anything(),
    );
  });

  it('warns and continues when graph search throws', async () => {
    mocks.embedText.mockResolvedValue({ values: [0.1], model: 'm' });
    mocks.queryTopSemanticChunks.mockResolvedValue([]);
    mocks.searchGraph.mockRejectedValue(new Error('Graph error'));

    const result = await runRagSearch({ query: 'q', organisationId: 'org-1' });

    expect(result.graphNodes).toHaveLength(0);
    expect(mocks.loggerWarn).toHaveBeenCalledWith('rag-search: graph search failed', expect.anything());
  });

  it('skips Vertex generation when VERTEX_PROJECT_ID is not set', async () => {
    delete process.env.VERTEX_PROJECT_ID;

    mocks.embedText.mockResolvedValue({ values: [0.1], model: 'm' });
    mocks.queryTopSemanticChunks.mockResolvedValue([]);
    mocks.searchGraph.mockResolvedValue({ nodes: [] });

    const result = await runRagSearch({ query: 'q', organisationId: 'org-1' });

    expect(mocks.generateText).not.toHaveBeenCalled();
    expect(result.fallback).toBe(true);
  });

  it('truncates source snippets to 400 characters', async () => {
    const longText = 'a'.repeat(600);
    mocks.embedText.mockResolvedValue({ values: [0.1], model: 'm' });
    mocks.queryTopSemanticChunks.mockResolvedValue([
      { documentId: 'docX', chunkIndex: 0, chunkText: longText, similarity: 0.5 },
    ]);
    mocks.searchGraph.mockResolvedValue({ nodes: [] });
    mocks.generateText.mockResolvedValue({ text: 'ok' });

    const result = await runRagSearch({ query: 'q', organisationId: 'org-1' });

    expect(result.sources[0].snippet).toHaveLength(400);
  });

  it('uses model "none" when embedding model is undefined', async () => {
    mocks.embedText.mockResolvedValue({ values: [0.1] }); // no .model field
    mocks.queryTopSemanticChunks.mockResolvedValue([]);
    mocks.searchGraph.mockResolvedValue({ nodes: [] });

    const result = await runRagSearch({ query: 'q', organisationId: 'org-1' });

    expect(result.queryEmbeddingModel).toBe('none');
  });
});
