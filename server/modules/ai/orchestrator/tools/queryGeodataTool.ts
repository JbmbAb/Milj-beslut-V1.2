import { FunctionDeclaration, Type } from '@google/genai';
import { prisma } from '../../../../db/prisma';
import { logger } from '../../../../logger';
import { queryNmdRasterPoint } from '../../../gis/nmdRasterService';

const DEFAULT_RADIUS_METERS = 100;
const MAX_RADIUS_METERS = 5000;
const MIN_RADIUS_METERS = 1;
const SWEDEN_BOUNDS = {
  minLatitude: 55,
  maxLatitude: 70,
  minLongitude: 10,
  maxLongitude: 25,
} as const;

type QueryGeodataArgs = {
  latitude: number;
  longitude: number;
  radiusMeters?: number;
};

type GeoLayerConfig = {
  key: string;
  schema: string;
  table: string;
  geometryColumn: string;
  source: string;
  idExpression: string;
  typeExpression: string;
  descriptionExpression: string;
  mode?: 'vector' | 'raster';
};

type GeodataRow = {
  id: string;
  source: string;
  layer: string;
  type: string;
  description: string;
  distanceMeters: number;
};

const ALLOWED_GEO_TABLES: GeoLayerConfig[] = [
  {
    key: 'nmd_2023',
    schema: 'env',
    table: 'nmd_2023',
    geometryColumn: 'rast',
    source: 'Nationella marktäckedata',
    idExpression: "'nmd-2023'",
    typeExpression: "'Markklass'::text",
    descriptionExpression: "'NMD 2023'::text",
    mode: 'raster',
  },
  {
    key: 'protected_area',
    schema: 'env',
    table: 'protected_area',
    geometryColumn: 'wkb_geometry',
    source: 'Naturvårdsverket',
    idExpression: 't.nvr_id',
    typeExpression: "COALESCE(t.protection_type, 'Skyddat område')::text",
    descriptionExpression: "COALESCE(t.name, 'Skyddat område utan namn')::text",
  },
  {
    key: 'natura2000_area',
    schema: 'env',
    table: 'natura2000_area',
    geometryColumn: 'wkb_geometry',
    source: 'Natura 2000',
    idExpression: 't.external_id',
    typeExpression: "COALESCE(t.category, 'Natura 2000')::text",
    descriptionExpression: "COALESCE(t.site_name, 'Natura 2000-område utan namn')::text",
  },
  {
    key: 'sgu_soil_type_25k_100k',
    schema: 'env',
    table: 'sgu_soil_type_25k_100k',
    geometryColumn: 'geom',
    source: 'SGU',
    idExpression: 't.id',
    typeExpression: "'Jordart'::text",
    descriptionExpression: "COALESCE(t.jordart, t.jg2_tx, t.jy1_tx, 'Okänd jordart')::text",
  },
  {
    key: 'sgu_fastmark_stabilitet',
    schema: 'env',
    table: 'sgu_fastmark_stabilitet',
    geometryColumn: 'geom',
    source: 'SGU',
    idExpression: 't.id',
    typeExpression: "'Markstabilitet'::text",
    descriptionExpression: "COALESCE(t.fastmark_tx, t.jg2_tx, 'Ingen stabilitetsbeskrivning')::text",
  },
  {
    key: 'sgu_permeability',
    schema: 'env',
    table: 'sgu_permeability',
    geometryColumn: 'geom',
    source: 'SGU',
    idExpression: 't.id',
    typeExpression: "'Genomsläpplighet'::text",
    descriptionExpression: "COALESCE(t.genomslapp_tx, t.jg2_tx, 'Ingen genomsläpplighetsbeskrivning')::text",
  },
];

function quoteIdent(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function quoteLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

export function assertReasonableGeodataCoordinates(latitude: number, longitude: number): void {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    throw new Error('Koordinater måste vara numeriska värden.');
  }

  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    throw new Error('Koordinaterna är ogiltiga.');
  }

  if (
    latitude < SWEDEN_BOUNDS.minLatitude ||
    latitude > SWEDEN_BOUNDS.maxLatitude ||
    longitude < SWEDEN_BOUNDS.minLongitude ||
    longitude > SWEDEN_BOUNDS.maxLongitude
  ) {
    throw new Error('Koordinaterna ligger utanför Sverige och kan inte slås upp i svensk geodata.');
  }
}

