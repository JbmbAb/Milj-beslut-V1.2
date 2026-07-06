export interface LayerConfig {
  schema: string;
  table: string;
  geomColumn: string;
  idColumn: string;
  properties: string[];
  minZoom: number;
  maxZoom: number;
  simplifyZoom?: number;
  simplifyTolerance?: number;
  style?: Record<string, any>;
}

export const layers: Record<string, LayerConfig> = {
  byggnad: {
    schema: 'topo10',
    table: 'byggnad',
    geomColumn: 'geom',
    idColumn: 'fid',
    properties: ['objekttyp', 'andamal1'],
    minZoom: 15,
    maxZoom: 22,
    simplifyZoom: 16,
    simplifyTolerance: 2,
    style: { fillColor: '#666', fillOpacity: 0.75, color: '#444', weight: 0.4, fill: true }
  },
  fastighet: {
    schema: 'env',
    table: 'registerenhetsomradesytor',
    geomColumn: 'geom',
    idColumn: 'fid',
    properties: ['objekttyp', 'trakt'],
    minZoom: 13,
    maxZoom: 22,
    style: { color: '#444', weight: 0.8, fill: false }
  },
  nmd: {
    schema: 'public',
    table: 'nmd2018_bas_ge',
    geomColumn: 'geom',
    idColumn: 'gid',
    properties: ['klass'],
    minZoom: 12,
    maxZoom: 22,
    simplifyZoom: 14,
    simplifyTolerance: 5,
    style: { color: '#3388ff', weight: 1 }
  }
};
