/**
 * MAP CONFIGURATION & STYLES
 */

export type DynamicBboxLayerKey =
  | 'climate_flood_risk'
  | 'mark_cover'
  | 'water_protection'
  | 'natura2000_area'
  | 'international_protection'
  | 'sgu_brunnar_postgis'
  | 'sgu_grundlager'
  | 'sgu_genomslapplighet'
  | 'sgu_groundwater_magazine'
  | 'sgu_groundwater_body'
  | 'sgu_jordskred_raviner'
  | 'sgu_coastal_erosion'
  | 'sgu_highest_coastline'
  | 'postgis_nvr'
  | 'postgis_lakes'
  | 'postgis_streams'
  | 'hydro_water_catchment'
  | 'postgis_property'
  | 'topo10_buildings'
  | 'topo10_mark'
  | 'topo10_vag'
  | 'topo10_vatten'
  | 'topo10_jarnvag';

export type StaticOverlayKey = 'sgu_brunnar' | 'sgu_groundwater_vulnerability' | 'raa_fornsok';

export const DYNAMIC_BBOX_LAYER_CONFIG: Record<
  DynamicBboxLayerKey,
  { endpoint: string; emptyMessage: string; label: string }
> = {
  climate_flood_risk: {
    endpoint: '/api/layers/climate.flood-risk',
    emptyMessage: 'Inga oversvamningsytor hittades i aktuell kartvy.',
    label: 'Oversvamningsrisk',
  },
  mark_cover: {
    endpoint: '/api/layers/markcover',
    emptyMessage: 'Inget marktacke hittades i aktuell kartvy.',
    label: 'Marktacke',
  },
  water_protection: {
    endpoint: '/api/layers/water-protection',
    emptyMessage: 'Inga vattenskyddsomraden hittades i aktuell kartvy.',
    label: 'Vattenskydd',
  },
  natura2000_area: {
    endpoint: '/api/layers/natura2000',
    emptyMessage: 'Inga Natura 2000-omraden hittades i aktuell kartvy.',
    label: 'Natura 2000',
  },
  international_protection: {
    endpoint: '/api/layers/international-protection',
    emptyMessage: 'Inga internationella skydd hittades i aktuell kartvy.',
    label: 'Ramsar / Varldsarv',
  },
  sgu_brunnar_postgis: {
    endpoint: '/api/layers/sgu/brunnar',
    emptyMessage: 'Inga SGU-brunnar hittades i aktuell kartvy.',
    label: 'Brunnar (PostGIS)',
  },
  sgu_grundlager: {
    endpoint: '/api/layers/sgu/grundlager',
    emptyMessage: 'SGU grundlager gav inga lokala träffar i aktuell kartvy.',
    label: 'SGU grundlager',
  },
  sgu_genomslapplighet: {
    endpoint: '/api/layers/sgu/genomslapplighet',
    emptyMessage: 'SGU genomslapplighet gav inga lokala traffar i aktuell kartvy.',
    label: 'Genomslapplighet',
  },
  sgu_groundwater_magazine: {
    endpoint: '/api/layers/sgu/grundvattenmagasin',
    emptyMessage: 'Inga SGU grundvattenmagasin hittades i aktuell kartvy.',
    label: 'Grundvattenmagasin',
  },
  sgu_groundwater_body: {
    endpoint: '/api/layers/sgu/grundvattenforekomster',
    emptyMessage: 'Inga SGU grundvattenforekomster hittades i aktuell kartvy.',
    label: 'Grundvattenforekomster',
  },
  sgu_jordskred_raviner: {
    endpoint: '/api/layers/sgu/jordskred-raviner',
    emptyMessage: 'SGU jordskred/raviner gav inga lokala träffar i aktuell kartvy.',
    label: 'SGU jordskred/raviner',
  },
  sgu_coastal_erosion: {
    endpoint: '/api/layers/sgu/kusterosion',
    emptyMessage: 'SGU kusterosion gav inga lokala träffar i aktuell kartvy.',
    label: 'SGU kusterosion',
  },
  sgu_highest_coastline: {
    endpoint: '/api/layers/sgu/hogsta-kustlinjen',
    emptyMessage: 'SGU högsta kustlinjen gav inga lokala träffar i aktuell kartvy.',
    label: 'SGU högsta kustlinjen',
  },
  postgis_nvr: {
    endpoint: '/api/layers/nvr',
    emptyMessage: 'Skyddad natur gav inga lokala träffar i aktuell kartvy.',
    label: 'Skyddad natur',
  },
  postgis_lakes: {
    endpoint: '/api/layers/hydro.lakes',
    emptyMessage: 'Inga sjöar hittades i aktuell kartvy.',
    label: 'Sjöar',
  },
  postgis_streams: {
    endpoint: '/api/layers/hydro.streams',
    emptyMessage: 'Inga vattendrag hittades i aktuell kartvy.',
    label: 'Vattendrag',
  },
  hydro_water_catchment: {
    endpoint: '/api/layers/hydro.water-catchments',
    emptyMessage: 'Inga avrinningsomraden hittades i aktuell kartvy.',
    label: 'Avrinningsomraden',
  },
  postgis_property: {
    endpoint: '/api/layers/property',
    emptyMessage: 'Inga fastighetsgränser hittades i aktuell kartvy.',
    label: 'Fastighetsgränser',
  },
  topo10_buildings: {
    endpoint: '/api/layers/topo10/buildings',
    emptyMessage: 'Inga byggnader (Topo 10) hittades i aktuell kartvy.',
    label: 'Byggnader (Topo 10)',
  },
  topo10_mark: {
    endpoint: '/api/layers/topo10/mark',
    emptyMessage: 'Ingen markanvandning (Topo 10) hittades i aktuell kartvy.',
    label: 'Markanvändning (Topo 10)',
  },
  topo10_vag: {
    endpoint: '/api/layers/topo10/vag',
    emptyMessage: 'Inga vagar (Topo 10) hittades i aktuell kartvy.',
    label: 'Vägar (Topo 10)',
  },
  topo10_vatten: {
    endpoint: '/api/layers/topo10/vatten',
    emptyMessage: 'Inget vatten (Topo 10) hittades i aktuell kartvy.',
    label: 'Vatten (Topo 10)',
  },
  topo10_jarnvag: {
    endpoint: '/api/layers/topo10/jarnvag',
    emptyMessage: 'Ingen jarnvag (Topo 10) hittades i aktuell kartvy.',
    label: 'Järnväg (Topo 10)',
  },
};

