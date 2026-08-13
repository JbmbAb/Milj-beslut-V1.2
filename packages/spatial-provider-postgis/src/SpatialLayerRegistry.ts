/**
 * Allowed LU layers → PostGIS tables (SWEREF99 TM / EPSG:3006).
 * Unknown layers fail closed at the provider.
 */
export interface SpatialLayerBinding {
  readonly logical_name: string;
  readonly table: string;
  readonly provider: string;
  /**
   * P4A-LU-S4 — authoritative identity of the governed source/dataset artifact that
   * materialized this PostGIS layer. This must be a SHA-256 content hash, never a label such as
   * "v1", a table name, or an import date.
   *
   * @see docs/architecture/admit-v1/LAYER-ID-CONTRACTS-V1.md
   */
  readonly version_hash: string;
  /** Prefer GiST on geom — verified via EXPLAIN in ops, not invented here. */
  readonly geom_column: "geom";
}

export const SPATIAL_LAYER_REGISTRY: Readonly<Record<string, SpatialLayerBinding>> =
  Object.freeze({
    water: Object.freeze({
      logical_name: "water",
      table: "env.sgu_well",
      provider: "SGU",
      version_hash: "2b4b514f8b18a1a614d9aeac75c32eff8c52a3864c54770be112fd88fa263ddc",
      geom_column: "geom" as const,
    }),
    ebh: Object.freeze({
      logical_name: "ebh",
      table: "env.ebh_potentiellt_fororenade_omraden",
      provider: "Länsstyrelsen",
      version_hash: "02fccffc07abaaf1775c8333d660fa60fdecea0c3bb664335892764c8486d186",
      geom_column: "geom" as const,
    }),
    protected_area: Object.freeze({
      logical_name: "protected_area",
      table: "env.protected_area",
      provider: "Naturvårdsverket",
      version_hash: "983772bf129d14326c43aa5d08f152e65604778d392c28ea4fee0c4e838af9ae",
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
