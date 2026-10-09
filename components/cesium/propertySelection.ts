import { Color, Entity, type DataSource } from 'cesium';

export type PropertyIdentityRef = {
  readonly feature_ref?: string;
  readonly sourceKey?: string;
  readonly designation?: string;
  readonly id?: string | number;
};

/**
 * Stable property identity is never the geometry object itself.
 * Prefer feature_ref / sourceKey / Feature.id over coordinate fingerprints.
 */
export function resolvePropertyIdentity(properties: Record<string, unknown> | null | undefined, featureId?: unknown): string | null {
  if (properties && typeof properties.feature_ref === 'string' && properties.feature_ref.trim()) {
    return properties.feature_ref.trim();
  }
  if (properties && typeof properties.sourceKey === 'string' && properties.sourceKey.trim()) {
    return `sourceKey:${properties.sourceKey.trim()}`;
  }
  if (typeof featureId === 'string' || typeof featureId === 'number') {
    return `feature:${featureId}`;
  }
  if (properties && typeof properties.designation === 'string' && properties.designation.trim()) {
    return `designation:${properties.designation.trim()}`;
  }
  return null;
}

export function highlightPropertyEntity(
  dataSource: DataSource | null,
  identity: string | null,
): Entity | null {
  if (!dataSource || !identity) return null;
  let matched: Entity | null = null;
  for (const entity of dataSource.entities.values) {
    const props: Record<string, unknown> = {};
    if (entity.properties) {
      entity.properties.propertyNames.forEach((name) => {
        props[name] = entity.properties![name]?.getValue();
      });
    }
    const entityIdentity = resolvePropertyIdentity(props, entity.id);
    const selected = entityIdentity === identity;
    entity.show = true;
    if (entity.polygon) {
      entity.polygon.material = (selected ? Color.YELLOW.withAlpha(0.45) : Color.CYAN.withAlpha(0.15)) as any;
      entity.polygon.outlineColor = (selected ? Color.YELLOW : Color.CYAN) as any;
      entity.polygon.outlineWidth = (selected ? 4 : 2) as any;
    }
    if (selected) matched = entity;
  }
  return matched;
}
