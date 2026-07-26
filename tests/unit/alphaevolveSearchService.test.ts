import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { AlphaevolveSearchService, SearchChunkResult } from '../../server/services/searchService';
import { computeMinMaxStats } from '../../server/lib/stats';

const mocks = vi.hoisted(() => ({
  $queryRaw: vi.fn().mockResolvedValue([]),
  searchQueryLogCreate: vi.fn().mockResolvedValue({ id: 'mock-log-id' }),
  embedTextWithVertexPredict: vi.fn().mockResolvedValue({
    values: new Array(768).fill(0.1),
    model: 'text-multilingual-embedding-002',
  }),
  generateContent: vi.fn().mockResolvedValue({
    response: {
      text: () =>
        JSON.stringify([
          { id: 'chunk-1', score: 0.99 },
          { id: 'chunk-2', score: 0.35 },
        ]),
    },
  }),
}));

vi.mock('../../server/services/vertexEmbeddingService', () => ({
  embedTextWithVertexPredict: mocks.embedTextWithVertexPredict,
}));

vi.mock('@prisma/client', () => {
  return {
    PrismaClient: class PrismaClient {
      static raw = vi.fn((sql) => sql);
      $queryRaw = mocks.$queryRaw;
      searchQueryLog = {
        create: mocks.searchQueryLogCreate,
      };
    },
  };
});

vi.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: class GoogleGenerativeAI {
    getGenerativeModel() {
      return {
        generateContent: mocks.generateContent,
      };
    }
  },
}));

function mockRetrieval(
  prismaMock: { $queryRaw: ReturnType<typeof vi.fn> },
  fts: SearchChunkResult[],
  vector: SearchChunkResult[] = [],
) {
  prismaMock.$queryRaw.mockResolvedValueOnce(fts).mockResolvedValueOnce(vector).mockResolvedValue([]);
}

