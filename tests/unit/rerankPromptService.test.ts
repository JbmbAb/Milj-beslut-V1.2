import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RerankPromptService, DEFAULT_RERANK_PROMPT } from '../../server/services/rerankPromptService';
import fs from 'node:fs';
import path from 'node:path';

// Hoist mocks
const mocks = vi.hoisted(() => {
  return {
    downloadMock: vi.fn().mockResolvedValue([Buffer.from('Custom optimized prompt: {{QUERY}}\n{{DOCUMENTS}}')]),
    fileMock: vi.fn(),
    bucketMock: vi.fn(),
  };
});

// Mock @google-cloud/storage
vi.mock('@google-cloud/storage', () => {
  class Storage {
    bucket(bucketName: string) {
      mocks.bucketMock(bucketName);
      return {
        file: (fileName: string) => {
          mocks.fileMock(fileName);
          return {
            download: mocks.downloadMock,
          };
        },
      };
    }
  }
  return { Storage };
});

// Mock fs and path
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    default: {
      ...actual.default,
      existsSync: vi.fn(),
      promises: {
        ...actual.default.promises,
        readFile: vi.fn(),
      },
    },
  };
});

describe('RerankPromptService', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    RerankPromptService.clearCache();
    // Reset process.env before each test
    process.env = { ...originalEnv };
    delete process.env.LEGAL_RERANKER_PROMPT_GCS;
    delete process.env.LEGAL_RERANKER_PROMPT_VERSION;
    delete process.env.LEGAL_RERANKER_PROMPT_FILE;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('parseGsUri', () => {
    it('should correctly parse a standard gs:// URI', () => {
      const parsed = RerankPromptService.parseGsUri('gs://my-bucket/prompts/reranker.txt');
      expect(parsed).toEqual({
        bucket: 'my-bucket',
        name: 'prompts/reranker.txt',
      });
    });

    it('should throw an error for invalid URIs', () => {
      expect(() => RerankPromptService.parseGsUri('invalid-uri')).toThrow();
      expect(() => RerankPromptService.parseGsUri('gs://')).toThrow();
      expect(() => RerankPromptService.parseGsUri('gs://mybucket')).toThrow();
    });
  });

  describe('getTemplate', () => {
    it('should return the default prompt when no environment variables are set', async () => {
      const { template, version } = await RerankPromptService.getTemplate();
      expect(template).toBe(DEFAULT_RERANK_PROMPT);
      expect(version).toBe('default');
    });

    it('should load prompt from GCS if configured and cache it', async () => {
      process.env.LEGAL_RERANKER_PROMPT_GCS = 'gs://test-bucket/prompts/best.txt';
      process.env.LEGAL_RERANKER_PROMPT_VERSION = 'v1.2.3';

      const { template, version } = await RerankPromptService.getTemplate();

      expect(mocks.bucketMock).toHaveBeenCalledWith('test-bucket');
      expect(mocks.fileMock).toHaveBeenCalledWith('prompts/best.txt');
      expect(template).toBe('Custom optimized prompt: {{QUERY}}\n{{DOCUMENTS}}');
      expect(version).toBe('v1.2.3');

      // Call it again and assert it uses cache (mocks.downloadMock shouldn't be called again)
      vi.clearAllMocks();
      const secondCall = await RerankPromptService.getTemplate();
      expect(secondCall.template).toBe('Custom optimized prompt: {{QUERY}}\n{{DOCUMENTS}}');
      expect(mocks.downloadMock).not.toHaveBeenCalled();
    });

    it('should fallback to local file if GCS fails or is not configured', async () => {
      process.env.LEGAL_RERANKER_PROMPT_FILE = 'config/prompt.txt';
      process.env.LEGAL_RERANKER_PROMPT_VERSION = 'local-v1';

      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(fs.promises, 'readFile').mockResolvedValue('Local prompt content: {{QUERY}}');

      const { template, version } = await RerankPromptService.getTemplate();

      expect(fs.existsSync).toHaveBeenCalled();
      expect(fs.promises.readFile).toHaveBeenCalled();
      expect(template).toBe('Local prompt content: {{QUERY}}');
      expect(version).toBe('local-config/prompt.txt-local-v1');
    });

    it('should fallback to default if GCS and local file both fail or are missing', async () => {
      process.env.LEGAL_RERANKER_PROMPT_GCS = 'gs://bad-bucket/not-found.txt';
      mocks.downloadMock.mockRejectedValueOnce(new Error('GCS error'));

      const { template, version } = await RerankPromptService.getTemplate();
      expect(template).toBe(DEFAULT_RERANK_PROMPT);
      expect(version).toBe('default');
    });
  });

  describe('getFormattedPrompt', () => {
    it('should format the query and candidates correctly', async () => {
      const candidates = [
        { id: 'chunk-1', chunkText: 'Miljöprövning krävs för schaktning.' },
        { id: 'chunk-2', chunkText: 'Skyddade vattentäkter i närheten.' },
      ];

      const { prompt, version } = await RerankPromptService.getFormattedPrompt('schaktning', candidates);

      expect(version).toBe('default');
      expect(prompt).toContain('schaktning');
      expect(prompt).toContain('ID: chunk-1');
      expect(prompt).toContain('Text: Miljöprövning krävs för schaktning.');
      expect(prompt).toContain('ID: chunk-2');
      expect(prompt).toContain('Text: Skyddade vattentäkter i närheten.');
    });

    it('should fallback gracefully if custom GCS template has no placeholders', async () => {
      process.env.LEGAL_RERANKER_PROMPT_GCS = 'gs://test-bucket/prompts/best.txt';
      mocks.downloadMock.mockResolvedValueOnce([Buffer.from('Prompt without documents but with query {{QUERY}}.')]);

      const candidates = [
        { id: 'chunk-1', chunkText: 'Some doc content.' },
      ];

      const { prompt } = await RerankPromptService.getFormattedPrompt('water-protection', candidates);
      expect(prompt).toContain('Prompt without documents but with query water-protection.');
      expect(prompt).toContain('ID: chunk-1\nText: Some doc content.');
    });
  });
});