export const STATIC_OVERLAY_CONFIG: Record<StaticOverlayKey, { label: string }> = {
  sgu_brunnar: {
    label: 'Brunnar (WMS)',
  },
  sgu_groundwater_vulnerability: {
    label: 'Grundvattensarbarhet',
  },
  raa_fornsok: {
    label: 'Fornlamningar (RAA)',
  },
};

export const SGU_WELL_POINT_STYLE = {
  radius: 5,
  color: '#0f172a',
  weight: 1,
  opacity: 0.95,
  fillColor: '#06b6d4',
  fillOpacity: 0.85,
};

export function getSguGroundLayerStyle(feature: any) {
  const label = String(feature?.properties?.layer_label || '').toLowerCase();
  if (label.includes('berg')) {
    return {
      color: '#475569',
      weight: 1,
      opacity: 0.85,
      fillColor: '#94a3b8',
      fillOpacity: 0.18,
    };
  }
  return {
    color: '#92400e',
    weight: 1,
    opacity: 0.85,
    fillColor: '#f59e0b',
    fillOpacity: 0.16,
  };
}

export function getSguPermeabilityStyle(feature: any) {
  const label = String(
    feature?.properties?.permeabilityLabel || feature?.properties?.soilLabel || '',
  ).toLowerCase();
  if (label.includes('mycket lag') || label.includes('mycket låg')) {
    return { color: '#b91c1c', weight: 1, opacity: 0.82, fillColor: '#ef4444', fillOpacity: 0.28 };
  }
  if (label.includes('lag') || label.includes('låg')) {
    return { color: '#b45309', weight: 1, opacity: 0.82, fillColor: '#f59e0b', fillOpacity: 0.28 };
  }
  if (label.includes('hog') || label.includes('hög')) {
    return { color: '#047857', weight: 1, opacity: 0.82, fillColor: '#10b981', fillOpacity: 0.34 };
  }
  return { color: '#0f766e', weight: 1, opacity: 0.78, fillColor: '#99f6e4', fillOpacity: 0.24 };
}

