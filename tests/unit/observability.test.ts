import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { logger, createLogger } from '../../src/infrastructure/observability/logger';
import {
  recordRequest,
  recordDbQuery,
  recordError,
  recordLLMCall,
  getMetricsText,
  calculateLLMCost,
  __resetMetrics,
} from '../../src/infrastructure/observability/metrics';

describe('Clean Architecture Observability Framework', () => {
  describe('JSON Logger', () => {
    let stdoutSpy: ReturnType<typeof vi.spyOn>;
    let stderrSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
      stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
      delete process.env.LOG_LEVEL;
      delete process.env.NODE_ENV;
    });

    afterEach(() => {
      stdoutSpy.mockRestore();
      stderrSpy.mockRestore();
    });

    it('should log info to stdout in valid structured JSON format', () => {
      logger.info('Test info message', { userId: '123' });
      expect(stdoutSpy).toHaveBeenCalled();
      expect(stderrSpy).not.toHaveBeenCalled();

      const output = JSON.parse(stdoutSpy.mock.calls[0][0] as string);
      expect(output.level).toBe('info');
      expect(output.message).toBe('Test info message');
      expect(output.userId).toBe('123');
      expect(output.timestamp).toBeDefined();
    });

    it('should log warn and error to stderr', () => {
      logger.warn('Test warning');
      logger.error('Test error', { details: 'fatal' });

      expect(stderrSpy).toHaveBeenCalledTimes(2);

      const warnOutput = JSON.parse(stderrSpy.mock.calls[0][0] as string);
      expect(warnOutput.level).toBe('warn');
      expect(warnOutput.message).toBe('Test warning');

      const errorOutput = JSON.parse(stderrSpy.mock.calls[1][0] as string);
      expect(errorOutput.level).toBe('error');
      expect(errorOutput.message).toBe('Test error');
      expect(errorOutput.details).toBe('fatal');
    });

    it('should include context when created via createLogger', () => {
      const customLogger = createLogger('SewageUseCase');
      customLogger.info('Sewage processing started');

      const output = JSON.parse(stdoutSpy.mock.calls[0][0] as string);
      expect(output.level).toBe('info');
      expect(output.message).toBe('Sewage processing started');
      expect(output.context).toBe('SewageUseCase');
    });

    it('should honor LOG_LEVEL for debug messages', () => {
      logger.debug('This is silent by default');
      expect(stdoutSpy).not.toHaveBeenCalled();

      process.env.LOG_LEVEL = 'debug';
      logger.debug('This should be printed');
      expect(stdoutSpy).toHaveBeenCalled();

      const output = JSON.parse(stdoutSpy.mock.calls[0][0] as string);
      expect(output.level).toBe('debug');
      expect(output.message).toBe('This should be printed');
    });
  });

  describe('MetricsService & Cost Tracking', () => {
    beforeEach(() => {
      __resetMetrics();
    });

    it('should calculate cost accurately based on the pricing model', () => {
      // gemini-1.5-pro: input $1.25 / 1M, output $5.00 / 1M
      const costPro = calculateLLMCost('gemini-1.5-pro', 100_000, 20_000);
      expect(costPro).toBe((100_000 / 1_000_000) * 1.25 + (20_000 / 1_000_000) * 5.0);

      // gemini-2.0-flash: input $0.075 / 1M, output $0.30 / 1M
      const costFlash = calculateLLMCost('gemini-2.0-flash', 1_000_000, 2_000_000);
      expect(costFlash).toBe((1_000_000 / 1_000_000) * 0.075 + (2_000_000 / 1_000_000) * 0.3);
    });

    it('should record LLM call details and compute costs dynamically', () => {
      const cost = recordLLMCall({
        model: 'gemini-1.5-pro',
        inputTokens: 50_000,
        outputTokens: 10_000,
        durationMs: 850,
        success: true,
      });

      expect(cost).toBeGreaterThan(0);

      const metricsText = getMetricsText();
      expect(metricsText).toContain('llm_calls_total{model="gemini-1.5-pro",success="true"} 1');
      expect(metricsText).toContain('llm_tokens_total{model="gemini-1.5-pro",type="input"} 50000');
      expect(metricsText).toContain('llm_tokens_total{model="gemini-1.5-pro",type="output"} 10000');
      expect(metricsText).toContain('llm_cost_usd_total{model="gemini-1.5-pro"}');
      expect(metricsText).toContain('llm_call_duration_ms{quantile="0.5"} 850');
    });

    it('should record standard requests, database queries, and errors', () => {
      recordRequest('POST', '/api/sewage/assess', 201, 120);
      recordDbQuery('findUnique', 15);
      recordError('DATABASE_CONNECTION_TIMEOUT');

      const metricsText = getMetricsText();
      expect(metricsText).toContain(
        'http_requests_total{method="POST",route="/api/sewage/assess",status="201"} 1',
      );
      expect(metricsText).toContain('db_queries_total{failed="false",operation="findUnique"} 1');
      expect(metricsText).toContain('app_errors_total{type="DATABASE_CONNECTION_TIMEOUT"} 1');
    });
  });
});
