import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../server/logger', () => ({
  logger: {
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

vi.mock('../../server/services/hybridGeoService', () => ({
  tryFetchLocalPropertyGeometry: vi.fn(async () => null),
}));

import { AuditService } from '../../src/platform/audit.service';
import { AuditAction } from '../../src/domain/audit';
import { PriceTrend } from '../../src/domain/market-intel';
import { ExternalMarketIntelAdapter } from '../../src/infrastructure/external-market-adapter';
import { GeminiAIAdapter } from '../../src/infrastructure/gemini-ai-adapter';
import { LantmaterietAdapter } from '../../src/infrastructure/lantmateriet-adapter';
import { logger } from '../../server/logger';

describe('src platform and adapter utilities', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('serializes audit log details and fetches history', async () => {
    const auditRepo = {
      save: vi.fn(async (event) => event),
      findByEntity: vi.fn().mockResolvedValue([{ id: 'audit-1' }]),
    };

    const service = new AuditService(auditRepo as any);
    await service.log({
      userId: 'user-1',
      action: AuditAction.UPDATE,
      entityType: 'Project',
      entityId: 'project-1',
      details: { approved: true },
      signatureId: 'sig-1',
    });

    expect(auditRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AuditAction.UPDATE,
        entityType: 'Project',
        entityId: 'project-1',
        details: JSON.stringify({ approved: true }),
        signatureId: 'sig-1',
      }),
    );
    await expect(service.getHistory('Project', 'project-1')).resolves.toEqual([{ id: 'audit-1' }]);
  });

  it('returns mocked Gemini analysis and extracted requirements', async () => {
    const adapter = new GeminiAIAdapter('gemini-key');

    await expect(adapter.analyzeDocumentText('abc', 'ctx')).resolves.toEqual({
      confidenceScore: 0.85,
      extractedText: 'Sammanfattning genererad av AI',
      suggestedCategory: 'MILJÖRAPPORT',
      metadata: { model: 'vertex', surface: 'platform-stub' },
    });
    await expect(adapter.extractRequirements('abc')).resolves.toEqual([
      { code: 'AI-KRAV-1', text: 'Bullernivå max 55 dB', level: 'MANDATORY' },
    ]);
  });

  it('returnerar "not_configured" + tom market intel utan endpoint', async () => {
    const adapter = new ExternalMarketIntelAdapter();
    const snapshot = await adapter.getSnapshot();

    expect(snapshot.source).toBe('not_configured');
    expect(snapshot.prices).toHaveLength(0);
  });

  it('fetches live market intel and reuses cache within TTL', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        prices: [
          {
            wasteCode: '17 05 04',
            description: 'Massor',
            unitPrice: 200,
            currency: 'SEK',
            unit: 'per_ton',
            trend: 'FALLING',
            updatedAt: '2026-04-03T00:00:00.000Z',
          },
        ],
        supply: [{ providerId: 'p1' }],
      }),
    });
    global.fetch = fetchMock as any;
    vi.stubEnv('MARKET_INTEL_ENDPOINT', 'https://example.test/market');

    const adapter = new ExternalMarketIntelAdapter();
    const first = await adapter.getSnapshot();
    const second = await adapter.getSnapshot();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(first.source).toBe('live');
    expect(first.prices[0].trend).toBe(PriceTrend.FALLING);
    expect(second).toBe(first);
  });

  it('returnerar "error" utan fallback-data när live fetch kraschar', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('boom')) as any;
    vi.stubEnv('MARKET_INTEL_ENDPOINT', 'https://example.test/market');

    const adapter = new ExternalMarketIntelAdapter();
    const snapshot = await adapter.getSnapshot();

    expect(snapshot.source).toBe('error');
    expect(snapshot.prices).toHaveLength(0);
    expect(logger.warn).toHaveBeenCalled();
  });

  it('avvecklat demo-läge: fetchPropertyInfo returnerar null utan riktig endpoint', async () => {
    vi.stubEnv('PROPERTY_LOOKUP_MODE', 'api');
    vi.stubEnv('LANTMATERIET_DEMO_MODE', 'true');
    vi.stubEnv('LANTMATERIET_PROPERTY_ENDPOINT', '');

    const adapter = new LantmaterietAdapter();
    const property = await adapter.fetchPropertyInfo('stockholm 1:1');

    expect(property).toBeNull();
  });

  it('returns null and warns when no property endpoint is configured', async () => {
    vi.stubEnv('PROPERTY_LOOKUP_MODE', 'live');
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ access_token: 'token-1', expires_in: 3600 }),
    });
    global.fetch = fetchMock as any;
    vi.stubEnv('LANTMATERIET_CLIENT_ID', 'client');
    vi.stubEnv('LANTMATERIET_CLIENT_SECRET', 'secret');
    vi.stubEnv('LANTMATERIET_TOKEN_URL', 'https://example.test/token');

    const adapter = new LantmaterietAdapter();
    await expect(adapter.fetchPropertyInfo('fast-1')).resolves.toBeNull();
    expect(logger.warn).toHaveBeenCalled();
  });

  it('fetches a real property and caches the Lantmäteriet access token', async () => {
    vi.stubEnv('PROPERTY_LOOKUP_MODE', 'live');
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'token-1', expires_in: 3600 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'property-1',
          designation: 'FAST-1',
          municipality: 'Uppsala',
          area: 1200,
          owner: 'Ägare AB',
          centroid: { lat: 59.8, lng: 17.6 },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'property-2',
          designation: 'FAST-2',
          municipality: 'Uppsala',
        }),
      });
    global.fetch = fetchMock as any;
    vi.stubEnv('LANTMATERIET_CLIENT_ID', 'client');
    vi.stubEnv('LANTMATERIET_CLIENT_SECRET', 'secret');
    vi.stubEnv('LANTMATERIET_TOKEN_URL', 'https://example.test/token');
    vi.stubEnv('LANTMATERIET_PROPERTY_ENDPOINT', 'https://example.test/property');

    const adapter = new LantmaterietAdapter();
    const first = await adapter.fetchPropertyInfo('fast-1');
    const second = await adapter.fetchPropertyInfo('fast-2');

    expect(first).toMatchObject({
      id: 'property-1',
      designation: 'FAST-1',
      municipality: 'Uppsala',
      ownerName: 'Ägare AB',
    });
    expect(second).toMatchObject({
      id: 'property-2',
      designation: 'FAST-2',
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