export function getSguLandslideStyle(feature: any) {
  const label = String(feature?.properties?.feature_label || '').toLowerCase();
  if (label.includes('skredväg')) return { color: '#dc2626', weight: 3, opacity: 0.95 };
  if (label.includes('skredärr')) return { color: '#b91c1c', weight: 3, opacity: 0.95, dashArray: '6,4' };
  if (label.includes('ravin')) return { color: '#a16207', weight: 2, opacity: 0.9 };
  return { color: '#7c3aed', weight: 2, opacity: 0.85 };
}

export function getSguCoastalErosionStyle(feature: any) {
  const label = String(feature?.properties?.layerLabel || feature?.properties?.layer_label || '').toLowerCase();
  if (label.includes('aktiv erosion')) {
    return { color: '#be123c', weight: 3, opacity: 0.96, fillColor: '#fb7185', fillOpacity: 0.22 };
  }
  if (label.includes('prognos') || label.includes('erosionsforhallande')) {
    return { color: '#ea580c', weight: 2, opacity: 0.9, fillColor: '#fdba74', fillOpacity: 0.18 };
  }
  if (label.includes('skydd')) {
    return { color: '#0891b2', weight: 2, opacity: 0.9, fillColor: '#67e8f9', fillOpacity: 0.2 };
  }
  if (label.includes('material')) {
    return { color: '#7c2d12', weight: 1, opacity: 0.82, fillColor: '#d6d3d1', fillOpacity: 0.28 };
  }
  if (label.includes('dynamik') || label.includes('transport')) {
    return { color: '#0f766e', weight: 2, opacity: 0.88, dashArray: '6,4', fillColor: '#5eead4', fillOpacity: 0.14 };
  }
  return { color: '#155e75', weight: 2, opacity: 0.84, fillColor: '#22d3ee', fillOpacity: 0.16 };
}

export const SGU_COASTAL_EROSION_POINT_STYLE = {
  radius: 5,
  color: '#881337',
  weight: 1,
  opacity: 0.95,
  fillColor: '#fb7185',
  fillOpacity: 0.86,
};

export function getSguHighestCoastlineStyle(feature: any) {
  const label = String(feature?.properties?.layerLabel || feature?.properties?.layer_label || '').toLowerCase();
  if (label.includes('punkt')) {
    return { color: '#581c87', weight: 1, opacity: 0.9, fillColor: '#c084fc', fillOpacity: 0.85 };
  }
  return {
    color: '#4c1d95',
    weight: 2,
    opacity: 0.88,
    fillColor: '#a78bfa',
    fillOpacity: 0.16,
    dashArray: '8,5',
  };
}

export const SGU_HIGHEST_COASTLINE_POINT_STYLE = {
  radius: 5,
  color: '#4c1d95',
  weight: 1,
  opacity: 0.95,
  fillColor: '#c084fc',
  fillOpacity: 0.86,
};

export const POSTGIS_NVR_STYLE = {
  color: '#ff7800',
  weight: 2,
  opacity: 0.7,
  fillColor: '#ff7800',
  fillOpacity: 0.2,
};

