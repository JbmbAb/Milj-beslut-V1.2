import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import type { CesiumAdapter } from './CesiumAdapter';
import { deriveFeatureCollectionState, type MapfrontLoadingState, type MapfrontStateReason } from './loadingState';
import { fetchViewportPresentation } from './mapPresentationClient';
import type { ViewportRequest } from './viewportController';

/**
 * Viewport-driven property presentation loading (latest wins, abort stale).
 * Exploration / foundation mode only — productMode LU evidence stays workspace-owned.
 */
export function useCesiumViewportProperties(input: {
  readonly enabled: boolean;
  readonly adapterRef: MutableRefObject<CesiumAdapter | null>;
  readonly source: 'live' | 'fixture';
}): {
  readonly viewportState: MapfrontLoadingState;
  readonly viewportError: MapfrontStateReason | null;
  readonly viewportCount: number | null;
  readonly truncated: boolean;
  readonly onViewportRequest: (request: ViewportRequest) => Promise<void>;
  readonly onViewportRejected: (reason: string) => void;
} {
  const [loading, setLoading] = useState(false);
  const [count, setCount] = useState<number | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [error, setError] = useState<MapfrontStateReason | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const sourceRef = useRef(input.source);
  sourceRef.current = input.source;

  const onViewportRejected = (reason: string) => {
    if (reason === 'viewport_too_large') {
      setUnavailable(true);
      setLoading(false);
      setCount(null);
      setError({
        code: 'viewport_too_large',
        messageSv: 'Zooma in för att ladda fastigheter (presentationen tillåter inte nationell dump).',
        retryable: true,
      });
      return;
    }
    setUnavailable(true);
    setError({
      code: reason,
      messageSv: 'Viewport kunde inte beräknas.',
      retryable: true,
    });
  };

  const onViewportRequest = async (request: ViewportRequest) => {
    if (!input.enabled) return;
    const adapter = input.adapterRef.current;
    if (!adapter) return;
    setLoading(true);
    setError(null);
    setUnavailable(false);
    try {
      const collection = await fetchViewportPresentation({
        bbox: request.bbox,
        layer: 'property',
        limit: 200,
        signal: request.signal,
        source: sourceRef.current,
      });
      if (!adapter.isViewportCurrent(request.generation)) return;
      const n = await adapter.setViewportPropertyFeatures(collection);
      if (!adapter.isViewportCurrent(request.generation)) return;
      setCount(n);
      setTruncated(Boolean(collection.meta?.truncated));
    } catch (err) {
      if (request.signal.aborted) return;
      if (!adapter.isViewportCurrent(request.generation)) return;
      const message = err instanceof Error ? err.message : 'Viewport-presentation misslyckades';
      setError({ code: 'viewport_fetch_failed', messageSv: message, retryable: true });
      setCount(0);
    } finally {
      if (!request.signal.aborted) setLoading(false);
    }
  };

  useEffect(() => {
    if (!input.enabled) {
      setLoading(false);
      setCount(null);
      setError(null);
      setUnavailable(false);
      setTruncated(false);
    }
  }, [input.enabled]);

  const viewportState = deriveFeatureCollectionState({
    loading,
    error,
    unavailable,
    featureCount: count,
    incomplete: truncated,
  });

  return {
    viewportState,
    viewportError: error,
    viewportCount: count,
    truncated,
    onViewportRequest,
    onViewportRejected,
  };
}
