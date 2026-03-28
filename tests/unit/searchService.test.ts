import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
  promises: {
    readFile: mocks.readFile,
    stat: mocks.stat,
  },
  // Vite/Vitest sometimes accesses node:fs via a default export interop wrapper.
  default: {
    promises: {
      readFile: mocks.readFile,
      stat: mocks.stat,
    },
  },
}));

vi.mock('../../server/logger', () => ({
  logger: {
    warn: mocks.loggerWarn,
    info: mocks.loggerInfo,
  },
}));

vi.mock('../../server/db/prisma', () => ({
  prisma: {
    $queryRaw: mocks.prismaQueryRaw,
  },
}));

describe('searchService', () => {
  const originalEnv = {
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    OUTLOOK_MANIFEST_PATH: process.env.OUTLOOK_MANIFEST_PATH,
    OUTLOOK_BASE_DIR: process.env.OUTLOOK_BASE_DIR,
    LOCAL_DB_ROOT: process.env.LOCAL_DB_ROOT,
    EMBEDDING_MODEL: process.env.EMBEDDING_MODEL,
    EMBEDDING_FALLBACK_MODELS: process.env.EMBEDDING_FALLBACK_MODELS,
    SEARCH_DRAFT_WATERMARK: process.env.SEARCH_DRAFT_WATERMARK,
  };
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.resetAllMocks();
    vi.resetModules();

    process.env.EMBEDDING_MODEL = 'gemini-embedding-001';
    process.env.EMBEDDING_FALLBACK_MODELS = 'gemini-embedding-001,text-embedding-004';
    delete process.env.GEMINI_API_KEY;
    delete process.env.OUTLOOK_MANIFEST_PATH;
    delete process.env.OUTLOOK_BASE_DIR;
    delete process.env.LOCAL_DB_ROOT;
    delete process.env.SEARCH_DRAFT_WATERMARK;

    mocks.enqueueSearchJob.mockResolvedValue({ id: 'job-1' });
    mocks.findDocumentByDiskName.mockResolvedValue(null);
    mocks.findDocumentsForProject.mockResolvedValue([]);
    mocks.queryTopSemanticChunks.mockResolvedValue([]);
    mocks.listChunksForProject.mockResolvedValue([]);
    mocks.logSearchQuery.mockResolvedValue(undefined);
    mocks.upsertDocumentFromManifest.mockResolvedValue({ id: 'doc-1' });
    mocks.readFile.mockResolvedValue(Buffer.from(''));
    mocks.stat.mockResolvedValue({ size: 12, mtimeMs: 1000 });
    mocks.prismaQueryRaw.mockResolvedValue([]);

    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;

    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        delete process.env[key as keyof typeof originalEnv];
      } else {
        process.env[key as keyof typeof originalEnv] = value;
      }
    }
  });

  async function loadModule() {
    return import('../../server/services/searchService');
  }

  it('reads search config from environment variables', async () => {
    process.env.OUTLOOK_BASE_DIR = 'C:/outlook';
    process.env.OUTLOOK_MANIFEST_PATH = 'C:/outlook/manifest.csv';
    process.env.LOCAL_DB_ROOT = 'C:/db';

    const service = await loadModule();
    expect(service.getSearchConfig()).toEqual({
      outlookBaseDir: 'C:/outlook',
      manifestPath: 'C:/outlook/manifest.csv',
      localDbRoot: 'C:/db',
      embeddingModel: 'gemini-embedding-001',
      embeddingDim: 768,
    });
  });

  it('returns null without an API key and uses fallback embedding models on success', async () => {
    const serviceWithoutKey = await loadModule();
    expect(await serviceWithoutKey.embedText('hej')).toBeNull();

    vi.resetModules();
    process.env.GEMINI_API_KEY = 'secret-key';
    const service = await loadModule();

    vi.mocked(global.fetch)
      .mockResolvedValueOnce({ ok: false } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          embedding: {
            values: [1, 2, 3, 4],
          },
        }),
      } as Response);

    const result = await service.embedText('text to embed');

    expect(result).toEqual({
      values: [1, 2, 3, 4],
      model: 'text-embedding-004',
    });
    expect(mocks.loggerWarn).toHaveBeenCalledWith('search: embedding fallback active', {
      fallbackModel: 'text-embedding-004',
      primaryModel: 'gemini-embedding-001',
    });
  });

  it('handles manifest CSV with alternative column names for municipality and waste', async () => {
    const csv = [
      'DiskName;RelativePath;Subject;EntryID;ReceivedTime;kommun;DecisionType;avfallstyp;Status;Farligt;OriginalName;Sha256',
      'd2.pdf;p2.pdf;Sub;e2;2026;Orsa;Tillstånd;Asbest;Aktiv;ja;o2.pdf;h2',
    ].join('\n');
    mocks.readFile.mockResolvedValueOnce(Buffer.from(csv, 'utf8'));

    const service = await loadModule();
    await service.syncManifestMetadata({
      projectId: 'p2',
      organisationId: 'o2',
      manifestPath: 'm.csv',
      outlookBaseDir: 'd',
    });

    expect(mocks.upsertDocumentFromManifest).toHaveBeenCalledWith(
      expect.objectContaining({
        municipality: 'Orsa',
        wasteType: 'Asbest',
        hazardousFlag: true,
      }),
    );
  });

  it('syncs manifest rows, skips invalid entries and preserves unchanged documents', async () => {
    const csv = [
      'DiskName;RelativePath;Subject;EntryID;ReceivedTime;Municipality;DecisionType;WasteType;LegalStatus;Hazardous;OriginalName;Sha256',
      ';ignored.pdf;Saknas;;;Orsa;Tillstånd;Schaktmassor;Aktiv;ja;ignored.pdf;hash-ignored',
      'doc-1.pdf;attachments/doc-1.pdf;Titel;entry-1;2026-01-02;Orsa;Tillstånd;Schaktmassor;Aktiv;ja;original.pdf;hash-1',
    ].join('\n');
    const utf16Buffer = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(csv, 'utf16le')]);
    mocks.readFile.mockResolvedValueOnce(utf16Buffer);
    mocks.findDocumentByDiskName.mockResolvedValueOnce(null);

    const service = await loadModule();
    const result = await service.syncManifestMetadata({
      projectId: 'project-1',
      organisationId: 'org-1',
      manifestPath: 'C:/outlook/manifest.csv',
      outlookBaseDir: 'C:/outlook',
    });

    expect(result).toEqual({
      processedRows: 1,
      queuedExtractionJobs: 1,
      skippedRows: 1,
    });
    expect(mocks.upsertDocumentFromManifest).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 'project-1',
        organisationId: 'org-1',
        diskName: 'doc-1.pdf',
        absolutePath: path.resolve('C:/outlook', 'attachments/doc-1.pdf'),
        municipality: 'Orsa',
        decisionType: 'Tillstånd',
        wasteType: 'Schaktmassor',
        legalStatus: 'Aktiv',
        hazardousFlag: true,
        originalName: 'original.pdf',
        preserveStatusOnUpdate: false,
      }),
    );
    expect(mocks.enqueueSearchJob).toHaveBeenCalledWith({
      type: 'EXTRACT_TEXT',
      projectId: 'project-1',
      payload: { documentId: 'doc-1' },
    });

    vi.resetAllMocks();
    vi.resetModules();
    mocks.readFile.mockResolvedValueOnce(Buffer.from(csv, 'utf8'));
    mocks.stat.mockResolvedValueOnce({ size: 12, mtimeMs: 1000 });
    mocks.findDocumentByDiskName.mockResolvedValueOnce({
      absolutePath: path.resolve('C:/outlook', 'attachments/doc-1.pdf'),
      fileSha256: 'hash-1',
      fileSize: BigInt(12),
      content: { searchText: 'normal text' },
    });
    mocks.upsertDocumentFromManifest.mockResolvedValueOnce({ id: 'doc-1' });
    mocks.enqueueSearchJob.mockResolvedValueOnce({ id: 'job-2' });

    const unchangedService = await loadModule();
    const unchanged = await unchangedService.syncManifestMetadata({
      projectId: 'project-1',
      organisationId: 'org-1',
      manifestPath: 'C:/outlook/manifest.csv',
      outlookBaseDir: 'C:/outlook',
    });

    expect(unchanged).toEqual({
      processedRows: 1,
      queuedExtractionJobs: 0,
      skippedRows: 1,
    });
    expect(mocks.upsertDocumentFromManifest).toHaveBeenCalledWith(
      expect.objectContaining({
        preserveStatusOnUpdate: true,
      }),
    );
    expect(mocks.enqueueSearchJob).not.toHaveBeenCalled();
  });

  it('runs lexical project searches with citations and logs project queries', async () => {
    process.env.SEARCH_DRAFT_WATERMARK = 'TEST-WATERMARK';

    mocks.findDocumentsForProject.mockResolvedValueOnce([
      {
        id: 'doc-1',
        subject: 'Vattenprov för Orsa',
        originalName: 'vattenprov.pdf',
        receivedTime: new Date('2026-01-02T00:00:00.000Z'),
        municipality: 'Orsa',
        decisionType: 'Tillstånd',
        wasteType: 'Schaktmassor',
        hazardousFlag: false,
        legalStatus: 'Aktiv',
        status: 'TEXT_EXTRACTED',
        content: {
          searchText: 'Det här dokumentet beskriver vattenprov i Orsa och halter i mark.',
        },
        project: {
          id: 'project-1',
          propertyDesignation: 'Orsa 1:1',
          organisation: { name: 'Org 1' },
        },
      },
    ]);

    const service = await loadModule();
    const result = await service.runSearchQuery({
      projectId: 'project-1',
      organisationId: 'org-1',
      userId: 'user-1',
      query: 'vattenprov',
      mode: 'lexical',
      topK: 5,
      strictEvidence: true,
      filters: {
        municipality: 'Orsa',
      },
    });

    expect(result.mode).toBe('lexical');
    expect(result.scope).toBe('project');
    expect(result.totalCandidates).toBe(1);
    expect(result.guardrails).toEqual(
      expect.objectContaining({
        strictEvidence: true,
        semanticEngine: 'disabled',
        draftWatermark: 'TEST-WATERMARK',
      }),
    );
    expect(result.results[0]?.citations.length).toBeGreaterThan(0);
    expect(mocks.logSearchQuery).toHaveBeenCalledWith({
      userId: 'user-1',
      projectId: 'project-1',
      query: 'vattenprov',
      mode: 'lexical',
      topK: 5,
      resultCount: 1,
      elapsedMs: expect.any(Number),
    });
  });

  it('uses JSON semantic fallback for hybrid searches when pgvector returns no rows', async () => {
    process.env.GEMINI_API_KEY = 'secret-key';
    mocks.findDocumentsForProject.mockResolvedValueOnce([
      {
        id: 'doc-1',
        subject: 'Grundvattenutredning',
        originalName: 'grundvatten.pdf',
        receivedTime: new Date('2026-01-03T00:00:00.000Z'),
        municipality: 'Orsa',
        decisionType: 'Tillstånd',
        wasteType: 'Jord',
        hazardousFlag: null,
        legalStatus: 'Aktiv',
        status: 'EMBEDDED',
        content: {
          searchText: 'Grundvatten och magasin beskrivs i detalj.',
        },
        project: {
          id: 'project-1',
          propertyDesignation: 'Orsa 2:2',
          organisation: { name: 'Org 1' },
        },
      },
    ]);
    mocks.queryTopSemanticChunks.mockResolvedValueOnce([]);
    mocks.listChunksForProject.mockResolvedValueOnce([
      {
        documentId: 'doc-1',
        chunkIndex: 0,
        chunkText: 'Grundvatten och magasin beskrivs i detalj.',
        embeddingJson: [1, 0],
      },
    ]);
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        embedding: {
          values: [1, 0],
        },
      }),
    } as Response);

    const service = await loadModule();
    const result = await service.runSearchQuery({
      projectId: 'project-1',
      organisationId: 'org-1',
      userId: 'user-1',
      query: 'grundvatten',
      mode: 'hybrid',
      topK: 5,
      strictEvidence: true,
    });

    expect(result.guardrails.semanticEngine).toBe('json-fallback');
    expect(result.results).toHaveLength(1);
    expect(result.results[0]?.whyMatched).toContain('Hybrid semantic+lexical ranking');
    expect(result.results[0]?.citations[0]?.chunkIndex).toBe(0);
  });

  it('extracts text, encrypts content, chunks documents and queues embedding jobs', async () => {
    const repeatedText = Array.from({ length: 220 }, (_, index) => `word${index}`).join(' ');
    mocks.getDocumentById.mockResolvedValueOnce({
      id: 'doc-1',
      absolutePath: 'C:/outlook/doc-1.txt',
      originalName: 'doc-1.txt',
      diskName: 'doc-1.txt',
      projectId: 'project-1',
    });
    mocks.readFile.mockResolvedValueOnce(Buffer.from(repeatedText, 'utf8'));

    const service = await loadModule();
    const result = await service.extractDocumentTextAndChunk('doc-1');

    expect(result).toEqual({ chunks: 2 });
    expect(mocks.upsertDocumentContent).toHaveBeenCalledWith(
      expect.objectContaining({
        documentId: 'doc-1',
        searchText: repeatedText,
        contentCiphertext: expect.any(String),
        contentIv: expect.any(String),
        contentTag: expect.any(String),
        keyVersion: 1,
      }),
    );
    expect(mocks.replaceDocumentChunks).toHaveBeenCalledWith({
      documentId: 'doc-1',
      chunks: [
        expect.objectContaining({ chunkIndex: 0, embeddingJson: null }),
        expect.objectContaining({ chunkIndex: 1, embeddingJson: null }),
      ],
    });
    expect(mocks.setDocumentStatus).toHaveBeenCalledWith('doc-1', 'TEXT_EXTRACTED');
    expect(mocks.enqueueSearchJob).toHaveBeenCalledWith({
      type: 'EMBED_DOC',
      projectId: 'project-1',
      payload: { documentId: 'doc-1' },
    });
  });

  it('throws when trying to extract text for a missing document', async () => {
    mocks.getDocumentById.mockResolvedValueOnce(null);

    const service = await loadModule();

    await expect(service.extractDocumentTextAndChunk('missing-doc')).rejects.toThrow(
      'Document not found: missing-doc',
    );
  });

  it('embeds document chunks, stores vectors and keeps text-only status when no embedding is available', async () => {
    mocks.getDocumentById.mockResolvedValueOnce({ id: 'doc-1' });
    mocks.listChunksForDocument.mockResolvedValueOnce([
      { id: 'chunk-1', documentId: 'doc-1', chunkIndex: 0, chunkText: 'alpha beta' },
    ]);

    const withoutKeyService = await loadModule();
    const noKeyResult = await withoutKeyService.embedDocumentChunks('doc-1');

    expect(noKeyResult).toEqual({
      embeddedChunks: 0,
      model: 'gemini-embedding-001',
    });
    expect(mocks.setDocumentStatus).toHaveBeenCalledWith('doc-1', 'TEXT_EXTRACTED');
    expect(mocks.updateChunkVector).not.toHaveBeenCalled();

    vi.resetAllMocks();
    vi.resetModules();
    process.env.GEMINI_API_KEY = 'secret-key';
    mocks.getDocumentById.mockResolvedValueOnce({ id: 'doc-1' });
    mocks.listChunksForDocument.mockResolvedValueOnce([
      { id: 'chunk-1', documentId: 'doc-1', chunkIndex: 0, chunkText: 'alpha beta' },
      { id: 'chunk-2', documentId: 'doc-1', chunkIndex: 1, chunkText: 'gamma delta' },
    ]);
    vi.mocked(global.fetch)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          embedding: {
            values: [0.1, 0.2, 0.3],
          },
        }),
      } as Response)
      .mockResolvedValueOnce({ ok: false } as Response);

    const service = await loadModule();
    const result = await service.embedDocumentChunks('doc-1');

    expect(result).toEqual({
      embeddedChunks: 1,
      model: 'gemini-embedding-001',
    });
    expect(mocks.updateChunkVector).toHaveBeenCalledWith('chunk-1', '[0.1,0.2,0.3]');
    expect(mocks.setChunkEmbeddingJson).toHaveBeenCalledWith('chunk-1', [0.1, 0.2, 0.3]);
    expect(mocks.setDocumentStatus).toHaveBeenCalledWith('doc-1', 'EMBEDDED');
  });

  it('uses pgvector semantic matches for global searches and avoids project logging', async () => {
    process.env.GEMINI_API_KEY = 'secret-key';
    mocks.findDocumentsForProject.mockResolvedValueOnce([
      {
        id: 'doc-1',
        subject: 'Semantic evidence',
        originalName: 'semantic.pdf',
        receivedTime: new Date('2026-01-04T00:00:00.000Z'),
        municipality: 'Orsa',
        decisionType: 'Tillstånd',
        wasteType: 'Massor',
        hazardousFlag: false,
        legalStatus: 'Aktiv',
        status: 'EMBEDDED',
        content: {
          searchText: 'Detailed semantic evidence for the query appears in this chunk.',
        },
        project: {
          id: 'project-1',
          propertyDesignation: 'Orsa 3:3',
          organisation: { name: 'Org 1' },
        },
      },
    ]);
    mocks.queryTopSemanticChunks.mockResolvedValueOnce([
      {
        documentId: 'doc-1',
        similarity: 0.91,
        chunkText: 'Detailed semantic evidence for the query appears in this chunk.',
        chunkIndex: 2,
      },
    ]);
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        embedding: {
          values: [0.2, 0.4],
        },
      }),
    } as Response);

    const service = await loadModule();
    const result = await service.runSearchQuery({
      organisationId: 'org-1',
      userId: 'user-1',
      query: 'semantic evidence',
      mode: 'semantic',
      topK: 3,
      strictEvidence: true,
    });

    expect(result.scope).toBe('global');
    expect(result.guardrails.semanticEngine).toBe('pgvector');
    expect(result.results).toHaveLength(1);
    expect(result.results[0]?.whyMatched).toContain('Semantic chunk similarity');
    expect(result.results[0]?.citations[0]).toMatchObject({
      chunkIndex: 2,
      sourceLabel: 'Semantic evidence',
    });
    expect(mocks.findDocumentsForProject).toHaveBeenCalledWith(
      expect.objectContaining({
        organisationId: 'org-1',
        projectId: undefined,
        query: undefined,
      }),
    );
    expect(mocks.logSearchQuery).not.toHaveBeenCalled();
  });

  it('filters out results without evidence when strict evidence is enabled', async () => {
    mocks.findDocumentsForProject.mockResolvedValueOnce([
      {
        id: 'doc-1',
        subject: '',
        originalName: 'doc-1.pdf',
        receivedTime: null,
        municipality: null,
        decisionType: null,
        wasteType: null,
        hazardousFlag: null,
        legalStatus: null,
        status: 'METADATA_ONLY',
        content: {
          searchText: '',
        },
        project: {
          id: 'project-1',
          propertyDesignation: 'Orsa 4:4',
          organisation: { name: 'Org 1' },
        },
      },
    ]);

    const service = await loadModule();
    const result = await service.runSearchQuery({
      organisationId: 'org-1',
      userId: 'user-1',
      query: '',
      mode: 'lexical',
      strictEvidence: true,
    });

    expect(result.results).toEqual([]);
    expect(result.guardrails.evidenceFilteredOut).toBe(1);
    expect(result.guardrails.citationCoveragePct).toBe(0);
  });

  it('handles empty query strings by returning all documents for the project', async () => {
    mocks.findDocumentsForProject.mockResolvedValueOnce([{ id: 'd' } as any]);
    const service = await loadModule();
    const result = await service.runSearchQuery({
      projectId: 'p',
      organisationId: 'o',
      userId: 'u',
      query: '',
      mode: 'lexical',
    });
    expect(result.results.length).toBe(1);
  });

  it('handles UTF-16 BE CSV files correctly', async () => {
    const csv = 'DiskName;Subject\nd1.pdf;Sub';
    const buffer = Buffer.alloc(csv.length * 2 + 2);
    buffer[0] = 0xfe;
    buffer[1] = 0xff; // BOM
    for (let i = 0; i < csv.length; i++) {
      buffer.writeUInt16BE(csv.charCodeAt(i), i * 2 + 2);
    }
    mocks.readFile.mockResolvedValueOnce(buffer);
    const service = await loadModule();
    const result = await service.syncManifestMetadata({
      projectId: 'p',
      organisationId: 'o',
      manifestPath: 'm.csv',
      outlookBaseDir: 'd',
    });
    expect(result.processedRows).toBe(1);
    expect(mocks.upsertDocumentFromManifest).toHaveBeenCalledWith(
      expect.objectContaining({ subject: 'Sub' }),
    );
  });

  it('handles OCR file size limits and API errors gracefully', async () => {
    process.env.GEMINI_API_KEY = 'key';
    const largeBuffer = Buffer.alloc(13_000_000);
    const service = await loadModule();
    const result = await (service as any).runGeminiOcr(largeBuffer, 'image/png');
    expect(result).toBeNull();

    vi.mocked(global.fetch).mockResolvedValueOnce({ ok: false } as Response);
    const apiErrorResult = await (service as any).runGeminiOcr(Buffer.from('small'), 'image/png');
    expect(apiErrorResult).toBeNull();
  });

  it('handles PDF parsing errors and fallbacks to OCR', async () => {
    mocks.readFile.mockResolvedValueOnce(Buffer.from('%PDF-1.4...'));
    vi.mock('pdf-parse', () => ({
      default: vi.fn().mockImplementation(() => {
        throw new Error('Parse error');
      }),
    }));

    const service = await loadModule();
    const result = await (service as any).loadPdfText('test.pdf', 'fallback');
    expect(result).toContain('Dokument: fallback');
  });

  it('covers encryption key versions and fallbacks', async () => {
    delete process.env.SEARCH_ENCRYPTION_KEY_BASE64;
    process.env.JWT_ACCESS_SECRET = 'test-secret';
    const service = await loadModule();
    const result = (service as any).encryptContent('secret text');
    expect(result.keyVersion).toBe(1);
    expect(result.ciphertext).toBeDefined();
  });

  it('covers cosine similarity edge cases', async () => {
    const service = await loadModule();
    const similarity = (service as any).cosineSimilarity;
    expect(similarity([1, 0], [0, 1])).toBe(0);
    expect(similarity([1, 1], [1, 1])).toBeCloseTo(1);
    expect(similarity([0, 0], [0, 0])).toBe(0);
    expect(similarity([1], [1, 2])).toBe(0);
  });

  it('marks search jobs for extraction when metadata changed', async () => {
    const service = await loadModule();
    const csv = 'DiskName;Sha256\nd1.pdf;h1';
    mocks.readFile.mockResolvedValue(Buffer.from(csv));

    mocks.findDocumentByDiskName.mockResolvedValue({
      diskName: 'd1.pdf',
      fileSha256: 'OLD_HASH',
      absolutePath: path.resolve('d', 'd1.pdf'),
      fileSize: BigInt(12),
      content: { searchText: 'old' },
    });

    await service.syncManifestMetadata({
      projectId: 'p',
      organisationId: 'o',
      manifestPath: 'm.csv',
      outlookBaseDir: 'd',
    });

    expect(mocks.enqueueSearchJob).toHaveBeenCalledWith(expect.objectContaining({ type: 'EXTRACT_TEXT' }));
  });
});
