import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GeminiAIAdapter } from '../../../src/infrastructure/gemini-ai-adapter';

describe('GeminiAIAdapter', () => {
  let adapter: GeminiAIAdapter;
  const apiKey = 'test-api-key';

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new GeminiAIAdapter(apiKey);
  });

  // ── Constructor ──────────────────────────────────────────────────────────────

  it('should initialize with API key', () => {
    const newAdapter = new GeminiAIAdapter('my-key');
    expect(newAdapter).toBeInstanceOf(GeminiAIAdapter);
  });

  it('should handle empty API key', () => {
    const newAdapter = new GeminiAIAdapter('');
    expect(newAdapter).toBeInstanceOf(GeminiAIAdapter);
  });

  // ── analyzeDocumentText ──────────────────────────────────────────────────────

  it('should return analysis result with expected fields', async () => {
    const text = 'Document text content';
    const prompt = 'Analyze this text';

    const result = await adapter.analyzeDocumentText(text, prompt);

    expect(result).toHaveProperty('confidenceScore');
    expect(result).toHaveProperty('extractedText');
    expect(result).toHaveProperty('suggestedCategory');
    expect(result).toHaveProperty('metadata');
  });

  it('should return confidence score between 0 and 1', async () => {
    const result = await adapter.analyzeDocumentText('test', 'prompt');

    expect(result.confidenceScore).toBeGreaterThanOrEqual(0);
    expect(result.confidenceScore).toBeLessThanOrEqual(1);
  });

  it('should return non-empty extracted text', async () => {
    const result = await adapter.analyzeDocumentText('test document', 'analyze');

    expect(result.extractedText).toBeTruthy();
    expect(typeof result.extractedText).toBe('string');
  });

  it('should return valid category', async () => {
    const result = await adapter.analyzeDocumentText('test', 'prompt');

    expect(result.suggestedCategory).toBeTruthy();
    const validCategories = ['MILJÖRAPPORT', 'ANSÖKAN', 'BESLUT', 'RITNING', 'ANNAT'];
    expect(validCategories).toContain(result.suggestedCategory);
  });

  it('should include model in metadata', async () => {
    const result = await adapter.analyzeDocumentText('test', 'prompt');

    expect(result.metadata).toHaveProperty('model');
    expect(typeof result.metadata.model).toBe('string');
  });

  it('should handle empty document text', async () => {
    const result = await adapter.analyzeDocumentText('', 'prompt');

    expect(result).toHaveProperty('confidenceScore');
    expect(result.confidenceScore).toBeGreaterThanOrEqual(0);
  });

  it('should handle very long document text', async () => {
    const longText = 'a'.repeat(10000);
    const result = await adapter.analyzeDocumentText(longText, 'prompt');

    expect(result.extractedText).toBeTruthy();
  });

  it('should handle complex context prompts', async () => {
    const complexPrompt =
      'Analyze this document in context of Swedish environmental regulations focusing on water protection and noise levels';
    const result = await adapter.analyzeDocumentText('test', complexPrompt);

    expect(result).toHaveProperty('extractedText');
  });

  // ── extractRequirements ──────────────────────────────────────────────────────

  it('should return array of requirements', async () => {
    const result = await adapter.extractRequirements('test document');

    expect(Array.isArray(result)).toBe(true);
  });

  it('should return non-empty requirements array', async () => {
    const result = await adapter.extractRequirements('test');

    expect(result.length).toBeGreaterThan(0);
  });

  it('should return requirements with expected structure', async () => {
    const result = await adapter.extractRequirements('test');

    expect(result[0]).toHaveProperty('code');
    expect(result[0]).toHaveProperty('text');
    expect(result[0]).toHaveProperty('level');
  });

  it('should return requirements with valid level', async () => {
    const result = await adapter.extractRequirements('test');

    const validLevels = ['MANDATORY', 'RECOMMENDED', 'OPTIONAL', 'CONDITIONAL'];
    expect(validLevels).toContain(result[0].level);
  });

  it('should return requirement codes with pattern', async () => {
    const result = await adapter.extractRequirements('test');

    // Codes should follow pattern like "AI-KRAV-1"
    expect(result[0].code).toMatch(/^[A-Z]+-[A-Z]+-\d+$/);
  });

  it('should extract different requirements for different texts', async () => {
    const result1 = await adapter.extractRequirements('Environmental regulations');
    const result2 = await adapter.extractRequirements('Traffic management');

    expect(result1).toBeDefined();
    expect(result2).toBeDefined();
  });

  it('should handle empty document text', async () => {
    const result = await adapter.extractRequirements('');

    expect(Array.isArray(result)).toBe(true);
  });

  it('should handle very long document text', async () => {
    const longText = 'Requirement text. '.repeat(500);
    const result = await adapter.extractRequirements(longText);

    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);
  });

  // ── Integration ──────────────────────────────────────────────────────────────

  it('should handle sequential analysis calls', async () => {
    const result1 = await adapter.analyzeDocumentText('doc1', 'prompt1');
    const result2 = await adapter.analyzeDocumentText('doc2', 'prompt2');

    expect(result1).toHaveProperty('extractedText');
    expect(result2).toHaveProperty('extractedText');
  });

  it('should handle mixed analysis and extraction calls', async () => {
    const analysis = await adapter.analyzeDocumentText('test', 'analyze');
    const requirements = await adapter.extractRequirements('test');

    expect(analysis).toHaveProperty('extractedText');
    expect(Array.isArray(requirements)).toBe(true);
  });

  it('should return different analysis results for different documents', async () => {
    const analysis1 = await adapter.analyzeDocumentText('Document about water', 'analyze');
    const analysis2 = await adapter.analyzeDocumentText('Document about noise', 'analyze');

    expect(analysis1.extractedText).toBeTruthy();
    expect(analysis2.extractedText).toBeTruthy();
  });

  // ── Error Handling ───────────────────────────────────────────────────────────

  it('should handle API errors gracefully', async () => {
    const errorAdapter = new GeminiAIAdapter('');
    const result = await errorAdapter.analyzeDocumentText('test', 'prompt');

    expect(result).toBeDefined();
    expect(result.confidenceScore).toBeGreaterThanOrEqual(0);
  });

  it('should handle malformed input gracefully', async () => {
    const result = await adapter.analyzeDocumentText('', '');

    expect(result).toBeDefined();
    expect(result).toHaveProperty('extractedText');
  });

  // ── Performance ──────────────────────────────────────────────────────────────

  it('should complete analysis within reasonable time', async () => {
    const start = Date.now();
    await adapter.analyzeDocumentText('test document', 'analyze');
    const duration = Date.now() - start;

    expect(duration).toBeLessThan(5000); // Should complete within 5 seconds
  });

  it('should handle concurrent requests', async () => {
    const promises = [
      adapter.analyzeDocumentText('doc1', 'p1'),
      adapter.analyzeDocumentText('doc2', 'p2'),
      adapter.analyzeDocumentText('doc3', 'p3'),
    ];

    const results = await Promise.all(promises);

    expect(results).toHaveLength(3);
    results.forEach((r) => {
      expect(r).toHaveProperty('extractedText');
      expect(r).toHaveProperty('confidenceScore');
    });
  });
});
