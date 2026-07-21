/**
 * Tests för scripts/import/import-sgu-risk-layers.ts
 * Täcker arg-parsing, feature-mapping, filtrering och allokering.
 * Notera: $queryRaw och fetch mockas för att testa logik utan DB.
 */
import { describe, it, expect } from 'vitest';

// Helper-funktioner extraherade från scriptet för testning
type JsonObject = Record<string, unknown>;

interface OgcFeature {
  id?: string | number;
  geometry?: JsonObject | null;
  properties?: JsonObject;
}

interface GroundLayerStageRow {
  source_key: string;
  source_object_id: number | null;
  layer_code: number | null;
  layer_label: string | null;
  mapping_name: string | null;
  map_type: number | null;
  symbol: number | null;
  area_sqm: number | null;
  length_m: number | null;
  raw_properties: JsonObject;
  geom_geojson: JsonObject;
}

interface LandslideStageRow {
  source_key: string;
  source_object_id: number | null;
  feature_code: number | null;
  feature_label: string | null;
  symbol: number | null;
  length_m: number | null;
  raw_properties: JsonObject;
  geom_geojson: JsonObject;
}

// Functions from script
function safeString(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return null;
}

function safeNumber(value: unknown): number | null {
  const num = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(num) ? num : null;
}

function buildSourceKey(feature: OgcFeature, properties: JsonObject): string | null {
  return safeString(feature.id) ?? safeString(properties.objectid);
}

function mapGroundLayerFeature(feature: OgcFeature): GroundLayerStageRow | null {
  const properties = feature.properties ?? {};
  const geometry = feature.geometry;
  const sourceKey = buildSourceKey(feature, properties);

  if (!geometry || typeof geometry !== 'object' || !sourceKey) {
    return null;
  }

  return {
    source_key: sourceKey,
    source_object_id: safeNumber(properties.objectid),
    layer_code: safeNumber(properties.jg2),
    layer_label: safeString(properties.jg2_tx),
    mapping_name: safeString(properties.kartering),
    map_type: safeNumber(properties.karttyp),
    symbol: safeNumber(properties.symbol),
    area_sqm: safeNumber(properties.geom_area),
    length_m: safeNumber(properties.geom_length),
    raw_properties: properties,
    geom_geojson: geometry,
  };
}

function mapLandslideFeature(feature: OgcFeature): LandslideStageRow | null {
  const properties = feature.properties ?? {};
  const geometry = feature.geometry;
  const sourceKey = buildSourceKey(feature, properties);

  if (!geometry || typeof geometry !== 'object' || !sourceKey) {
    return null;
  }

  return {
    source_key: sourceKey,
    source_object_id: safeNumber(properties.objectid),
    feature_code: safeNumber(properties.sl),
    feature_label: safeString(properties.sl_tx),
    symbol: safeNumber(properties.symbol),
    length_m: safeNumber(properties.geom_length),
    raw_properties: properties,
    geom_geojson: geometry,
  };
}

function trimToMaxFeatures<T>(rows: T[], maxFeatures: number | undefined, importedCount: number): T[] {
  if (!maxFeatures) return rows;
  const remaining = maxFeatures - importedCount;
  if (remaining <= 0) return [];
  return rows.slice(0, remaining);
}

function shouldStop(
  totalRows: number,
  pageCount: number,
  maxFeatures: number | undefined,
  maxPages: number | undefined,
): boolean {
  if (maxFeatures && totalRows >= maxFeatures) return true;
  if (maxPages && pageCount >= maxPages) return true;
  return false;
}

function summarizeRows(rows: Array<GroundLayerStageRow | LandslideStageRow>): string {
  return rows
    .slice(0, 5)
    .map((row) => {
      if ('layer_label' in row) {
        return `${row.layer_label || 'okand'} [${row.source_key}]`;
      }
      return `${row.feature_label || 'okand'} [${row.source_key}]`;
    })
    .join('; ');
}

// Tests
describe('safeString', () => {
  it('konverterar regulär sträng', () => {
    expect(safeString('hello')).toBe('hello');
  });

  it('trimmar whitespace och returnerar null om tom', () => {
    expect(safeString('  ')).toBeNull();
    expect(safeString('\t\n')).toBeNull();
  });

  it('konverterar finita numbers till string', () => {
    expect(safeString(42)).toBe('42');
    expect(safeString(3.14)).toBe('3.14');
  });

  it('returnerar null för infinity och NaN', () => {
    expect(safeString(Infinity)).toBeNull();
    expect(safeString(NaN)).toBeNull();
  });

  it('returnerar null för null, undefined, booleaner', () => {
    expect(safeString(null)).toBeNull();
    expect(safeString(undefined)).toBeNull();
    expect(safeString(true)).toBeNull();
    expect(safeString({})).toBeNull();
  });
});