export const POSTGIS_LAKES_STYLE = {
  color: '#3b82f6',
  weight: 1,
  opacity: 0.8,
  fillColor: '#60a5fa',
  fillOpacity: 0.5,
};

export const POSTGIS_STREAMS_STYLE = {
  color: '#0284c7',
  weight: 2,
  opacity: 0.9,
};

export const POSTGIS_PROPERTY_STYLE = {
  color: '#334155',
  weight: 1,
  opacity: 0.75,
  fillOpacity: 0,
};

export const FLOOD_RISK_STYLE = {
  color: '#dc2626',
  weight: 2,
  opacity: 0.85,
  fillColor: '#f97316',
  fillOpacity: 0.18,
};

export const WATER_PROTECTION_STYLE = {
  color: '#0f766e',
  weight: 2,
  opacity: 0.85,
  fillColor: '#14b8a6',
  fillOpacity: 0.18,
};

export const NATURA2000_STYLE = {
  color: '#166534',
  weight: 2,
  opacity: 0.9,
  fillColor: '#4ade80',
  fillOpacity: 0.18,
};

export const INTERNATIONAL_PROTECTION_STYLE = {
  color: '#6d28d9',
  weight: 2,
  opacity: 0.9,
  fillColor: '#a78bfa',
  fillOpacity: 0.18,
};

export const SGU_GROUNDWATER_MAGAZINE_STYLE = {
  color: '#1d4ed8',
  weight: 2,
  opacity: 0.82,
  fillColor: '#60a5fa',
  fillOpacity: 0.18,
};

export const SGU_GROUNDWATER_BODY_STYLE = {
  color: '#4338ca',
  weight: 2,
  opacity: 0.78,
  fillColor: '#818cf8',
  fillOpacity: 0.14,
};

export const WATER_CATCHMENT_STYLE = {
  color: '#0369a1',
  weight: 1,
  opacity: 0.72,
  fillColor: '#7dd3fc',
  fillOpacity: 0.1,
  dashArray: '6,4',
};

export function getMarkCoverStyle(feature: any) {
  const label = String(feature?.properties?.description || '').toLowerCase();
  if (label.includes('vatten') || label.includes('hav')) {
    return { color: '#0284c7', weight: 1, opacity: 0.8, fillColor: '#38bdf8', fillOpacity: 0.45 };
  }
  if (label.includes('våtmark') || label.includes('vatmark')) {
    return { color: '#0f766e', weight: 1, opacity: 0.8, fillColor: '#2dd4bf', fillOpacity: 0.35 };
  }
  if (label.includes('jordbruk')) {
    return { color: '#a16207', weight: 1, opacity: 0.8, fillColor: '#facc15', fillOpacity: 0.35 };
  }
  if (label.includes('bebyggelse') || label.includes('infrastruktur')) {
    return { color: '#475569', weight: 1, opacity: 0.8, fillColor: '#94a3b8', fillOpacity: 0.35 };
  }
  return { color: '#166534', weight: 1, opacity: 0.8, fillColor: '#4ade80', fillOpacity: 0.28 };
}

export const TOPO10_BUILDINGS_STYLE = {
  color: '#334155',
  weight: 1,
  opacity: 0.9,
  fillColor: '#64748b',
  fillOpacity: 0.6,
};

export const TOPO10_MARK_STYLE = {
  color: '#166534',
  weight: 0.5,
  opacity: 0.5,
  fillColor: '#86efac',
  fillOpacity: 0.2,
};

export const TOPO10_VAG_STYLE = {
  color: '#f8fafc',
  weight: 2,
  opacity: 1,
};

export const TOPO10_VATTEN_STYLE = {
  color: '#0ea5e9',
  weight: 1,
  opacity: 1,
  fillColor: '#bae6fd',
  fillOpacity: 0.4,
};

export const TOPO10_JARNVAG_STYLE = {
  color: '#475569',
  weight: 2,
  dashArray: '5, 5',
  opacity: 1,
};
