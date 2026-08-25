/**
 * SPATIAL_COORDINATE_ORDER_DEFECT_01 — the single place the SWEREF99 TM source/canonical
 * coordinate reordering happens.
 *
 * propertyUnitService.centroidSweref99Tm is `[ST_X, ST_Y]` = `[easting, northing]` (source
 * order). LUPropertyContextArtifact.payload.coordinates is documented and consumed
 * (SpatialProviderPostGIS.query()) as `[northing, easting]`. This function is the one producer
 * boundary that performs that reordering — deliberately explicit, not inferred from numeric
 * ranges, so a future accidental correct-order source can never silently re-trigger the swap.
 */
export function centroidToCanonicalCoordinates(
  centroidSweref99TmEastingNorthing: readonly [number, number],
): readonly [number, number] {
  const [easting, northing] = centroidSweref99TmEastingNorthing;
  return [northing, easting];
}
