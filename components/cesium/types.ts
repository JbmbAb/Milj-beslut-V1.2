export type CesiumEvidenceMode = 'fixture' | 'live';

export type CesiumEvidenceLayerKey = 'water' | 'ebh' | 'protected_area';

export type CesiumEvidenceLayerConfig = {
  readonly key: CesiumEvidenceLayerKey;
  readonly label: string;
  readonly provider: string;
  readonly color: string;
};

export type CesiumEvidenceMeta = {
  readonly presentation?: string;
  readonly source?: CesiumEvidenceMode;
  readonly scene_id?: string;
  readonly srid?: number;
  readonly governance_status?: string;
  readonly feature_count?: number;
  readonly property_id?: string;
  readonly search_radius_meters?: number;
  readonly queried_at?: string;
  readonly center?: {
    readonly lat: number;
    readonly lng: number;
  };
};

export const CESIUM_EVIDENCE_LAYERS: readonly CesiumEvidenceLayerConfig[] = [
  {
    key: 'water',
    label: 'Vattenbrunn',
    provider: 'SGU',
    color: '#3b82f6',
  },
  {
    key: 'ebh',
    label: 'EBH-områden',
    provider: 'Länsstyrelsen',
    color: '#ef4444',
  },
  {
    key: 'protected_area',
    label: 'Natura / skydd',
    provider: 'Naturvårdsverket',
    color: '#10b981',
  },
];
