/**
 * ADR-CESIUM-HEIGHT-REFERENCE-CONTRACT (presentation seam).
 *
 * Height / vertical reference for national governed 3D is NOT decided for production.
 * Cesium must not invent RH2000 / geoid / orthometric semantics.
 *
 * Until an owner decision admits a vertical CRS + geoid model for presentation products,
 * the map front uses an explicit, named fallback only:
 *   CESIUM_HEIGHT_MODE = 'ELLIPSOID_WGS84_PRESENTATION_ONLY'
 *
 * This is presentation behavior, never spatial or decision authority.
 */

export const CESIUM_HEIGHT_CONTRACT_ID = 'cesium.height-reference.v0' as const;

export const CESIUM_HEIGHT_MODES = [
  'ELLIPSOID_WGS84_PRESENTATION_ONLY',
  'GOVERNED_VERTICAL_CRS_PENDING',
] as const;

export type CesiumHeightMode = (typeof CESIUM_HEIGHT_MODES)[number];

export type CesiumHeightReferenceContract = {
  readonly contract_id: typeof CESIUM_HEIGHT_CONTRACT_ID;
  readonly mode: CesiumHeightMode;
  readonly vertical_crs: null;
  readonly geoid_model: null;
  readonly owner_decision: 'UNDECIDED';
  readonly note: string;
};

export const ACTIVE_CESIUM_HEIGHT_REFERENCE: CesiumHeightReferenceContract = {
  contract_id: CESIUM_HEIGHT_CONTRACT_ID,
  mode: 'ELLIPSOID_WGS84_PRESENTATION_ONLY',
  vertical_crs: null,
  geoid_model: null,
  owner_decision: 'UNDECIDED',
  note:
    'National height/geoid presentation binding is blocked by architecture decision. ' +
    'Client uses WGS84 ellipsoid heights for visualization only.',
};

export function assertPresentationHeightMode(mode: CesiumHeightMode): void {
  if (mode === 'GOVERNED_VERTICAL_CRS_PENDING') {
    throw new Error(
      'GOVERNED_VERTICAL_CRS_PENDING is a seam marker, not an executable height mode. ' +
        'Use ELLIPSOID_WGS84_PRESENTATION_ONLY until an owner decision admits a vertical CRS.',
    );
  }
}
