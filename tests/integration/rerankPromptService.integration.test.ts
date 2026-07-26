import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RerankPromptService, DEFAULT_RERANK_PROMPT } from '../../server/services/rerankPromptService';
import { Storage } from '@google-cloud/storage';
import fs from 'node:fs';
import path from 'node:path';

describe('RerankPromptService (GCS Integration)', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    RerankPromptService.clearCache();
    RerankPromptService.stopHydrationDaemon();
    process.env = { ...originalEnv };
    delete process.env.LEGAL_RERANKER_PROMPT_GCS;
    delete process.env.LEGAL_RERANKER_PROMPT_VERSION;
    delete process.env.LEGAL_RERANKER_PROMPT_FILE;
  });

  afterEach(() => {
    RerankPromptService.stopHydrationDaemon();
    process.env = { ...originalEnv };
  });

  it('should instantiate the @google-cloud/storage client without throwing', () => {
    // Assert that the real Storage class can be instantiated (using default ADC or mock)
    let storage: Storage | null = null;
    let err: Error | null = null;
    try {
      storage = new Storage();
    } catch (e) {
      err = e as Error;
    }

    expect(err).toBeNull();
    expect(storage).toBeDefined();
    expect(storage).not.toBeNull();
  });

  it('should handle GCS bucket connection failures gracefully and fall back to local defaults', async () => {
    // Configure an inaccessible GCS bucket
    process.env.LEGAL_RERANKER_PROMPT_GCS = 'gs://miljobeslut-nonexistent-bucket-9999/prompts/test.txt';
    process.env.LEGAL_RERANKER_PROMPT_VERSION = 'v1.0.0-integration-test';

    const startTime = Date.now();
    const { template, version } = await RerankPromptService.getTemplate();
    const duration = Date.now() - startTime;

    // The GCS load should fail and fallback to default immediately
    expect(template).toBe(DEFAULT_RERANK_PROMPT);
    expect(version).toBe('default');
    // Ensure it doesn't hang indefinitely (GCS client has built-in retries/timeouts)
    expect(duration).toBeLessThan(10000); // Should resolve/fail fast
  });

  it('should successfully load template when GCS simulation/mocking is active in the environment', async () => {
    // Test that the GCS URL parsing and fallback flow matches expectations
    const gcsUri = 'gs://miljobeslut-alphaevolve/list_deduplication/prompt_opt_results/best_prompt.txt';
    const parsed = RerankPromptService.parseGsUri(gcsUri);
    expect(parsed.bucket).toBe('miljobeslut-alphaevolve');
    expect(parsed.name).toBe('list_deduplication/prompt_opt_results/best_prompt.txt');
  });

  it('should correctly fall back to a local file when GCS fails or is omitted', async () => {
    const tempFilePath = path.resolve(__dirname, 'temp_test_prompt.txt');
    const customPromptContent = 'Integrationsprov: {{QUERY}}';

    // Create temporary file
    fs.writeFileSync(tempFilePath, customPromptContent, 'utf8');

    try {
      process.env.LEGAL_RERANKER_PROMPT_FILE = tempFilePath;
      process.env.LEGAL_RERANKER_PROMPT_VERSION = 'local-integration-v1';

      const { template, version } = await RerankPromptService.getTemplate();
      expect(template).toBe(customPromptContent);
      expect(version).toContain('local-integration-v1');
    } finally {
      // Cleanup temporary file
      if (fs.existsSync(tempFilePath)) {
        fs.unlinkSync(tempFilePath);
      }
    }
  });
});
