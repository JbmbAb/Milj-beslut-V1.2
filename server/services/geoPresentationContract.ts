import type { Feature, Geometry } from 'geojson';

export const CESIUM_L0_L1_LAYER_IDS = ['water', 'ebh', 'protected_area'] as const;

export type CesiumL0L1LayerId = (typeof CESIUM_L0_L1_LAYER_IDS)[number];

export const LOGICAL_TO_ADMIT_LAYER: Record<CesiumL0L1LayerId, string> = {
  water: 'lu.water_wells',
  ebh: 'lu.ebh',
  protected_area: 'lu.protected_area',
};

export type PresentationFeatureInput = {
  readonly artifact_id: string;
  readonly content_hash: string;
  readonly layer_id: string;
  readonly layer_version: string;
  readonly provider: string;
  readonly dataset: string;
  readonly retrieved_at: string;
  readonly geometry: Geometry;
};

export type PresentationStyle = {
  readonly color: string;
  readonly title: string;
  readonly description: string;
};

const STYLE_BY_LAYER_ID: Record<CesiumL0L1LayerId, PresentationStyle> = {
  water: {
    color: '#3b82f6',
    title: 'WATER Evidens',
    description: 'Vattenrelaterad miljöevidens identifierad.',
  },
  ebh: {
    color: '#ef4444',
    title: 'EBH Evidens',
    description: 'Potentiellt förorenat område eller EBH-indikator.',
  },
  protected_area: {
    color: '#10b981',
    title: 'PROTECTED_AREA Evidens',
    description: 'Skyddat naturområde, Natura 2000 eller liknande områdesskydd.',
  },
};

export function isCesiumL0L1LayerId(value: string): value is CesiumL0L1LayerId {
  return (CESIUM_L0_L1_LAYER_IDS as readonly string[]).includes(value);
}

export function styleForLayerId(layerId: string): PresentationStyle {
  if (isCesiumL0L1LayerId(layerId)) {
    return STYLE_BY_LAYER_ID[layerId];
  }
  return {
    color: '#64748b',
    title: `${layerId.toUpperCase()} Evidens`,
    description: 'Verifierad spatial observation från LU-presentation.',
  };
}

export function contentHashToPresentationString(contentHash: unknown): string {
  if (typeof contentHash === 'string') return contentHash;
  if (!contentHash || typeof contentHash !== 'object') return '';

  const record = contentHash as Record<string, unknown>;
  if (typeof record.value === 'string') return record.value;
  if (typeof record.digest === 'string') {
    return typeof record.algorithm === 'string' ? `${record.algorithm}:${record.digest}` : record.digest;
  }
  return '';
}

export function buildWgs84PresentationFeature(input: PresentationFeatureInput): Feature {
  const style = styleForLayerId(input.layer_id);
  return {
    type: 'Feature',
    id: input.artifact_id,
    geometry: input.geometry,
    properties: {
      evidence_id: input.artifact_id,
      cas_artifact_id: input.artifact_id,
      cas_content_hash: input.content_hash,
      layer_id: input.layer_id,
      layer_version: input.layer_version,
      provider: input.provider,
      dataset: input.dataset,
      retrieved_at: input.retrieved_at,
      color: style.color,
      description: style.description,
      title: style.title,
      admit_layer_id: isCesiumL0L1LayerId(input.layer_id) ? LOGICAL_TO_ADMIT_LAYER[input.layer_id] : null,
      governance_status: 'VERIFIED_OBSERVATION',
    },
  };
}

export function assertPresentationFeatureContract(feature: unknown): string[] {
  const errors: string[] = [];
  if (!feature || typeof feature !== 'object') {
    return ['feature must be an object'];
  }

  const candidate = feature as Feature;
  const properties = candidate.properties as Record<string, unknown> | null | undefined;

  if (candidate.type !== 'Feature') errors.push('type must be Feature');
  if (!candidate.geometry) errors.push('geometry is required');
  if (!properties || typeof properties !== 'object') {
    errors.push('properties are required');
    return errors;
  }

  for (const field of [
    'evidence_id',
    'cas_artifact_id',
    'cas_content_hash',
    'layer_id',
    'layer_version',
    'provider',
    'dataset',
    'retrieved_at',
    'color',
    'description',
    'title',
  ]) {
    if (typeof properties[field] !== 'string' || !String(properties[field]).trim()) {
      errors.push(`properties.${field} is required`);
    }
  }

  const layerId = String(properties.layer_id ?? '');
  if (layerId && !isCesiumL0L1LayerId(layerId)) {
    errors.push(`properties.layer_id must be one of ${CESIUM_L0_L1_LAYER_IDS.join(', ')}`);
  }

  return errors;
}
