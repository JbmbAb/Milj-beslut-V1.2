/**
 * searchServiceCoreLogic.test.ts
 *
 * Täcker kärnlogiken för:
 *  - cosineSimilarity (vektorjämförelse)
 *  - encryptContent (AES-256-GCM)
 *  - embedText – timeout, alla modeller misslyckas, dimension-trimning
 *  - extractDocumentTextAndChunk – text-chunkning pipeline
 *  - embedDocumentChunks – inbäddning av chunks, partiell framgång
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const embedTextWithVertexPredictMock = vi.hoisted(() => vi.fn());
vi.mock('../../server/services/vertexEmbeddingService', () => ({
  embedTextWithVertexPredict: embedTextWithVertexPredictMock,
}));

// ── Hoisted mock factories ────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  enqueueSearchJob: vi.fn(),
  findDocumentByDiskName: vi.fn(),
  findDocumentsForProject: vi.fn(),
  getDocumentById: vi.fn(),
  listChunksForDocument: vi.fn(),
  listChunksForProject: vi.fn(),
  logSearchQuery: vi.fn(),
  queryTopSemanticChunks: vi.fn(),
  replaceDocumentChunks: vi.fn(),
  setChunkEmbeddingJson: vi.fn(),
  setDocumentStatus: vi.fn(),
  updateChunkVector: vi.fn(),
  upsertDocumentContent: vi.fn(),
  upsertDocumentFromManifest: vi.fn(),
  readFile: vi.fn(),
  stat: vi.fn(),
  loggerWarn: vi.fn(),
  loggerInfo: vi.fn(),
  prismaQueryRaw: vi.fn(),
}));

vi.mock('../../server/repositories/searchRepository', () => ({
  enqueueSearchJob: mocks.enqueueSearchJob,
  findDocumentByDiskName: mocks.findDocumentByDiskName,
  findDocumentsForProject: mocks.findDocumentsForProject,
  getDocumentById: mocks.getDocumentById,
  listChunksForDocument: mocks.listChunksForDocument,
  listChunksForProject: mocks.listChunksForProject,
  logSearchQuery: mocks.logSearchQuery,
  queryTopSemanticChunks: mocks.queryTopSemanticChunks,
  replaceDocumentChunks: mocks.replaceDocumentChunks,
  setChunkEmbeddingJson: mocks.setChunkEmbeddingJson,
  setDocumentStatus: mocks.setDocumentStatus,
  updateChunkVector: mocks.updateChunkVector,
  upsertDocumentContent: mocks.upsertDocumentContent,
  upsertDocumentFromManifest: mocks.upsertDocumentFromManifest,
}));

vi.mock('node:fs', () => ({
  promises: { readFile: mocks.readFile, stat: mocks.stat },
  default: { promises: { readFile: mocks.readFile, stat: mocks.stat } },
}));

vi.mock('../../server/logger', () => ({
  logger: { warn: mocks.loggerWarn, info: mocks.loggerInfo },
}));

vi.mock('../../server/db/prisma', () => ({
  prisma: { $queryRaw: mocks.prismaQueryRaw },
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

const originalFetch = global.fetch;

async function loadService() {
  const mod = await import('../../server/services/searchService');
  return mod;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('searchService – kärnlogik', { timeout: 10000 }, () => {
  const savedEnv: Record<string, string | undefined> = {};
  const ENV_KEYS = [
    'VERTEX_PROJECT_ID',
    'EMBEDDING_MODEL',
    'EMBEDDING_FALLBACK_MODELS',
    'EMBEDDING_DIM',
    'EMBEDDING_TIMEOUT_MS',
    'SEARCH_ENCRYPTION_KEY_BASE64',
    'JWT_ACCESS_SECRET',
  ];

  beforeEach(() => {
    vi.resetAllMocks();
    vi.resetModules();
    ENV_KEYS.forEach((k) => {
      savedEnv[k] = process.env[k];
      delete process.env[k];
    });
    process.env.EMBEDDING_MODEL = 'gemini-embedding-001';
    process.env.EMBEDDING_FALLBACK_MODELS = 'gemini-embedding-001,text-embedding-004';
    embedTextWithVertexPredictMock.mockReset();

    mocks.enqueueSearchJob.mockResolvedValue({ id: 'job-1' });
    mocks.replaceDocumentChunks.mockResolvedValue(undefined);
    mocks.upsertDocumentContent.mockResolvedValue(undefined);
    mocks.setDocumentStatus.mockResolvedValue(undefined);
    mocks.listChunksForDocument.mockResolvedValue([]);
    mocks.updateChunkVector.mockResolvedValue(undefined);
    mocks.setChunkEmbeddingJson.mockResolvedValue(undefined);

    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    ENV_KEYS.forEach((k) => {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    });
  });

  // ── cosineSimilarity ────────────────────────────────────────────────────────

  describe('cosineSimilarity', () => {
    it('returnerar 1.0 för identiska vektorer', async () => {
      const { cosineSimilarity } = await loadService();
      expect(cosineSimilarity([1, 0, 0], [1, 0, 0])).toBeCloseTo(1.0);
    });

    it('returnerar 0.0 för ortogonala vektorer', async () => {
      const { cosineSimilarity } = await loadService();
      expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0.0);
    });

    it('returnerar 0.0 för tom vektor', async () => {
      const { cosineSimilarity } = await loadService();
      expect(cosineSimilarity([], [1, 2])).toBe(0);
      expect(cosineSimilarity([1, 2], [])).toBe(0);
    });

    it('returnerar 0.0 för vektorer av olika längd', async () => {
      const { cosineSimilarity } = await loadService();
      expect(cosineSimilarity([1, 2, 3], [1, 2])).toBe(0);
    });

    it('hanterar nollvektor', async () => {
      const { cosineSimilarity } = await loadService();
      expect(cosineSimilarity([0, 0, 0], [1, 2, 3])).toBe(0);
    });

    it('returnerar korrekt likhet för kända vektorer', async () => {
      const { cosineSimilarity } = await loadService();
      // [1,1] vs [1,0] = cos(45°) ≈ 0.707
      expect(cosineSimilarity([1, 1], [1, 0])).toBeCloseTo(0.707, 2);
    });
  });

  // ── encryptContent ──────────────────────────────────────────────────────────

  describe('encryptContent', () => {
    it('returnerar krypteringsresultat med ciphertext, iv, tag och keyVersion', async () => {
      const { encryptContent } = await loadService();
      const result = encryptContent('Miljöbalken 2 kap: aktsamhetskrav');
      expect(result).toMatchObject({
        keyVersion: 1,
        ciphertext: expect.any(String),
        iv: expect.any(String),
        tag: expect.any(String),
      });
    });

    it('producerar unika iv vid varje anrop (AES-GCM kräver unik nonce)', async () => {
      const { encryptContent } = await loadService();
      const r1 = encryptContent('text');
      const r2 = encryptContent('text');
      // Iv ska vara slumpmässig – extremt osannolikt att de är lika
      expect(r1.iv).not.toBe(r2.iv);
    });

    it('producerar olika ciphertext för olika plaintext', async () => {
      const { encryptContent } = await loadService();
      const a = encryptContent('Stockholms kommun beslut 2026');
      const b = encryptContent('Göteborgs stad beslut 2025');
      expect(a.ciphertext).not.toBe(b.ciphertext);
    });

    it('använder anpassad nyckel från SEARCH_ENCRYPTION_KEY_BASE64', async () => {
      const key32 = Buffer.alloc(32, 0xab);
      process.env.SEARCH_ENCRYPTION_KEY_BASE64 = key32.toString('base64');
      const { encryptContent } = await loadService();
      const result = encryptContent('test');
      expect(result.keyVersion).toBe(1);
      expect(result.ciphertext).toBeTruthy();
    });

    it('faller tillbaka på JWT_ACCESS_SECRET när ingen explicit nyckel finns', async () => {
      process.env.JWT_ACCESS_SECRET = 'hemlig-jwt-nyckel';
      const { encryptContent } = await loadService();
      const result = encryptContent('Avfall från industri i Gävle');
      expect(result.ciphertext).toBeTruthy();
    });
  });

  // ── embedText – felscenarier ────────────────────────────────────────────────

  describe('embedText – API-fel', () => {
    it('returnerar null när VERTEX_PROJECT_ID saknas', async () => {
      const { embedText } = await loadService();
      expect(await embedText('Naturreservat Dalarna')).toBeNull();
    });

    it('returnerar null när Vertex predict inte ger vektor', async () => {
      process.env.VERTEX_PROJECT_ID = 'test-proj';
      embedTextWithVertexPredictMock.mockResolvedValue(null);
      const { embedText } = await loadService();
      expect(await embedText('SWEREF99 koordinater')).toBeNull();
    });

    it('returnerar null när predict kastar nätverksfel', async () => {
      process.env.VERTEX_PROJECT_ID = 'test-proj';
      embedTextWithVertexPredictMock.mockRejectedValue(new Error('Network error'));
      const { embedText } = await loadService();
      expect(await embedText('Miljöbedömning')).toBeNull();
    });

    it('trimmar embedding till konfigurerad dimension', async () => {
      process.env.VERTEX_PROJECT_ID = 'test-proj';
      // Effective dim = Math.max(64, 65) = 65; mock returns 70 values → trimmed to 65.
      process.env.EMBEDDING_DIM = '65';
      const mockValues = Array.from({ length: 70 }, (_, i) => i * 0.01);
      embedTextWithVertexPredictMock.mockResolvedValue({ values: mockValues, model: 'm' });
      const { embedText } = await loadService();
      const result = await embedText('test');
      expect(result?.values).toHaveLength(65);
    });

    it('returnerar null när predict inte levererar vektor', async () => {
      process.env.VERTEX_PROJECT_ID = 'test-proj';
      embedTextWithVertexPredictMock.mockResolvedValue(null);
      const { embedText } = await loadService();
      expect(await embedText('test')).toBeNull();
    });
  });

  // ── extractDocumentTextAndChunk ─────────────────────────────────────────────

  describe('extractDocumentTextAndChunk', () => {
    it('kastar fel om dokumentet inte finns', async () => {
      mocks.getDocumentById.mockResolvedValue(null);
      const { extractDocumentTextAndChunk } = await loadService();
      await expect(extractDocumentTextAndChunk('nonexistent-id')).rejects.toThrow(
        'Document not found: nonexistent-id',
      );
    });

    it('delar upp text i chunks och köar EMBED_DOC-jobb', async () => {
      const longText = Array.from({ length: 500 }, (_, i) => `ord${i}`).join(' ');
      mocks.getDocumentById.mockResolvedValue({
        id: 'doc-1',
        absolutePath: '/data/test.txt',
        originalName: 'test.txt',
        diskName: 'test.txt',
        projectId: 'proj-1',
      });
      mocks.readFile.mockResolvedValue(Buffer.from(longText, 'utf8'));

      const { extractDocumentTextAndChunk } = await loadService();
      const result = await extractDocumentTextAndChunk('doc-1');

      // 500 ord / 180 per chunk med 40 ords överlapp → fler än 1 chunk
      expect(result.chunks).toBeGreaterThan(1);
      expect(mocks.upsertDocumentContent).toHaveBeenCalledWith(
        expect.objectContaining({ documentId: 'doc-1' }),
      );
      expect(mocks.replaceDocumentChunks).toHaveBeenCalledWith(
        expect.objectContaining({ documentId: 'doc-1' }),
      );
      expect(mocks.setDocumentStatus).toHaveBeenCalledWith('doc-1', 'TEXT_EXTRACTED');
      expect(mocks.enqueueSearchJob).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'EMBED_DOC', projectId: 'proj-1' }),
      );
    });

    it('skapar en chunk för tomt dokument', async () => {
      mocks.getDocumentById.mockResolvedValue({
        id: 'doc-empty',
        absolutePath: '/data/empty.txt',
        originalName: 'empty.txt',
        diskName: 'empty.txt',
        projectId: 'proj-1',
      });
      mocks.readFile.mockResolvedValue(Buffer.from('', 'utf8'));

      const { extractDocumentTextAndChunk } = await loadService();
      const result = await extractDocumentTextAndChunk('doc-empty');
      expect(result.chunks).toBe(1);
    });
  });

  // ── embedDocumentChunks ─────────────────────────────────────────────────────

  describe('embedDocumentChunks', () => {
    it('kastar fel om dokumentet inte finns', async () => {
      mocks.getDocumentById.mockResolvedValue(null);
      const { embedDocumentChunks } = await loadService();
      await expect(embedDocumentChunks('missing-doc')).rejects.toThrow('Document not found: missing-doc');
    });

    it('sätter status TEXT_EXTRACTED om inga chunks kan inbäddas', async () => {
      mocks.getDocumentById.mockResolvedValue({ id: 'doc-2', projectId: 'proj-1' });
      mocks.listChunksForDocument.mockResolvedValue([{ id: 'chunk-1', chunkText: 'text', chunkIndex: 0 }]);
      delete process.env.VERTEX_PROJECT_ID;

      const { embedDocumentChunks } = await loadService();
      const result = await embedDocumentChunks('doc-2');

      expect(result.embeddedChunks).toBe(0);
      expect(mocks.setDocumentStatus).toHaveBeenCalledWith('doc-2', 'TEXT_EXTRACTED');
    });

    it('inbäddar alla chunks och sätter status EMBEDDED vid framgång', async () => {
      process.env.VERTEX_PROJECT_ID = 'test-proj';
      embedTextWithVertexPredictMock.mockResolvedValue({ values: [0.1, 0.2, 0.3], model: 'm' });
      mocks.getDocumentById.mockResolvedValue({ id: 'doc-3', projectId: 'proj-1' });
      mocks.listChunksForDocument.mockResolvedValue([
        { id: 'c1', chunkText: 'Miljöbalkens regler', chunkIndex: 0 },
        { id: 'c2', chunkText: 'Tillståndsansökan Gävle', chunkIndex: 1 },
      ]);

      const { embedDocumentChunks } = await loadService();
      const result = await embedDocumentChunks('doc-3');

      expect(result.embeddedChunks).toBe(2);
      expect(mocks.setDocumentStatus).toHaveBeenCalledWith('doc-3', 'EMBEDDED');
      expect(mocks.updateChunkVector).toHaveBeenCalledTimes(2);
      expect(mocks.setChunkEmbeddingJson).toHaveBeenCalledTimes(2);
    });

    it('räknar partiell inbäddning rätt när första chunken misslyckas', async () => {
      process.env.VERTEX_PROJECT_ID = 'test-proj';
      embedTextWithVertexPredictMock
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ values: [0.5], model: 'm' });
      mocks.getDocumentById.mockResolvedValue({ id: 'doc-4', projectId: 'proj-1' });
      mocks.listChunksForDocument.mockResolvedValue([
        { id: 'c1', chunkText: 'chunk-1', chunkIndex: 0 },
        { id: 'c2', chunkText: 'chunk-2', chunkIndex: 1 },
      ]);

      const { embedDocumentChunks } = await loadService();
      const result = await embedDocumentChunks('doc-4');

      expect(result.embeddedChunks).toBe(1);
      expect(mocks.setDocumentStatus).toHaveBeenCalledWith('doc-4', 'EMBEDDED');
    });
  });
});
