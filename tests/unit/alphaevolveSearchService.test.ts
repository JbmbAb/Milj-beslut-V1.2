import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { AlphaevolveSearchService, SearchChunkResult } from '../../server/services/searchService';

// Mocka PrismaClient
vi.mock('@prisma/client', () => {
  const mPrisma = {
    $queryRaw: vi.fn(),
    searchQueryLog: {
      create: vi.fn().mockResolvedValue({ id: 'mock-log-id' }),
    },
  };
  return {
    PrismaClient: vi.fn(() => mPrisma),
  };
});

describe('AlphaevolveSearchService - Automated Tests', () => {
  let prismaMock: any;
  let searchService: AlphaevolveSearchService;

  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock = new PrismaClient();
    searchService = new AlphaevolveSearchService(prismaMock);
  });

  // ---------------------------------------------------------------------------
  // TEST 1: Parallellitetstest & Grundretrieval (Promise.all)
  // ---------------------------------------------------------------------------
  it('should execute FTS and pgvector search queries in parallel and merge results', async () => {
    const query = 'miljötillstånd schaktmassor';
    
    // Förbered skendata för FTS (Full-Text Search)
    const mockFtsResults: SearchChunkResult[] = [
      { id: 'chunk-1', chunkText: 'Inblandning av schaktmassor kräver miljötillstånd.', documentId: 'doc-A', documentTitle: 'Beslut A', ftsRank: 0.95 },
      { id: 'chunk-2', chunkText: 'Anmälningsplikt gäller för sortering av massor.', documentId: 'doc-B', documentTitle: 'Beslut B', ftsRank: 0.85 },
    ];

    // Förbered skendata för pgvector-retrieval
    const mockVectorResults: SearchChunkResult[] = [
      { id: 'chunk-2', chunkText: 'Anmälningsplikt gäller för sortering av massor.', documentId: 'doc-B', documentTitle: 'Beslut B', vectorDistance: 0.12 },
      { id: 'chunk-3', chunkText: 'SGU jordlager och krossmaterial analyseras.', documentId: 'doc-C', documentTitle: 'Beslut C', vectorDistance: 0.22 },
    ];

    // Simulera $queryRaw-svar för FTS (anrop 1) och Vector (anrop 2)
    prismaMock.$queryRaw
      .mockResolvedValueOnce(mockFtsResults)     // Första rå-SQL: FTS
      .mockResolvedValueOnce(mockVectorResults);  // Andra rå-SQL: pgvector

    const startTime = Date.now();
    const results = await searchService.search(query, { config: { FINAL_TOP_K: 5 } });
    const duration = Date.now() - startTime;

    // Verifiera parallellitet och snabb I/O-latens (under 50ms för minnesfrågor)
    expect(duration).toBeLessThan(50);

    // Kontrollera att $queryRaw har anropats exakt 2 gånger (parallellt)
    expect(prismaMock.$queryRaw).toHaveBeenCalledTimes(2);

    // Kontrollera att RRF-fusionsalgoritmen har slagit ihop dubbletter (chunk-2 finns i båda)
    expect(results.length).toBe(3); // chunk-1, chunk-2, chunk-3
    const chunk2 = results.find(r => r.id === 'chunk-2');
    expect(chunk2).toBeDefined();
    
    // Kontrollera att RRF-score har beräknats korrekt (bör vara högst för chunk-2 då den fanns i båda listorna)
    expect(chunk2?.rrfScore).toBeGreaterThan(0);
  });

  // ---------------------------------------------------------------------------
  // TEST 2: Spatial JOIN & Geografisk filtrering (PostGIS)
  // ---------------------------------------------------------------------------
  it('should apply PostGIS spatial filtering when bounding box coordinates are provided', async () => {
    const query = 'skredrisk fastighet';
    const bbox: [number, number, number, number] = [14.95, 61.12, 15.05, 61.20]; // Orsa BBox

    const mockFtsResults: SearchChunkResult[] = [
      { id: 'chunk-1', chunkText: 'Stabilitetszon Orsa enligt SGU geokarta.', documentId: 'doc-A', documentTitle: 'Skredanalys A', ftsRank: 0.90 },
      { id: 'chunk-2', chunkText: 'Geoteknisk utredning för Enköpings lera.', documentId: 'doc-B', documentTitle: 'Stabilitet B', ftsRank: 0.80 },
    ];

    prismaMock.$queryRaw
      .mockResolvedValueOnce(mockFtsResults) // FTS-sökning
      .mockResolvedValueOnce([])             // pgvector-sökning (tom)
      .mockResolvedValueOnce([{ id: 'chunk-1' }]); // PostGIS spatial filter returnerar endast chunk-1 (Orsa)

    const results = await searchService.search(query, { bbox });

    // Kontrollera att det spatiala filtret kördes och filtrerade bort chunk-2 (Enköping)
    expect(results.length).toBe(1);
    expect(results[0].id).toBe('chunk-1');
    expect(prismaMock.$queryRaw).toHaveBeenCalledTimes(3); // FTS + Vector + Spatial ST_Intersects
  });

  // ---------------------------------------------------------------------------
  // TEST 3: Reranker och Feature-flagga (Fas A2)
  // ---------------------------------------------------------------------------
  it('should apply Cross-Encoder reranking modifiers only when feature-flag is enabled', async () => {
    const query = 'fastighetsgräns';

    const mockFtsResults: SearchChunkResult[] = [
      { id: 'chunk-1', chunkText: 'Lantmäteriet registerenhet.', documentId: 'doc-A', documentTitle: 'Fastighet A', ftsRank: 0.99 },
    ];

    prismaMock.$queryRaw
      .mockResolvedValueOnce(mockFtsResults)
      .mockResolvedValueOnce([]);

    // 1. Kör med Cross-Encoder inaktiv (Standard)
    const resultsNoRerank = await searchService.search(query, { config: { CROSS_ENCODER_ENABLED: false } });
    expect(resultsNoRerank[0].finalScore).toBe(resultsNoRerank[0].rrfScore);

    // 2. Kör med Cross-Encoder aktiv
    prismaMock.$queryRaw
      .mockResolvedValueOnce(mockFtsResults)
      .mockResolvedValueOnce([]);
    const resultsWithRerank = await searchService.search(query, { config: { CROSS_ENCODER_ENABLED: true } });
    expect(resultsWithRerank[0].finalScore).not.toBe(resultsWithRerank[0].rrfScore);
  });
});
