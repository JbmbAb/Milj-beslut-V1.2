/**
 * CESIUM-CANONICAL-SPATIAL-PRESENTATION-3D-V1 — request validation, feature budget and error model
 * for the canonical presentation boundary.
 *
 * The governing rule is that a failure must never arrive at the viewer disguised as a successful
 * empty result. "No features here" and "the query blew its budget" and "your bounds were garbage"
 * are three different facts, and a viewer that cannot tell them apart will silently show an empty
 * map over a broken backend. Every function here therefore fails closed with a named code.
 */

/**
 * Explicit presentation failure taxonomy.
 *
 * EMPTY is deliberately part of the SUCCESS vocabulary rather than an error — it is a real answer.
 * It appears here only so callers can name it; it is never thrown.
 */
export type SpatialPresentationErrorCode =
  | 'UNAVAILABLE'
  | 'BUDGET_EXCEEDED'
  | 'INVALID_BOUNDS'
  | 'UNSUPPORTED_LAYER'
  | 'QUERY_FAILED'
  | 'STALE_RESPONSE'
  | 'PROJECTION_FAILED';

export type SpatialPresentationOutcome = 'OK' | 'EMPTY';

export class SpatialPresentationError extends Error {
  readonly code: SpatialPresentationErrorCode;
  readonly detail: string;

  constructor(code: SpatialPresentationErrorCode, detail: string) {
    super(`REJECT_SPATIAL_PRESENTATION[${code}]: ${detail}`);
    this.name = 'SpatialPresentationError';
    this.code = code;
    this.detail = detail;
  }
}

export function isSpatialPresentationError(error: unknown): error is SpatialPresentationError {
  return error instanceof SpatialPresentationError;
}

/**
 * HTTP mapping. 422 for a well-formed request the server refuses to answer (bad bounds, unknown
 * layer, over budget) versus 5xx for a server-side failure — so a client can distinguish "fix your
 * request" from "the backend is broken" without parsing prose.
 */
export function httpStatusForPresentationError(code: SpatialPresentationErrorCode): number {
  switch (code) {
    case 'INVALID_BOUNDS':
    case 'UNSUPPORTED_LAYER':
    case 'BUDGET_EXCEEDED':
      return 422;
    case 'STALE_RESPONSE':
      return 409;
    case 'UNAVAILABLE':
      return 503;
    case 'QUERY_FAILED':
    case 'PROJECTION_FAILED':
      return 500;
  }
}

/** Bounding box in the CANONICAL query CRS, SWEREF99 TM / EPSG:3006. */
export interface PresentationBoundingBox {
  readonly minEasting: number;
  readonly minNorthing: number;
  readonly maxEasting: number;
  readonly maxNorthing: number;
  readonly srid: 3006;
}

/**
 * Generous envelope around the SWEREF99 TM valid area for Sweden. This is a sanity guard against a
 * transposed or unit-confused bbox (the classic lat/lon-swapped or degrees-instead-of-metres bug),
 * not a precise national boundary. The runtime is Sweden-only, so a request far outside this window
 * is a bug in the caller rather than a legitimate query, and answering it would mean an unbounded
 * scan for guaranteed-zero rows.
 */
const SWEREF99TM_EXTENT = {
  minEasting: 180_000,
  maxEasting: 1_090_000,
  minNorthing: 6_090_000,
  maxNorthing: 7_700_000,
} as const;

/** Refuse a window so large it is effectively a national table scan. */
const MAX_BBOX_SPAN_METERS = 400_000;

function finiteNumber(value: unknown, name: string): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    throw new SpatialPresentationError('INVALID_BOUNDS', `${name} must be a finite number`);
  }
  return parsed;
}

/**
 * Parses and validates a viewport bbox in EPSG:3006. Fails closed on anything malformed,
 * degenerate, inverted, out of the Swedish extent, or larger than the maximum span.
 *
 * Accepts the four values in the conventional GIS order [minX, minY, maxX, maxY].
 */
