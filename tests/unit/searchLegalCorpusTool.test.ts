import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  queryRawUnsafe: vi.fn(),
  embedText: vi.fn(),
  parseLegalReference: vi.fn(),
}));

vi.mock('../../server/db/prisma', () => ({
  prisma: {
    $queryRawUnsafe: mocks.queryRawUnsafe,
  },
}));

vi.mock('../../server/services/searchService', () => ({
  embedText: mocks.embedText,
}));

vi.mock('../../server/modules/legal/services/legalReferenceParser', () => ({
  parseLegalReference: mocks.parseLegalReference,
}));

import {
  resetLegalCorpusVectorColumnCache,
  searchLegalCorpusHandler,
} from '../../server/modules/ai/orchestrator/tools/searchLegalCorpusTool';

describe('searchLegalCorpusTool — Alphaevolve A1', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetLegalCorpusVectorColumnCache();
    mocks.parseLegalReference.mockReturnValue(null);
    mocks.embedText.mockResolvedValue({
      values: [0.1, 0.2, 0.3],
      model: 'text-multilingual-embedding-002',
    });
  });

  it('returnerar fel om query är för kort', async () => {
    const result = await searchLegalCorpusHandler({ query: 'a' });
    expect(result).toEqual({ error: 'Söksträngen är för kort.' });
    expect(mocks.queryRawUnsafe).not.toHaveBeenCalled();
  });

  it('söker vector mot legal_corpus_chunks (inte records) och fusar på chunk-id', async () => {
    mocks.queryRawUnsafe
      // Exact arm (ingen lagrum-träff → parseLegalReference null → empty, but runExactArm still not calling if null - wait, exact returns [] without SQL when no ref)
      // Actually runExactArm with null ref returns [] without query.
      // Then Promise.all: Exact=[], FTS query, Vector column check, Vector search, then record details
      .mockResolvedValueOnce([
        {
          chunk_id: 'chunk-fts-1',
          record_id: 'rec-1',
          chunk_text: 'FTS: fosforrening i enskilt avlopp.',
          chapter: '2',
          paragraph: '6',
          section: null,
          rank: 0.9,
        },
      ])
      .mockResolvedValueOnce([{ column_name: 'embedding_vector' }])
      .mockResolvedValueOnce([
        {
          chunk_id: 'chunk-vec-1',
          record_id: 'rec-2',
          chunk_text: 'Vektor: krav på fosforavskiljning.',
          chapter: null,
          paragraph: null,
          section: null,
          similarity: 0.88,
        },
        {
          chunk_id: 'chunk-fts-1',
          record_id: 'rec-1',
          chunk_text: 'FTS: fosforrening i enskilt avlopp.',
          chapter: '2',
          paragraph: '6',
          section: null,
          similarity: 0.7,
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 'rec-1',
          title: 'Dom A',
          case_number: 'M 1-22',
          published_at: null,
          decision_date: null,
          authority_name: 'MMD',
          legal_area: 'avlopp',
          metadata: {},
          source_url: null,
          source_path: '/a',
        },
        {
          id: 'rec-2',
          title: 'Dom B',
          case_number: 'M 2-22',
          published_at: null,
          decision_date: null,
          authority_name: 'MMD',
          legal_area: 'avlopp',
          metadata: {},
          source_url: null,
          source_path: '/b',
        },
      ]);

    const result = await searchLegalCorpusHandler({ query: 'fosforrening' });

    expect(result).not.toHaveProperty('error');
    expect(Array.isArray((result as { results: unknown[] }).results)).toBe(true);

    const sqlCalls = mocks.queryRawUnsafe.mock.calls.map((call) => String(call[0]));
    expect(sqlCalls.some((sql) => sql.includes('legal_corpus_chunks') && sql.includes('<=>'))).toBe(true);
    expect(sqlCalls.some((sql) => /FROM\s+legal_corpus_records[\s\S]*<=>/i.test(sql))).toBe(false);

    const results = (result as {
      results: Array<{ chunkId: string; snippet: string; score: number }>;
    }).results;

    expect(results.length).toBeGreaterThanOrEqual(2);
    expect(results.every((r) => typeof r.chunkId === 'string')).toBe(true);
    expect(results.every((r) => typeof r.snippet === 'string' && r.snippet.length > 0)).toBe(true);

    // Chunk som träffas av både FTS och vector ska få högre RRF än vector-only.
    const both = results.find((r) => r.chunkId === 'chunk-fts-1');
    const vectorOnly = results.find((r) => r.chunkId === 'chunk-vec-1');
    expect(both).toBeDefined();
    expect(vectorOnly).toBeDefined();
    expect(both!.score).toBeGreaterThan(vectorOnly!.score);
  });

  it('kör Exact + FTS + Vector parallellt och returnerar upp till 30 chunks', async () => {
    mocks.parseLegalReference.mockReturnValue({
      lawName: 'Miljöbalken',
      chapter: '2',
      paragraph: '6',
    });

    const manyVector = Array.from({ length: 40 }, (_, i) => ({
      chunk_id: `chunk-v-${i}`,
      record_id: `rec-v-${i}`,
      chunk_text: `Vektorchunk ${i}`,
      chapter: null,
      paragraph: null,
      section: null,
      similarity: 1 - i * 0.01,
    }));

    let call = 0;
    mocks.queryRawUnsafe.mockImplementation(async (sql: string, ...params: unknown[]) => {
      const text = String(sql);
      call += 1;
      if (text.includes('information_schema.columns')) {
        return [{ column_name: 'embedding_vector' }];
      }
      if (text.includes('c.chapter = $1') && text.includes('c.paragraph = $2')) {
        return [
          {
            chunk_id: 'chunk-exact-1',
            record_id: 'rec-exact',
            chunk_text: '2 kap. 6 § MB',
            chapter: '2',
            paragraph: '6',
            section: null,
          },
        ];
      }
      if (text.includes('websearch_to_tsquery')) {
        return [];
      }
      if (text.includes('<=>')) {
        return manyVector;
      }
      if (text.includes('WHERE id IN')) {
        return params.map((id) => ({
          id,
          title: `Title ${id}`,
          case_number: null,
          published_at: null,
          decision_date: null,
          authority_name: null,
          legal_area: null,
          metadata: {},
          source_url: null,
          source_path: null,
        }));
      }
      return [];
    });

    const result = await searchLegalCorpusHandler({ query: '2 kap. 6 § miljöbalken' });
    const results = (result as { results: unknown[]; meta?: { topK: number } }).results;

    expect(results.length).toBe(30);
    expect((result as { meta: { topK: number } }).meta.topK).toBe(30);
    expect(call).toBeGreaterThanOrEqual(4);
  });

  it('använder chunk_text som snippet (grounding), inte hela dokumentet', async () => {
    mocks.queryRawUnsafe.mockImplementation(async (sql: string) => {
      const text = String(sql);
      if (text.includes('information_schema.columns')) {
        return [{ column_name: 'embedding_vector' }];
      }
      if (text.includes('websearch_to_tsquery')) {
        return [
          {
            chunk_id: 'chunk-1',
            record_id: 'rec-1',
            chunk_text: 'Endast denna chunk ska visas.',
            chapter: null,
            paragraph: null,
            section: null,
            rank: 1,
          },
        ];
      }
      if (text.includes('<=>')) {
        return [];
      }
      if (text.includes('WHERE id IN')) {
        return [
          {
            id: 'rec-1',
            title: 'Långt dokument',
            case_number: 'M 1',
            published_at: null,
            decision_date: null,
            authority_name: 'MMD',
            legal_area: null,
            metadata: { lagrumLista: ['MB 2:6'] },
            source_url: null,
            source_path: '/x',
          },
        ];
      }
      return [];
    });

    const result = await searchLegalCorpusHandler({ query: 'fosfor' });
    const row = (result as { results: Array<{ snippet: string; chunkText: string }> }).results[0];
    expect(row.snippet).toBe('Endast denna chunk ska visas.');
    expect(row.chunkText).toBe('Endast denna chunk ska visas.');
  });
});
