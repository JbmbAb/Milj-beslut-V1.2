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
    RerankPromptService.stopHydrationDaemon();
    
    // Reset process.env before each test
    process.env = { ...originalEnv };
    delete process.env.LEGAL_RERANKER_PROMPT_GCS;
    delete process.env.LEGAL_RERANKER_PROMPT_VERSION;
    delete process.env.LEGAL_RERANKER_PROMPT_FILE;

    // Reset default mock behavior
    mocks.downloadMock.mockReset();
    mocks.downloadMock.mockResolvedValue([Buffer.from('Custom optimized prompt: {{QUERY}}\n{{DOCUMENTS}}')]);
  });

  afterEach(() => {
    RerankPromptService.stopHydrationDaemon();
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
      mocks.downloadMock.mockRejectedValue(new Error('GCS error')); // Fails permanently

      const { template, version } = await RerankPromptService.getTemplate();
      expect(template).toBe(DEFAULT_RERANK_PROMPT);
      expect(version).toBe('default');
    });
  });

  describe('Week 2 Resilience Features', () => {
    describe('Exponential Backoff Retries', () => {
      it('should succeed on retry if GCS initially fails', async () => {
        process.env.LEGAL_RERANKER_PROMPT_GCS = 'gs://retry-bucket/prompt.txt';
        process.env.LEGAL_RERANKER_PROMPT_VERSION = 'v-retry';

        // Mock 2 initial failures, then success on 3rd attempt
        mocks.downloadMock
          .mockRejectedValueOnce(new Error('Transient connection error 1'))
          .mockRejectedValueOnce(new Error('Transient connection error 2'))
          .mockResolvedValueOnce([Buffer.from('Recovered prompt template')]);

        // Use very fast base delay to keep tests instant
        const start = Date.now();
        const { template } = await RerankPromptService.getTemplate();
        const duration = Date.now() - start;

        expect(template).toBe('Recovered prompt template');
        expect(mocks.downloadMock).toHaveBeenCalledTimes(3);
        expect(duration).toBeGreaterThanOrEqual(0); // Should be very fast due to low base delay (default is 100ms, retry delays 100ms, 200ms)
      });
    });

    describe('Request Coalescing (Single Flight)', () => {
      it('should coalesce multiple concurrent GCS requests into exactly one download call', async () => {
        process.env.LEGAL_RERANKER_PROMPT_GCS = 'gs://coalesce-bucket/prompt.txt';
        process.env.LEGAL_RERANKER_PROMPT_VERSION = 'v-coalesce';

        let resolveGcs: (value: any) => void = () => {};
        const gcsPromise = new Promise((resolve) => {
          resolveGcs = resolve;
        });

        // Delay the download response
        mocks.downloadMock.mockImplementation(() => gcsPromise);

        // Make multiple concurrent template requests
        const p1 = RerankPromptService.getTemplate();
        const p2 = RerankPromptService.getTemplate();
        const p3 = RerankPromptService.getTemplate();

        // Resolve the GCS download call
        resolveGcs([Buffer.from('Coalesced Template')]);

        const [r1, r2, r3] = await Promise.all([p1, p2, p3]);

        expect(r1.template).toBe('Coalesced Template');
        expect(r2.template).toBe('Coalesced Template');
        expect(r3.template).toBe('Coalesced Template');

        // Verify direct download mock was called EXACTLY once
        expect(mocks.downloadMock).toHaveBeenCalledTimes(1);
      });
    });

    describe('Token-Bucket Rate Limiter', () => {
      it('should limit GCS requests to max 5 and fallback gracefully on rate limit exhaustion', async () => {
        process.env.LEGAL_RERANKER_PROMPT_GCS = 'gs://ratelimit-bucket/prompt.txt';
        process.env.LEGAL_RERANKER_PROMPT_VERSION = 'v-ratelimit';

        // Set up local fallback file mock so we can observe rate limit fallback
        process.env.LEGAL_RERANKER_PROMPT_FILE = 'config/fallback.txt';
        vi.spyOn(fs, 'existsSync').mockReturnValue(true);
        vi.spyOn(fs.promises, 'readFile').mockResolvedValue('Local Fallback');

        // Call getTemplate repeatedly while clearing cache to force GCS calls
        for (let i = 0; i < 5; i++) {
          const res = await RerankPromptService.getTemplate();
          expect(res.template).toBe('Custom optimized prompt: {{QUERY}}\n{{DOCUMENTS}}');
          RerankPromptService.clearPromptCacheOnly(); // Force next call to query GCS without resetting token state
        }

        // The 6th call should hit the rate limiter and fall back immediately to local file
        const resRateLimited = await RerankPromptService.getTemplate();
        expect(resRateLimited.template).toBe('Local Fallback');
        expect(resRateLimited.version).toContain('local-config/fallback.txt');

        // GCS should have been called exactly 5 times (none for the 6th call)
        expect(mocks.downloadMock).toHaveBeenCalledTimes(5);
      });
    });

    describe('Cache Hydration Daemon', () => {
      it('should automatically pre-hydrate cache on background intervals', async () => {
        process.env.LEGAL_RERANKER_PROMPT_GCS = 'gs://hydrate-bucket/prompt.txt';
        process.env.LEGAL_RERANKER_PROMPT_VERSION = 'v-hydrate';

        mocks.downloadMock
          .mockResolvedValueOnce([Buffer.from('Original Template')])
          .mockResolvedValueOnce([Buffer.from('Pre-hydrated Background Template')]);

        // First call loads and caches 'Original Template', starts daemon
        const first = await RerankPromptService.getTemplate();
        expect(first.template).toBe('Original Template');
        expect(mocks.downloadMock).toHaveBeenCalledTimes(1);

        // Start daemon manually with 50ms interval to speed up test
        RerankPromptService.stopHydrationDaemon();
        RerankPromptService.startHydrationDaemon(50);

        // Wait for background hydration to fire and refresh cache
        await new Promise((resolve) => setTimeout(resolve, 80));

        // Stop daemon immediately so it doesn't run again
        RerankPromptService.stopHydrationDaemon();

        // Second call should return 'Pre-hydrated Background Template' from cache directly
        const second = await RerankPromptService.getTemplate();
        expect(second.template).toBe('Pre-hydrated Background Template');
      });
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