function normalizeRadiusMeters(radiusMeters?: number): number {
  if (radiusMeters === undefined) {
    return DEFAULT_RADIUS_METERS;
  }

  if (!Number.isFinite(radiusMeters)) {
    throw new Error('Sökradien måste vara ett numeriskt värde.');
  }

  return Math.min(MAX_RADIUS_METERS, Math.max(MIN_RADIUS_METERS, Math.round(radiusMeters)));
}

async function relationExists(schema: string, table: string): Promise<boolean> {
  const qualifiedName = `${schema}.${table}`;
  const rows = await prisma.$queryRawUnsafe<Array<{ exists: boolean }>>(
    'SELECT to_regclass($1) IS NOT NULL AS exists',
    qualifiedName,
  );
  return Boolean(rows[0]?.exists);
}

async function queryLayer(
  layer: GeoLayerConfig,
  longitude: number,
  latitude: number,
  radiusMeters: number,
): Promise<GeodataRow[]> {
  if (layer.mode === 'raster') {
    const rasterHit = await queryNmdRasterPoint(latitude, longitude);
    if (!rasterHit) {
      return [];
    }

    return [
      {
        id: 'nmd-2023',
        source: layer.source,
        layer: layer.key,
        type: `Markklass ${rasterHit.code}`,
        description: rasterHit.description,
        distanceMeters: 0,
      },
    ];
  }

  const qualifiedTable = `${quoteIdent(layer.schema)}.${quoteIdent(layer.table)}`;
  const geometryColumn = quoteIdent(layer.geometryColumn);
  const sql = `
    WITH point AS (
      SELECT ST_Transform(ST_SetSRID(ST_MakePoint($1, $2), 4326), 3006) AS geom
    )
    SELECT
      COALESCE((${layer.idExpression})::text, '') AS id,
      ${quoteLiteral(layer.source)} AS source,
      ${quoteLiteral(layer.key)} AS layer,
      ${layer.typeExpression} AS type,
      ${layer.descriptionExpression} AS description,
      ROUND(ST_Distance(t.${geometryColumn}, p.geom)::numeric, 1)::float8 AS "distanceMeters"
    FROM ${qualifiedTable} t, point p
    WHERE t.${geometryColumn} IS NOT NULL
      AND t.${geometryColumn} && ST_Expand(p.geom, $3)
      AND ST_DWithin(t.${geometryColumn}, p.geom, $3)
    ORDER BY ST_Distance(t.${geometryColumn}, p.geom) ASC
    LIMIT 5
  `;

  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL statement_timeout = '10s'`);
    return tx.$queryRawUnsafe<GeodataRow[]>(sql, longitude, latitude, radiusMeters);
  });
}

export const queryGeodataDeclaration: FunctionDeclaration = {
  name: 'queryGeodata',
  description: 'Används för att ta reda på vad som finns på en specifik plats (koordinater). Söker i PostGIS efter geotekniska förutsättningar, jordarter, skyddade områden och annat miljöpåverkande underlag i radien.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      latitude: {
        type: Type.NUMBER,
        description: 'Breddgrad (WGS84 Latitud, t.ex. 59.3293)'
      },
      longitude: {
        type: Type.NUMBER,
        description: 'Längdgrad (WGS84 Longitud, t.ex. 18.0686)'
      },
      radiusMeters: {
        type: Type.NUMBER,
        description: 'Sökradie i meter. Standard är 100. Max är 5000.'
      }
    },
    required: ['latitude', 'longitude'],
  },
};

export async function queryGeodataHandler(args: QueryGeodataArgs) {
  const { latitude, longitude } = args;
  const radiusMeters = normalizeRadiusMeters(args.radiusMeters);
  assertReasonableGeodataCoordinates(latitude, longitude);

  try {
    const results: GeodataRow[] = [];
    const layersChecked: string[] = [];

    for (const layer of ALLOWED_GEO_TABLES) {
      if (layer.mode !== 'raster' && !(await relationExists(layer.schema, layer.table))) {
        logger.warn('queryGeodata skipped missing relation', {
          layer: `${layer.schema}.${layer.table}`,
        });
        continue;
      }

      layersChecked.push(layer.key);
      results.push(...(await queryLayer(layer, longitude, latitude, radiusMeters)));
    }

    if (results.length === 0) {
      return {
        message: `Ingen geodata hittades inom ${radiusMeters} meter från angiven punkt.`,
        location: { latitude, longitude },
        radiusMeters,
        layersChecked,
        results: [],
      };
    }

    return {
      location: { latitude, longitude },
      radiusMeters,
      layersChecked,
      results,
    };
  } catch (error) {
    logger.error('queryGeodata failed', {
      latitude,
      longitude,
      radiusMeters,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