describe('AlphaevolveSearchService - Automated Tests', () => {
  let prismaMock: InstanceType<typeof PrismaClient>;
  let searchService: AlphaevolveSearchService;
  const originalGeminiKey = process.env.GEMINI_API_KEY;
  const originalVertexProject = process.env.VERTEX_PROJECT_ID;
  const originalMockAi = process.env.USE_MOCK_AI;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GEMINI_API_KEY = 'test-key';
    process.env.VERTEX_PROJECT_ID = 'test-project';
    delete process.env.USE_MOCK_AI;
    prismaMock = new PrismaClient();
    searchService = new AlphaevolveSearchService(prismaMock);
  });

  afterEach(() => {
    if (originalGeminiKey === undefined) {
      delete process.env.GEMINI_API_KEY;
    } else {
      process.env.GEMINI_API_KEY = originalGeminiKey;
    }
    if (originalVertexProject === undefined) {
      delete process.env.VERTEX_PROJECT_ID;
    } else {
      process.env.VERTEX_PROJECT_ID = originalVertexProject;
    }
    if (originalMockAi === undefined) {
      delete process.env.USE_MOCK_AI;
    } else {
      process.env.USE_MOCK_AI = originalMockAi;
    }
  });

  it('should execute FTS and pgvector search queries in parallel and merge results', async () => {
    const query = 'miljötillstånd schaktmassor';

    const mockFtsResults: SearchChunkResult[] = [
      {
        id: 'chunk-1',
        chunkText: 'Inblandning av schaktmassor kräver miljötillstånd.',
        documentId: 'doc-A',
        documentTitle: 'Beslut A',
        ftsRank: 0.95,
      },
      {
        id: 'chunk-2',
        chunkText: 'Anmälningsplikt gäller för sortering av massor.',
        documentId: 'doc-B',
        documentTitle: 'Beslut B',
        ftsRank: 0.85,
      },
    ];

    const mockVectorResults: SearchChunkResult[] = [
      {
        id: 'chunk-2',
        chunkText: 'Anmälningsplikt gäller för sortering av massor.',
        documentId: 'doc-B',
        documentTitle: 'Beslut B',
        vectorDistance: 0.12,
      },
      {
        id: 'chunk-3',
        chunkText: 'SGU jordlager och krossmaterial analyseras.',
        documentId: 'doc-C',
        documentTitle: 'Beslut C',
        vectorDistance: 0.22,
      },
    ];

    mockRetrieval(prismaMock, mockFtsResults, mockVectorResults);

    const results = await searchService.search(query, { config: { FINAL_TOP_K: 5 } });

    expect(mocks.embedTextWithVertexPredict).toHaveBeenCalledTimes(1);
    expect(prismaMock.$queryRaw).toHaveBeenCalledTimes(5);

    expect(results.length).toBe(3);
    const chunk2 = results.find((r) => r.id === 'chunk-2');
    expect(chunk2).toBeDefined();
    expect(chunk2?.rrfScore).toBeGreaterThan(0);

    const chunk1 = results.find((r) => r.id === 'chunk-1');
    expect(chunk2!.rrfScore!).toBeGreaterThan(chunk1!.rrfScore!);
  });

  it('should apply PostGIS spatial filtering when bounding box coordinates are provided', async () => {
    const query = 'skredrisk fastighet';
    const bbox: [number, number, number, number] = [14.95, 61.12, 15.05, 61.2];

    const mockFtsResults: SearchChunkResult[] = [
      {
        id: 'chunk-1',
        chunkText: 'Stabilitetszon Orsa enligt SGU geokarta.',
        documentId: 'doc-A',
        documentTitle: 'Skredanalys A',
        ftsRank: 0.9,
      },
      {
        id: 'chunk-2',
        chunkText: 'Geoteknisk utredning för Enköpings lera.',
        documentId: 'doc-B',
        documentTitle: 'Stabilitet B',
        ftsRank: 0.8,
      },
    ];

    prismaMock.$queryRaw
      .mockResolvedValueOnce(mockFtsResults)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'chunk-1' }])
      .mockResolvedValue([]);

    const results = await searchService.search(query, { bbox });

    expect(results.length).toBe(1);
    expect(results[0].id).toBe('chunk-1');
    expect(prismaMock.$queryRaw).toHaveBeenCalledTimes(4);
  });

  it('should apply Cross-Encoder reranking modifiers only when feature-flag is enabled', async () => {
    const query = 'registerenhet lantmäteriet';

    const mockFtsResults: SearchChunkResult[] = [
      {
        id: 'chunk-1',
        chunkText: 'Lantmäteriet registerenhet.',
        documentId: 'doc-A',
        documentTitle: 'Fastighet A',
        ftsRank: 0.99,
      },
      {
        id: 'chunk-2',
        chunkText: 'SGU jordlager och krossmaterial analyseras.',
        documentId: 'doc-B',
        documentTitle: 'Beslut B',
        ftsRank: 0.88,
      },
    ];

    mockRetrieval(prismaMock, mockFtsResults, []);
    const resultsNoRerank = await searchService.search(query, {
      config: { CROSS_ENCODER_ENABLED: false, FINAL_TOP_K: 2 },
    });
    expect(resultsNoRerank[0].finalScore).toBe(resultsNoRerank[0].rrfScore);
    expect(mocks.generateContent).not.toHaveBeenCalled();

    mockRetrieval(prismaMock, mockFtsResults, []);
    const resultsWithRerank = await searchService.search(query, {
      config: { CROSS_ENCODER_ENABLED: true, FINAL_TOP_K: 2 },
    });

    expect(mocks.generateContent).toHaveBeenCalledTimes(1);
    expect(resultsWithRerank[0].finalScore).toBe(0.99);
    expect(resultsWithRerank[0].finalScore).not.toBe(resultsWithRerank[0].rrfScore);
  });

  it('should use local fallback reranker when GEMINI_API_KEY is missing', async () => {
    delete process.env.GEMINI_API_KEY;

    const query = 'registerenhet lantmäteriet';
    const mockFtsResults: SearchChunkResult[] = [
      {
        id: 'chunk-1',
        chunkText: 'Lantmäteriet registerenhet.',
        documentId: 'doc-A',
        documentTitle: 'Fastighet A',
        ftsRank: 0.99,
      },
      {
        id: 'chunk-2',
        chunkText: 'Anmälningsplikt för massor.',
        documentId: 'doc-B',
        documentTitle: 'Fastighet B',
        ftsRank: 0.88,
      },
    ];

    mockRetrieval(prismaMock, mockFtsResults, []);
    const results = await searchService.search(query, {
      config: { CROSS_ENCODER_ENABLED: true, FINAL_TOP_K: 2 },
    });

    expect(mocks.generateContent).not.toHaveBeenCalled();
    expect(results[0].finalScore!).toBeGreaterThan(results[0].rrfScore!);
  });

  it('should skip Gemini Reranker when skip criteria are met', async () => {
    // 1. Single candidate skip check
    const query = 'miljö';
    const mockFtsResults: SearchChunkResult[] = [
      {
        id: 'chunk-1',
        chunkText: 'Lantmäteriet registerenhet.',
        documentId: 'doc-A',
        documentTitle: 'Fastighet A',
        ftsRank: 0.99,
      },
    ];

    mockRetrieval(prismaMock, mockFtsResults, []);
    const results = await searchService.search(query, {
      config: { CROSS_ENCODER_ENABLED: true, FINAL_TOP_K: 1 },
    });

    // Should skip since we have exactly 1 candidate
    expect(mocks.generateContent).not.toHaveBeenCalled();
    const telemetry = searchService.getLastRerankTelemetry();
    expect(telemetry).toBeDefined();
    expect(telemetry.shouldSkipReranker).toBe(true);
    expect(telemetry.skipReason).toBe('SINGLE_CANDIDATE');

    // 2. Short query skip check
    mockRetrieval(prismaMock, mockFtsResults, [mockFtsResults[0], { ...mockFtsResults[0], id: 'chunk-2' }]);
    await searchService.search('ab', {
      config: { CROSS_ENCODER_ENABLED: true, FINAL_TOP_K: 2 },
    });

    expect(mocks.generateContent).not.toHaveBeenCalled();
    const shortTelemetry = searchService.getLastRerankTelemetry();
    expect(shortTelemetry.shouldSkipReranker).toBe(true);
    expect(shortTelemetry.skipReason).toBe('QUERY_TOO_SHORT');
  });

  it('should correctly calculate semantic distance statistics for vector results', async () => {
    const candidates: SearchChunkResult[] = [
      { id: '1', chunkText: 'A', documentId: 'A', documentTitle: 'A', vectorDistance: 0.1 },
      { id: '2', chunkText: 'B', documentId: 'B', documentTitle: 'B', vectorDistance: 0.3 },
      { id: '3', chunkText: 'C', documentId: 'C', documentTitle: 'C', vectorDistance: 0.5 },
    ];

    const stats = computeMinMaxStats(
      candidates
        .map((c) => c.vectorDistance)
        .filter((d): d is number => d !== undefined && d !== null),
    );
    expect(stats.min).toBe(0.1);
    expect(stats.max).toBe(0.5);
    expect(stats.avg).toBe(0.3);
    expect(stats.count).toBe(3);
    // variance: ((0.1-0.3)^2 + (0.3-0.3)^2 + (0.5-0.3)^2) / 3 = (0.04 + 0 + 0.04) / 3 = 0.08 / 3 ≈ 0.0267
    expect(stats.variance).toBeCloseTo(0.0267, 4);
  });

  it('should include reranker telemetry in the logged search metrics', async () => {
    const query = 'miljötillstånd schaktmassor';
    const mockFtsResults: SearchChunkResult[] = [
      {
        id: 'chunk-1',
        chunkText: 'Inblandning av schaktmassor kräver miljötillstånd.',
        documentId: 'doc-A',
        documentTitle: 'Beslut A',
        ftsRank: 0.95,
      },
      {
        id: 'chunk-2',
        chunkText: 'Anmälningsplikt gäller för sortering av massor.',
        documentId: 'doc-B',
        documentTitle: 'Beslut B',
        ftsRank: 0.85,
        vectorDistance: 0.2,
      },
    ];

    mockRetrieval(prismaMock, mockFtsResults, []);
    await searchService.search(query, {
      config: { CROSS_ENCODER_ENABLED: true, FINAL_TOP_K: 2 },
    });

    const telemetry = searchService.getLastRerankTelemetry();
    expect(telemetry).toBeDefined();
    expect(telemetry.shouldSkipReranker).toBe(false);
    expect(telemetry.semanticStats.min).toBe(0.2);
    expect(telemetry.semanticStats.max).toBe(0.2);
    expect(telemetry.semanticStats.count).toBe(1);

    expect(mocks.searchQueryLogCreate).toHaveBeenCalledTimes(1);
  });
});
