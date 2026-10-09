import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import type { CesiumAdapter } from './CesiumAdapter';
import { deriveFeatureCollectionState, type MapfrontLoadingState, type MapfrontStateReason } from './loadingState';
import { fetchViewportPresentation } from './mapPresentationClient';
import type { ViewportRequest } from './viewportController';

/**
 * Viewport-driven property presentation loading (latest wins, abort stale).
 * Exploration / foundation mode only — productMode LU evidence stays workspace-owned.
 *
 * React presentation state (loading/error/count/empty) is generation-owned:
 * only the current generation may commit UI state, independent of AbortController success.
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
  const mountedRef = useRef(true);
  const activeGenerationRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const ownsUi = (generation: number, adapter: CesiumAdapter | null): boolean =>
    mountedRef.current &&
    adapter !== null &&
    !adapter.isDestroyed() &&
    adapter.isViewportCurrent(generation) &&
    activeGenerationRef.current === generation;

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

    activeGenerationRef.current = request.generation;
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

      if (!ownsUi(request.generation, adapter)) return;

      const n = await adapter.setViewportPropertyFeatures(collection, request.generation);

      if (!ownsUi(request.generation, adapter)) return;

      setCount(n);
      setTruncated(Boolean(collection.meta?.truncated));
      setError(null);
    } catch (err) {
      if (!ownsUi(request.generation, adapter)) return;
      const message = err instanceof Error ? err.message : 'Viewport-presentation misslyckades';
      setError({ code: 'viewport_fetch_failed', messageSv: message, retryable: true });
      setCount(0);
    } finally {
      if (ownsUi(request.generation, input.adapterRef.current)) {
        setLoading(false);
      }
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
