/**
 * Presentation loading state machine for the Cesium map front.
 * EMPTY ≠ “no evidence in the world” — it means the current presentation product returned
 * zero features for the active query/viewport. UNAVAILABLE means the seam/product itself
 * cannot serve (missing governed data, provider down). INCOMPLETE means a partial product.
 */

export const MAPFRONT_LOADING_STATES = [
  'IDLE',
  'LOADING',
  'READY',
  'EMPTY',
  'INCOMPLETE',
  'ERROR',
  'UNAVAILABLE',
] as const;

export type MapfrontLoadingState = (typeof MAPFRONT_LOADING_STATES)[number];

export type MapfrontStateReason = {
  readonly code: string;
  readonly messageSv: string;
  readonly retryable: boolean;
};

export function deriveFeatureCollectionState(input: {
  readonly loading: boolean;
  readonly error?: MapfrontStateReason | null;
  readonly unavailable?: boolean;
  readonly featureCount: number | null;
  readonly incomplete?: boolean;
}): MapfrontLoadingState {
  if (input.loading) return 'LOADING';
  if (input.error) return 'ERROR';
  if (input.unavailable) return 'UNAVAILABLE';
  if (input.featureCount === null) return 'IDLE';
  if (input.incomplete) return 'INCOMPLETE';
  if (input.featureCount === 0) return 'EMPTY';
  return 'READY';
}

export function mapfrontStateLabelSv(state: MapfrontLoadingState): string {
  switch (state) {
    case 'IDLE':
      return 'Viloläge';
    case 'LOADING':
      return 'Laddar';
    case 'READY':
      return 'Klar';
    case 'EMPTY':
      return 'Tom presentation';
    case 'INCOMPLETE':
      return 'Ofullständigt underlag';
    case 'ERROR':
      return 'Tekniskt fel';
    case 'UNAVAILABLE':
      return 'Otillgängligt';
    default: {
      const _exhaustive: never = state;
      return _exhaustive;
    }
  }
}
