/**
 * Allowed LU layers → PostGIS tables (SWEREF99 TM / EPSG:3006).
 * Unknown layers fail closed at the provider.
 */
export interface SpatialLayerBinding {
  readonly logical_name: string;
  readonly table: string;
  readonly provider: string;
  /** Prefer GiST on geom — verified via EXPLAIN in ops, not invented here. */
  readonly geom_column: "geom";
}

export const SPATIAL_LAYER_REGISTRY: Readonly<Record<string, SpatialLayerBinding>> =
  Object.freeze({
    water: Object.freeze({
      logical_name: "water",
      table: "env.sgu_well",
      provider: "SGU",
      geom_column: "geom" as const,
    }),
    ebh: Object.freeze({
      logical_name: "ebh",
      table: "env.ebh_potentiellt_fororenade_omraden",
      provider: "Länsstyrelsen",
      geom_column: "geom" as const,
    }),
    protected_area: Object.freeze({
      logical_name: "protected_area",
      table: "env.protected_area",
      provider: "Naturvårdsverket",
      geom_column: "geom" as const,
    }),
  });

export function resolveLayerBinding(layerName: string): SpatialLayerBinding {
  const binding = SPATIAL_LAYER_REGISTRY[layerName];
  if (!binding) {
    throw new Error(
      `REJECT_SPATIAL_LAYER: layer "${layerName}" is not in SpatialLayerRegistry`,
    );
  }
  return binding;
}