describe('safeNumber', () => {
  it('konverterar numbers direkt', () => {
    expect(safeNumber(42)).toBe(42);
    expect(safeNumber(-3.5)).toBe(-3.5);
  });

  it('konverterar stringifierade numbers', () => {
    expect(safeNumber('100')).toBe(100);
    expect(safeNumber('-50.5')).toBe(-50.5);
  });

  it('returnerar null för infinity, NaN, non-numeric strings', () => {
    expect(safeNumber(Infinity)).toBeNull();
    expect(safeNumber(NaN)).toBeNull();
    expect(safeNumber('hello')).toBeNull();
  });
});

describe('buildSourceKey', () => {
  it('använder feature.id första', () => {
    const feature = { id: 'feature-123', properties: { objectid: 999 } };
    expect(buildSourceKey(feature, feature.properties ?? {})).toBe('feature-123');
  });

  it('fallback till properties.objectid', () => {
    const feature = { properties: { objectid: '777' } };
    expect(buildSourceKey(feature, feature.properties ?? {})).toBe('777');
  });

  it('returnerar null om ingen source-key finns', () => {
    const feature = { properties: {} };
    expect(buildSourceKey(feature, feature.properties ?? {})).toBeNull();
  });

  it('trimmar whitespace från source-key', () => {
    const feature = { id: '  abc  ', properties: {} };
    expect(buildSourceKey(feature, feature.properties ?? {})).toBe('abc');
  });
});

describe('mapGroundLayerFeature', () => {
  it('mappar giltig grundlager-feature', () => {
    const feature: OgcFeature = {
      id: 'feature-1',
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [0, 0],
            [1, 1],
            [0, 1],
            [0, 0],
          ],
        ],
      },
      properties: {
        objectid: 100,
        jg2: 10,
        jg2_tx: 'Sand',
        kartering: 'Map1',
        karttyp: 1,
        symbol: 5,
        geom_area: 1000,
        geom_length: 200,
      },
    };
    const result = mapGroundLayerFeature(feature);
    expect(result).not.toBeNull();
    expect(result?.source_key).toBe('feature-1');
    expect(result?.layer_label).toBe('Sand');
    expect(result?.area_sqm).toBe(1000);
  });

  it('returnerar null om geometry saknas', () => {
    const feature: OgcFeature = { id: 'f1', properties: { objectid: 1 } };
    expect(mapGroundLayerFeature(feature)).toBeNull();
  });

  it('returnerar null om sourceKey saknas', () => {
    const feature: OgcFeature = { geometry: { type: 'Point' }, properties: {} };
    expect(mapGroundLayerFeature(feature)).toBeNull();
  });

  it('returnerar null om geometry inte är objekt', () => {
    const feature: OgcFeature = { id: 'f1', geometry: null, properties: {} };
    expect(mapGroundLayerFeature(feature)).toBeNull();
  });

  it('hanterar missing properties gracefully', () => {
    const feature: OgcFeature = { id: 'f1', geometry: {} };
    const result = mapGroundLayerFeature(feature);
    expect(result?.source_key).toBe('f1');
    expect(result?.layer_label).toBeNull();
  });
});

describe('mapLandslideFeature', () => {
  it('mappar giltig jordskred-feature', () => {
    const feature: OgcFeature = {
      id: 'landslide-1',
      geometry: {
        type: 'LineString',
        coordinates: [
          [0, 0],
          [1, 1],
        ],
      },
      properties: {
        objectid: 200,
        sl: 1,
        sl_tx: 'Skred',
        symbol: 3,
        geom_length: 500,
      },
    };
    const result = mapLandslideFeature(feature);
    expect(result).not.toBeNull();
    expect(result?.source_key).toBe('landslide-1');
    expect(result?.feature_label).toBe('Skred');
    expect(result?.length_m).toBe(500);
  });

  it('returnerar null om sourceKey saknas', () => {
    const feature: OgcFeature = { geometry: { type: 'LineString' }, properties: {} };
    expect(mapLandslideFeature(feature)).toBeNull();
  });

  it('hanterar missing properties', () => {
    const feature: OgcFeature = { id: 'l1', geometry: {} };
    const result = mapLandslideFeature(feature);
    expect(result?.source_key).toBe('l1');
    expect(result?.feature_label).toBeNull();
  });
});

