import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockEmbedText, mockQueryTopSemanticChunks, mockSearchGraph, mockGenerateContent } = vi.hoisted(
  () => ({
    mockEmbedText: vi.fn(),
    mockQueryTopSemanticChunks: vi.fn(),
    mockSearchGraph: vi.fn(),
    mockGenerateContent: vi.fn(),
  }),
);

// Mock internal services
vi.mock('../../server/services/searchService', () => ({
  embedText: mockEmbedText,
}));

vi.mock('../../server/repositories/searchRepository', () => ({
  queryTopSemanticChunks: mockQueryTopSemanticChunks,
}));

vi.mock('../../server/services/knowledgeGraphService', () => ({
  searchGraph: mockSearchGraph,
}));

// Mock @google/genai for dynamic import
vi.mock('@google/genai', () => {
  class MockGenAI {
    models = {
      generateContent: mockGenerateContent,
    };
  }
  return {
    __esModule: true,
    GoogleGenAI: MockGenAI,
  };
});

import { runRagSearch } from '../../server/services/ragSearchService';

describe('ragSearchService', () => {
  const defaultParams = {
    query: 'test query',
    organisationId: 'o123',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GEMINI_API_KEY = 'fake-key';
  });

  it('returns a generated answer when all searches succeed', async () => {
    mockEmbedText.mockResolvedValue({ values: [0.1], model: 'test-model' });
    mockQueryTopSemanticChunks.mockResolvedValue([
      { documentId: 'd1', chunkIndex: 0, chunkText: 'Semantic info', similarity: 0.9 },
    ]);
    mockSearchGraph.mockResolvedValue({
      nodes: [{ id: 'n1', nodeType: 'Type', name: 'Graph node' }],
      edges: [],
    });
    mockGenerateContent.mockImplementation(async () => ({
      text: 'Final RAG answer',
    }));

    const result = await runRagSearch(defaultParams);
    expect(result.answer).toBe('Final RAG answer');
    expect(result.sources).toHaveLength(1);
  });

  it('handles search failures and still attempts generation', async () => {
    mockEmbedText.mockRejectedValue(new Error('Embed error'));
    mockSearchGraph.mockResolvedValue({
      nodes: [{ id: 'n1', nodeType: 'Type', name: 'Graph node' }],
      edges: [],
    });
    mockGenerateContent.mockImplementation(async () => ({
      text: 'Fallback answer',
    }));

    const result = await runRagSearch(defaultParams);
    expect(result.answer).toBe('Fallback answer');
  });

  it('returns empty answer when AI fails', async () => {
    mockEmbedText.mockResolvedValue({ values: [0.1] });
    mockQueryTopSemanticChunks.mockResolvedValue([]);
    mockSearchGraph.mockResolvedValue({ nodes: [] });
    mockGenerateContent.mockImplementation(async () => {
      throw new Error('AI error');
    });

    const result = await runRagSearch(defaultParams);
    // If AI fails, it triggers the fallback logic in the service (line 148)
    // Since both searches returned nothing, it returns the global failure message.
    expect(result.answer).toContain('Inga relevanta dokument hittades');
  });
});
