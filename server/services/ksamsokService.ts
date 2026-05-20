import { KSAMSOK_API_BASE_URL } from '../constants/culturalHeritageSources';
import { logger } from '../logger';

const DEFAULT_TIMEOUT_MS = 60_000;

export type KsamsokBoundingSearchParams = {
  minLng: number;
  minLat: number;
  maxLng: number;
  maxLat: number;
  hitsPerPage?: number;
  startRecord?: number;
  /** Extra CQL, t.ex. `text=grav` — kombineras med AND mot boundingBox */
  extraQuery?: string;
};

function buildBoundingCql(minLng: number, minLat: number, maxLng: number, maxLat: number): string {
  // Se RAA: boundingBox=/WGS84 "väst syd öst nord" (WGS84)
  const inner = `${minLng} ${minLat} ${maxLng} ${maxLat}`;
  return `boundingBox=/WGS84 "${inner}"`;
}

/**
 * Sökning via K-samsöks API inom en geografisk ruta (WGS84).
 * Svar hämtas som JSON om möjligt (JSON-LD enligt RAA-dokumentation).
 *
 * @see https://www.raa.se/hitta-information/k-samsok/att-anvanda-k-samsok/kom-igang-med-k-samsoks-api/
 */
export async function searchKsamsokBoundingBox(
  params: KsamsokBoundingSearchParams,
): Promise<{ ok: true; data: unknown } | { ok: false; error: string }> {
  const hitsPerPage = Math.min(500, Math.max(1, Math.floor(params.hitsPerPage ?? 50)));
  const startRecord = Math.max(1, Math.floor(params.startRecord ?? 1));

  let query = buildBoundingCql(params.minLng, params.minLat, params.maxLng, params.maxLat);
  if (params.extraQuery?.trim()) {
    query = `${query} AND ${params.extraQuery.trim()}`;
  }

  const url = new URL(KSAMSOK_API_BASE_URL);
  url.searchParams.set('method', 'search');
  url.searchParams.set('version', '1.1');
  url.searchParams.set('hitsPerPage', String(hitsPerPage));
  url.searchParams.set('startRecord', String(startRecord));
  url.searchParams.set('query', query);

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), DEFAULT_TIMEOUT_MS);

  try {
    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        Accept: 'application/json, application/json-ld, application/xml;q=0.9',
      },
      signal: ac.signal,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      return {
        ok: false,
        error: `K-samsök HTTP ${response.status}: ${text.slice(0, 500)}`,
      };
    }

    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('json')) {
      const data = await response.json();
      return { ok: true, data };
    }

    const text = await response.text();
    return { ok: true, data: { _rawXmlOrText: text.slice(0, 200_000) } };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn('ksamsokService.search failed', { message });
    return { ok: false, error: message };
  } finally {
    clearTimeout(timer);
  }
}