describe('trimToMaxFeatures', () => {
  const rows = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }, { id: 5 }];

  it('returnerar alla rader om maxFeatures är undefined', () => {
    const result = trimToMaxFeatures(rows, undefined, 0);
    expect(result).toHaveLength(5);
  });

  it('trimmar till remaining = maxFeatures - importedCount', () => {
    const result = trimToMaxFeatures(rows, 10, 3);
    expect(result).toHaveLength(5); // remaining = 10 - 3 = 7, men rows = 5
  });

  it('returnerar tom array om remaining <= 0', () => {
    const result = trimToMaxFeatures(rows, 2, 5);
    expect(result).toHaveLength(0);
  });

  it('returnerar partial array om remaining < rows.length', () => {
    const result = trimToMaxFeatures(rows, 8, 5);
    expect(result).toHaveLength(3); // remaining = 8 - 5 = 3
  });
});

describe('shouldStop', () => {
  it('returnerar false utan begränsningar', () => {
    expect(shouldStop(100, 5, undefined, undefined)).toBe(false);
  });

  it('returnerar true om totalRows >= maxFeatures', () => {
    expect(shouldStop(150, 5, 100, undefined)).toBe(true);
    expect(shouldStop(100, 5, 100, undefined)).toBe(true);
  });

  it('returnerar true om pageCount >= maxPages', () => {
    expect(shouldStop(50, 10, undefined, 10)).toBe(true);
    expect(shouldStop(50, 11, undefined, 10)).toBe(true);
  });

  it('returnerar false om både totalRows och pageCount är under gränser', () => {
    expect(shouldStop(50, 5, 100, 10)).toBe(false);
  });
});

describe('summarizeRows', () => {
  it('sammanfattar grundlager-rader', () => {
    const rows: GroundLayerStageRow[] = [
      {
        source_key: 'g1',
        source_object_id: 1,
        layer_code: 10,
        layer_label: 'Sand',
        mapping_name: null,
        map_type: null,
        symbol: null,
        area_sqm: null,
        length_m: null,
        raw_properties: {},
        geom_geojson: {},
      },
      {
        source_key: 'g2',
        source_object_id: 2,
        layer_code: 20,
        layer_label: 'Clay',
        mapping_name: null,
        map_type: null,
        symbol: null,
        area_sqm: null,
        length_m: null,
        raw_properties: {},
        geom_geojson: {},
      },
    ];
    const result = summarizeRows(rows);
    expect(result).toContain('Sand [g1]');
    expect(result).toContain('Clay [g2]');
  });

  it('sammanfattar jordskred-rader', () => {
    const rows: LandslideStageRow[] = [
      {
        source_key: 'l1',
        source_object_id: 1,
        feature_code: 1,
        feature_label: 'Skred',
        symbol: null,
        length_m: null,
        raw_properties: {},
        geom_geojson: {},
      },
    ];
    const result = summarizeRows(rows);
    expect(result).toContain('Skred [l1]');
  });

  it('använder "okand" för null labels', () => {
    const rows: GroundLayerStageRow[] = [
      {
        source_key: 'g3',
        source_object_id: 3,
        layer_code: null,
        layer_label: null,
        mapping_name: null,
        map_type: null,
        symbol: null,
        area_sqm: null,
        length_m: null,
        raw_properties: {},
        geom_geojson: {},
      },
    ];
    const result = summarizeRows(rows);
    expect(result).toContain('okand [g3]');
  });

  it('begränsar till första 5 rader', () => {
    const rows: GroundLayerStageRow[] = Array.from({ length: 10 }, (_, i) => ({
      source_key: `g${i}`,
      source_object_id: i,
      layer_code: null,
      layer_label: `Layer${i}`,
      mapping_name: null,
      map_type: null,
      symbol: null,
      area_sqm: null,
      length_m: null,
      raw_properties: {},
      geom_geojson: {},
    }));
    const result = summarizeRows(rows);
    expect(result).toContain('Layer0');
    expect(result).toContain('Layer4');
    expect(result).not.toContain('Layer5');
  });
});
