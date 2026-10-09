import type { FeatureCollection } from 'geojson';

export type MapPresentationLayerKey = 'property';

export type MapPresentationViewportResponse = {
  readonly type: 'FeatureCollection';
  readonly features: FeatureCollection['features'];
  readonly meta: {
    readonly presentation: 'map-viewport-v1';
    readonly source: 'live' | 'fixture';
    readonly layer_id: string;
    readonly feature_count: number;
    readonly limit: number;
    readonly bbox: string;
    readonly truncated: boolean;
    readonly governance_status: string;
    readonly presentation_kind?: string;
    readonly identity_note?: string;
    readonly error?: string;
  };
};

export type FetchViewportPresentationInput = {
  readonly bbox: string;
  readonly layer?: MapPresentationLayerKey;
  readonly limit?: number;
  readonly signal?: AbortSignal;
  readonly source?: 'live' | 'fixture';
};

/**
 * Client for the smallest map presentation viewport API.
 * Does not invent query authority — only forwards bbox/limit to the server product.
 */
export async function fetchViewportPresentation(
  input: FetchViewportPresentationInput,
): Promise<MapPresentationViewportResponse> {
  const layer = input.layer ?? 'property';
  const limit = input.limit ?? 200;
  const source = input.source ?? 'live';
  const params = new URLSearchParams({
    bbox: input.bbox,
    layer,
    limit: String(limit),
    source,
  });
  const res = await fetch(`/api/map/presentation/viewport?${params.toString()}`, {
    signal: input.signal,
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body?.error) detail = body.error;
    } catch {
      // keep status text
    }
    throw new Error(`Map presentation viewport failed: ${detail}`);
  }
  return (await res.json()) as MapPresentationViewportResponse;
}