export function parsePresentationBoundingBox(input: {
  readonly minEasting: unknown;
  readonly minNorthing: unknown;
  readonly maxEasting: unknown;
  readonly maxNorthing: unknown;
  readonly srid?: unknown;
}): PresentationBoundingBox {
  if (input.srid !== undefined && Number(input.srid) !== 3006) {
    throw new SpatialPresentationError(
      'INVALID_BOUNDS',
      `bbox srid must be 3006 (canonical query CRS), got ${String(input.srid)}`,
    );
  }

  const minEasting = finiteNumber(input.minEasting, 'minEasting');
  const minNorthing = finiteNumber(input.minNorthing, 'minNorthing');
  const maxEasting = finiteNumber(input.maxEasting, 'maxEasting');
  const maxNorthing = finiteNumber(input.maxNorthing, 'maxNorthing');

  if (maxEasting <= minEasting || maxNorthing <= minNorthing) {
    throw new SpatialPresentationError(
      'INVALID_BOUNDS',
      'bbox must be non-degenerate with max strictly greater than min on both axes',
    );
  }

  if (
    minEasting < SWEREF99TM_EXTENT.minEasting ||
    maxEasting > SWEREF99TM_EXTENT.maxEasting ||
    minNorthing < SWEREF99TM_EXTENT.minNorthing ||
    maxNorthing > SWEREF99TM_EXTENT.maxNorthing
  ) {
    throw new SpatialPresentationError(
      'INVALID_BOUNDS',
      'bbox lies outside the SWEREF99 TM extent for Sweden; check axis order and units (metres, not degrees)',
    );
  }

  const spanEasting = maxEasting - minEasting;
  const spanNorthing = maxNorthing - minNorthing;
  if (spanEasting > MAX_BBOX_SPAN_METERS || spanNorthing > MAX_BBOX_SPAN_METERS) {
    throw new SpatialPresentationError(
      'INVALID_BOUNDS',
      `bbox span exceeds ${MAX_BBOX_SPAN_METERS} m; zoom in rather than requesting a national extent`,
    );
  }

  return { minEasting, minNorthing, maxEasting, maxNorthing, srid: 3006 };
}

export const DEFAULT_PRESENTATION_FEATURE_BUDGET = 2_000;

/**
 * Enforces the feature budget EXPLICITLY. It throws rather than truncating, because a silently
 * truncated FeatureCollection is indistinguishable from a complete one at the viewer — the map
 * looks fine and quietly lies about coverage.
 *
 * Callers query with LIMIT budget + 1 so that overflow is detectable at all.
 */
export function enforceFeatureBudget(
  featureCount: number,
  budget: number = DEFAULT_PRESENTATION_FEATURE_BUDGET,
): void {
  if (!Number.isInteger(budget) || budget <= 0) {
    throw new SpatialPresentationError(
      'QUERY_FAILED',
      `feature budget must be a positive integer, got ${budget}`,
    );
  }
  if (featureCount > budget) {
    throw new SpatialPresentationError(
      'BUDGET_EXCEEDED',
      `query produced ${featureCount} features which exceeds the budget of ${budget}; narrow the viewport`,
    );
  }
}

/**
 * Monotonic request sequencing for viewport-driven loading.
 *
 * A camera that moves faster than the network will have several requests in flight, and they can
 * complete out of order. Without this, an older response overwrites a newer one and the map shows
 * the wrong extent's data with no error anywhere. Callers record the sequence they issued and drop
 * any response that is not the newest.
 */
export function isStalePresentationResponse(responseSequence: number, latestIssuedSequence: number): boolean {
  return responseSequence < latestIssuedSequence;
}

export function assertNotStalePresentationResponse(
  responseSequence: number,
  latestIssuedSequence: number,
): void {
  if (isStalePresentationResponse(responseSequence, latestIssuedSequence)) {
    throw new SpatialPresentationError(
      'STALE_RESPONSE',
      `response for sequence ${responseSequence} superseded by ${latestIssuedSequence}`,
    );
  }
}
