/**
 * Presentation HUD mapping: UI logical layer_id → Admit v1 contract layer_id.
 * Cesium never owns spatial truth — this is display/provenance only.
 */

export const LOGICAL_TO_ADMIT_LAYER: Record<string, string> = {
  water: 'lu.water_wells',
  ebh: 'lu.ebh',
  protected_area: 'lu.protected_area',
};

export function admitLayerIdForLogical(layerId: string | undefined | null): string | null {
  if (!layerId) return null;
  return LOGICAL_TO_ADMIT_LAYER[layerId] ?? null;
}
