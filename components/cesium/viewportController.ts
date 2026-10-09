import type { Viewer } from 'cesium';
import { formatBboxQuery, getViewportBoundsWgs84, type Wgs84ViewportBounds } from './cameraHelpers';

export type ViewportRequest = {
  readonly generation: number;
  readonly bounds: Wgs84ViewportBounds;
  readonly bbox: string;
  readonly signal: AbortSignal;
};

export type ViewportControllerOptions = {
  readonly debounceMs?: number;
  readonly maxSpanDegrees?: number;
  readonly onRequest: (request: ViewportRequest) => void | Promise<void>;
  readonly onRejected?: (reason: string) => void;
};

/**
 * Camera moveEnd → debounced viewport bounds → caller issues presentation request.
 * Latest generation wins; AbortController cancels in-flight fetches.
 * Client never expands query authority beyond the visible rectangle (capped span).
 */
export class ViewportController {
  private readonly viewer: Viewer;
  private readonly debounceMs: number;
  private readonly maxSpanDegrees: number;
  private readonly onRequest: ViewportControllerOptions['onRequest'];
  private readonly onRejected: ViewportControllerOptions['onRejected'];
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private generation = 0;
  private abortController: AbortController | null = null;
  private removeListener: (() => void) | null = null;
  private destroyed = false;

  constructor(viewer: Viewer, options: ViewportControllerOptions) {
    this.viewer = viewer;
    this.debounceMs = options.debounceMs ?? 350;
    this.maxSpanDegrees = options.maxSpanDegrees ?? 2.5;
    this.onRequest = options.onRequest;
    this.onRejected = options.onRejected;
  }

  start(): void {
    if (this.destroyed || this.removeListener) return;
    const handler = () => this.schedule();
    this.viewer.camera.moveEnd.addEventListener(handler);
    this.removeListener = () => {
      this.viewer.camera.moveEnd.removeEventListener(handler);
    };
    this.schedule();
  }

  stop(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    this.abortInFlight();
    if (this.removeListener) {
      this.removeListener();
      this.removeListener = null;
    }
  }

  destroy(): void {
    this.destroyed = true;
    this.stop();
  }

  /** Force an immediate request (e.g. after layer toggle). */
  requestNow(): void {
    if (this.destroyed) return;
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    this.fire();
  }

  private schedule(): void {
    if (this.destroyed) return;
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      this.fire();
    }, this.debounceMs);
  }

  private abortInFlight(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  private fire(): void {
    if (this.destroyed) return;
    const bounds = getViewportBoundsWgs84(this.viewer);
    if (!bounds) {
      this.onRejected?.('viewport_unavailable');
      return;
    }
    const spanLng = Math.abs(bounds.east - bounds.west);
    const spanLat = Math.abs(bounds.north - bounds.south);
    if (spanLng > this.maxSpanDegrees || spanLat > this.maxSpanDegrees) {
      this.onRejected?.('viewport_too_large');
      this.abortInFlight();
      return;
    }

    this.abortInFlight();
    const generation = ++this.generation;
    const abortController = new AbortController();
    this.abortController = abortController;
    void this.onRequest({
      generation,
      bounds,
      bbox: formatBboxQuery(bounds),
      signal: abortController.signal,
    });
  }

  isCurrent(generation: number): boolean {
    return !this.destroyed && generation === this.generation;
  }
}
