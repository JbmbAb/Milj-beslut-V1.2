import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('ksamsokService', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Promise.resolve(
          new Response(JSON.stringify({ result: 'test' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        ),
      ),
    );
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete process.env.KSAMSOK_API_BASE_URL;
  });

  it('searchKsamsokBoundingBox builds WGS84 boundingBox query and returns JSON', async () => {
    const mod = await import('../../server/services/ksamsokService');

    const out = await mod.searchKsamsokBoundingBox({
      minLng: 12.8,
      minLat: 55.5,
      maxLng: 13.0,
      maxLat: 55.6,
      hitsPerPage: 10,
      startRecord: 1,
    });

    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.data).toEqual({ result: 'test' });
    }

    const fetchMock = vi.mocked(globalThis.fetch);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain('method=search');
    expect(url).toContain('version=1.1');
    expect(url).toContain('boundingBox');
    expect(url).toContain('WGS84');
    const normalized = decodeURIComponent(url.replace(/\+/g, ' '));
    expect(normalized).toContain('12.8');
    expect(normalized).toContain('55.5');
    expect(normalized).toContain('13');
    expect(normalized).toContain('55.6');
  });
});
