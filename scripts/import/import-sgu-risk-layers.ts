import { PrismaClient } from '@prisma/client';
import pg from 'pg';
import { from as copyFrom } from 'pg-copy-streams';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';

const prisma = new PrismaClient();

const SGU_APIS = {
  ground_1m: 'https://api.sgu.se/oppnadata/jordarter1miljon/ogc/features/v1/collections/grundlager/items',
  landslide:
    'https://api.sgu.se/oppnadata/jordskred-raviner/ogc/features/v1/collections/jordskred-raviner/items',
  soil_25k_100k: 'https://api.sgu.se/oppnadata/jordarter25k-100k/ogc/features/v1/collections/ytlager/items',
  groundwater:
    'https://api.sgu.se/oppnadata/grundvattenmagasin/ogc/features/v1/collections/grundvattenmagasin/items',
  wells: 'https://api.sgu.se/oppnadata/brunnar/ogc/features/v1/collections/brunnar/items',
  aktsam_efterarbetad:
    'https://api.sgu.se/oppnadata/forutsattningar-skred-finkornig-jordart/ogc/features/v1/collections/aktsam-efterarbetad/items',
  aktsam_strandnara:
    'https://api.sgu.se/oppnadata/forutsattningar-skred-finkornig-jordart/ogc/features/v1/collections/aktsam-strandnara/items',
  aktiv_erosion:
    'https://api.sgu.se/oppnadata/stranderosion-kust/ogc/features/v1/collections/aktiv-erosion/items',
  erosionsindex:
    'https://api.sgu.se/oppnadata/stranderosion-kust/ogc/features/v1/collections/erosionsindex/items',
  vattenyta_prognos:
    'https://api.sgu.se/oppnadata/stranderosion-kust/ogc/features/v1/collections/vattenyta-prognos/items',
  strander_eroderbarhet:
    'https://api.sgu.se/oppnadata/stranders-jordart-eroderbarhet/ogc/features/v1/collections/strander/items',
  fastmark: 'https://api.sgu.se/oppnadata/fastmark/ogc/features/v1/collections/fastmark/items',
};

const DEFAULT_PAGE_SIZE = 5000;

type ImportTarget = keyof typeof SGU_APIS | 'all';

type CliOptions = {
  target: ImportTarget;
  stageOnly: boolean;
  pageSize: number;
  limit: number | null;
  resume: boolean;
};

type GeoJsonGeometry = {
  type: string;
  coordinates: any;
};

type GeoJsonFeature = {
  id?: string | number;
  geometry: GeoJsonGeometry | null;
  properties?: Record<string, any>;
};

type FeatureCollectionResponse = {
  type: 'FeatureCollection';
  features: GeoJsonFeature[];
  numberMatched?: number;
  numberReturned?: number;
};

function parseCliOptions(argv: string[]): CliOptions {
  const options: CliOptions = {
    target: 'all',
    stageOnly: false,
    pageSize: DEFAULT_PAGE_SIZE,
    limit: null,
    resume: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--ground-1m') options.target = 'ground_1m';
    if (arg === '--landslide') options.target = 'landslide';
    if (arg === '--soil-25k-100k') options.target = 'soil_25k_100k';
    if (arg === '--groundwater') options.target = 'groundwater';
    if (arg === '--wells') options.target = 'wells';
    if (arg === '--aktsam-efterarbetad') options.target = 'aktsam_efterarbetad';
    if (arg === '--aktsam-strandnara') options.target = 'aktsam_strandnara';
    if (arg === '--aktiv-erosion') options.target = 'aktiv_erosion';
    if (arg === '--erosionsindex') options.target = 'erosionsindex';
    if (arg === '--vattenyta-prognos') options.target = 'vattenyta_prognos';
    if (arg === '--strander-eroderbarhet') options.target = 'strander_eroderbarhet';
    if (arg === '--fastmark') options.target = 'fastmark';

    if (arg === '--aktsam-strandnara') options.target = 'aktsam_strandnara';
    if (arg === '--aktiv-erosion') options.target = 'aktiv_erosion';
    if (arg === '--erosionsindex') options.target = 'erosionsindex';
    if (arg === '--vattenyta-prognos') options.target = 'vattenyta_prognos';
    if (arg === '--strander-eroderbarhet') options.target = 'strander_eroderbarhet';
    if (arg === '--fastmark') options.target = 'fastmark';

    if (arg === '--stage-only') options.stageOnly = true;
    if (arg === '--resume') options.resume = true;
    if (arg === '--page-size') options.pageSize = parseInt(argv[++i]);
    if (arg === '--limit') options.limit = parseInt(argv[++i]);
  }

  return options;
}

async function copyToPostgres(client: pg.Client, tableName: string, rows: any[]) {
  if (rows.length === 0) return;

  const columns = Object.keys(rows[0]);
  const stream = client.query(
    copyFrom(
      `COPY ${tableName} (${columns.join(', ')}) FROM STDIN WITH (FORMAT CSV, HEADER FALSE, QUOTE '"', ESCAPE '"')`,
    ),
  );

  const csvContent =
    rows
      .map((row) =>
        columns
          .map((col) => {
            const val = row[col];
            if (val === null || val === undefined) return '';
            const strVal = typeof val === 'object' ? JSON.stringify(val) : String(val);
            return '"' + strVal.replace(/"/g, '""') + '"';
          })
          .join(','),
      )
      .join('\n') + '\n';

  const readable = Readable.from([csvContent]);
  await pipeline(readable, stream);
}

async function ensurePipelineTables(): Promise<void> {
  console.log('Ensuring schemas and tables exist...');
  await prisma.$executeRawUnsafe(`CREATE SCHEMA IF NOT EXISTS stage;`);
  await prisma.$executeRawUnsafe(`CREATE SCHEMA IF NOT EXISTS env;`);

  const tables = [
    {
      name: 'sgu_ground_layer_raw',
      cols: 'source_key TEXT, source_object_id INTEGER, layer_code INTEGER, layer_label TEXT, mapping_name TEXT, map_type INTEGER, symbol INTEGER, area_sqm NUMERIC, length_m NUMERIC, raw_properties JSONB, geom_json TEXT',
    },
    {
      name: 'sgu_landslide_raw',
      cols: 'source_key TEXT, source_object_id INTEGER, feature_code INTEGER, feature_label TEXT, symbol INTEGER, length_m NUMERIC, raw_properties JSONB, geom_json TEXT',
    },
    {
      name: 'sgu_soil_25k_raw',
      cols: 'source_key TEXT, source_object_id INTEGER, soil_code INTEGER, soil_label TEXT, mapping_name TEXT, map_type INTEGER, symbol INTEGER, area_sqm NUMERIC, length_m NUMERIC, raw_properties JSONB, geom_json TEXT',
    },
    {
      name: 'sgu_groundwater_raw',
      cols: 'source_key TEXT, unique_id TEXT, internal_id INTEGER, name TEXT, formation_type TEXT, aquifer_type TEXT, position_desc TEXT, genesis TEXT, geom_area NUMERIC, geom_length NUMERIC, raw_properties JSONB, geom_json TEXT',
    },
    {
      name: 'sgu_well_raw',
      cols: 'source_key TEXT, well_id INTEGER, obs_id TEXT, property_designation TEXT, capacity NUMERIC, depth NUMERIC, soil_depth NUMERIC, use_type TEXT, raw_properties JSONB, geom_json TEXT',
    },
    {
      name: 'sgu_aktsamhet_raw',
      cols: 'source_key TEXT, source_object_id INTEGER, feature_label TEXT, area_sqm NUMERIC, length_m NUMERIC, raw_properties JSONB, geom_json TEXT',
    },
    {
      name: 'sgu_erosion_raw',
      cols: 'source_key TEXT, source_object_id INTEGER, feature_label TEXT, value NUMERIC, unit TEXT, area_sqm NUMERIC, length_m NUMERIC, raw_properties JSONB, geom_json TEXT',
    },
    {
      name: 'sgu_fastmark_raw',
      cols: 'source_key TEXT, source_object_id INTEGER, stability_class TEXT, stability_label TEXT, raw_properties JSONB, geom_json TEXT',
    },
  ];

  const envTables = [
    {
      name: 'env.sgu_ground_layer',
      cols: 'id SERIAL PRIMARY KEY, source_key TEXT, source_object_id INTEGER, layer_code INTEGER, layer_label TEXT, mapping_name TEXT, map_type INTEGER, symbol INTEGER, area_sqm NUMERIC, length_m NUMERIC, raw_properties JSONB, geom GEOMETRY(MULTIPOLYGON, 3006), grid_id INTEGER, UNIQUE(source_key, grid_id)',
    },
    {
      name: 'env.sgu_landslide_feature',
      cols: 'id SERIAL PRIMARY KEY, source_key TEXT UNIQUE, source_object_id INTEGER, feature_code INTEGER, feature_label TEXT, symbol INTEGER, length_m NUMERIC, raw_properties JSONB, geom GEOMETRY(GEOMETRY, 3006)',
    },
    {
      name: 'env.sgu_soil_type',
      cols: 'id SERIAL PRIMARY KEY, jordart_kod TEXT, jordart_namn TEXT, beskrivning TEXT, geom GEOMETRY(MULTIPOLYGON, 3006)',
    },
    {
      name: 'env.env_sgu_grundvatten_sarbarhet',
      cols: 'id SERIAL PRIMARY KEY, klass TEXT, beskrivning TEXT, geom GEOMETRY(MULTIPOLYGON, 3006)',
    },
    {
      name: 'env.sgu_well',
      cols: 'id SERIAL PRIMARY KEY, well_id INTEGER, property_designation TEXT, capacity NUMERIC, depth NUMERIC, use_type TEXT, geom GEOMETRY(POINT, 3006)',
    },
    {
      name: 'env.sgu_aktsamhetsomrade',
      cols: 'id SERIAL PRIMARY KEY, source_key TEXT UNIQUE, source_object_id INTEGER, feature_label TEXT, area_sqm NUMERIC, length_m NUMERIC, raw_properties JSONB, geom GEOMETRY(MULTIPOLYGON, 3006)',
    },
    {
      name: 'env.sgu_erosion_feature',
      cols: 'id SERIAL PRIMARY KEY, source_key TEXT UNIQUE, source_object_id INTEGER, feature_label TEXT, value NUMERIC, unit TEXT, area_sqm NUMERIC, length_m NUMERIC, raw_properties JSONB, geom GEOMETRY(GEOMETRY, 3006)',
    },
    {
      name: 'env.sgu_fastmark_stabilitet',
      cols: 'id SERIAL PRIMARY KEY, source_key TEXT UNIQUE, source_object_id INTEGER, stability_class TEXT, stability_label TEXT, raw_properties JSONB, geom GEOMETRY(MULTIPOLYGON, 3006)',
    },
  ];

  console.log('Ensuring staging tables exist in schema "stage"...');
  for (const table of tables) {
    await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS stage.${table.name} CASCADE;`);
    await prisma.$executeRawUnsafe(`CREATE TABLE stage.${table.name} (${table.cols});`);
  }
  console.log('Ensuring production tables exist in schema "env"...');
  for (const table of envTables) {
    await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS ${table.name} (${table.cols});`);
  }
}

async function fetchCollectionPage(
  url: string,
  limit: number,
  startIndex: number,
): Promise<FeatureCollectionResponse> {
  const targetUrl = new URL(url);
  targetUrl.searchParams.set('limit', limit.toString());
  targetUrl.searchParams.set('startIndex', startIndex.toString());
  targetUrl.searchParams.set('f', 'json');

  const res = await fetch(targetUrl, { headers: { Accept: 'application/geo+json' } });
  if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
  return (await res.json()) as FeatureCollectionResponse;
}

async function genericImport(
  client: pg.Client,
  label: string,
  apiUrl: string,
  stageTable: string,
  targetTable: string,
  options: CliOptions,
  mapper: (f: GeoJsonFeature) => any,
  targetInsertSql: string,
) {
  let imported = 0;
  let startIndex = 0;

  if (options.resume) {
    const result = await prisma.$queryRawUnsafe<any[]>(`SELECT count(*) as count FROM ${targetTable}`);
    startIndex = Number(result[0].count);
    console.log(`Resuming ${label} import from index ${startIndex}...`);
  }

  while (true) {
    const remaining =
      options.limit === null ? options.pageSize : Math.min(options.pageSize, options.limit - imported);
    if (remaining <= 0) break;

    console.log(`Fetching ${label} batch starting at ${startIndex}...`);
    const page = await fetchCollectionPage(apiUrl, remaining, startIndex);
    if (page.features.length === 0) break;

    const copyRows = page.features.map(mapper);
    await copyToPostgres(client, `stage.${stageTable}`, copyRows);

    if (!options.stageOnly) {
      await prisma.$executeRawUnsafe(targetInsertSql);
      await prisma.$executeRawUnsafe(`TRUNCATE stage.${stageTable};`);
    }

    imported += page.features.length;
    startIndex += page.features.length;
    console.log(`[${label}] Processed ${imported} rows...`);

    if (page.features.length < remaining) break;
  }
}

async function main() {
  const options = parseCliOptions(process.argv.slice(2));
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });

  try {
    await client.connect();
    console.log('Database client connected for high-volume COPY.');

    await ensurePipelineTables();

    const tasks = [
      {
        id: 'ground_1m',
        label: 'Ground Layer 1M',
        api: SGU_APIS.ground_1m,
        stage: 'sgu_ground_layer_raw',
        target: 'env.sgu_ground_layer',
        mapper: (f: GeoJsonFeature) => {
          const p = f.properties || {};
          return {
            source_key: f.id || p.objectid,
            source_object_id: p.objectid,
            layer_code: p.jg2,
            layer_label: p.jg2_tx,
            mapping_name: p.kartering,
            map_type: p.karttyp,
            symbol: p.symbol,
            area_sqm: p.geom_area,
            length_m: p.geom_length,
            raw_properties: JSON.stringify(p),
            geom_json: JSON.stringify(f.geometry),
          };
        },
        sql: `
        INSERT INTO env.sgu_ground_layer (source_key, source_object_id, layer_code, layer_label, mapping_name, map_type, symbol, area_sqm, length_m, raw_properties, geom, grid_id)
        SELECT source_key, source_object_id, layer_code, layer_label, mapping_name, map_type, symbol, area_sqm, length_m, raw_properties, 
               ST_Multi(ST_Transform(ST_SetSRID(ST_GeomFromGeoJSON(geom_json), 4326), 3006)),
               (floor(ST_X(ST_Centroid(ST_Transform(ST_SetSRID(ST_GeomFromGeoJSON(geom_json), 4326), 3006)))/100000)*100 + floor(ST_Y(ST_Centroid(ST_Transform(ST_SetSRID(ST_GeomFromGeoJSON(geom_json), 4326), 3006)))/100000))::int
        FROM stage.sgu_ground_layer_raw ON CONFLICT (source_key, grid_id) DO NOTHING;
      `,
      },
      {
        id: 'landslide',
        label: 'Landslide',
        api: SGU_APIS.landslide,
        stage: 'sgu_landslide_raw',
        target: 'env.sgu_landslide_feature',
        mapper: (f: GeoJsonFeature) => {
          const p = f.properties || {};
          return {
            source_key: f.id || p.objectid,
            source_object_id: p.objectid,
            feature_code: p.sl,
            feature_label: p.sl_tx,
            symbol: p.symbol,
            length_m: p.geom_length,
            raw_properties: JSON.stringify(p),
            geom_json: JSON.stringify(f.geometry),
          };
        },
        sql: `
        INSERT INTO env.sgu_landslide_feature (source_key, source_object_id, feature_code, feature_label, symbol, length_m, raw_properties, geom)
        SELECT source_key, source_object_id, feature_code, feature_label, symbol, length_m, raw_properties, 
               ST_Transform(ST_SetSRID(ST_GeomFromGeoJSON(geom_json), 4326), 3006)
        FROM stage.sgu_landslide_raw ON CONFLICT (source_key) DO NOTHING;
      `,
      },
      {
        id: 'soil_25k_100k',
        label: 'Soil Type 25k-100k',
        api: SGU_APIS.soil_25k_100k,
        stage: 'sgu_soil_25k_raw',
        target: 'env.sgu_soil_type',
        mapper: (f: GeoJsonFeature) => {
          const p = f.properties || {};
          return {
            source_key: f.id || p.objectid,
            source_object_id: p.objectid,
            soil_code: p.jy1,
            soil_label: p.jy1_tx,
            mapping_name: p.kartering,
            map_type: p.karttyp,
            symbol: p.symbol,
            area_sqm: p.geom_area,
            length_m: p.geom_length,
            raw_properties: JSON.stringify(p),
            geom_json: JSON.stringify(f.geometry),
          };
        },
        sql: `
          INSERT INTO env.sgu_soil_type (jordart_kod, jordart_namn, beskrivning, geom)
          SELECT soil_code::text, soil_label, mapping_name, 
                 ST_Multi(ST_Transform(ST_SetSRID(ST_GeomFromGeoJSON(geom_json), 4326), 3006))
          FROM stage.sgu_soil_25k_raw;
        `,
      },
      {
        id: 'groundwater',
        label: 'Groundwater Reservoirs',
        api: SGU_APIS.groundwater,
        stage: 'sgu_groundwater_raw',
        target: 'env.env_sgu_grundvatten_sarbarhet',
        mapper: (f: GeoJsonFeature) => {
          const p = f.properties || {};
          return {
            source_key: f.id,
            unique_id: p.unik_magasinsidentitet,
            internal_id: p.magasinsidentitet,
            name: p.magasinsnamn,
            formation_type: p.grvbildningstyp,
            aquifer_type: p.akvifertyp,
            position_desc: p.magasinsposition,
            genesis: p.genes,
            geom_area: p.geom_area,
            geom_length: p.geom_length,
            raw_properties: JSON.stringify(p),
            geom_json: JSON.stringify(f.geometry),
          };
        },
        sql: `
          INSERT INTO env.env_sgu_grundvatten_sarbarhet (klass, beskrivning, geom)
          SELECT formation_type, name || ' - ' || genesis, 
                 ST_Multi(ST_Transform(ST_SetSRID(ST_GeomFromGeoJSON(geom_json), 4326), 3006))
          FROM stage.sgu_groundwater_raw;
        `,
      },
      {
        id: 'wells',
        label: 'Wells',
        api: SGU_APIS.wells,
        stage: 'sgu_well_raw',
        target: 'env.sgu_well',
        mapper: (f: GeoJsonFeature) => {
          const p = f.properties || {};
          return {
            source_key: f.id,
            well_id: p.brunnsid,
            obs_id: p.obsplatsid,
            property_designation: p.fastighet,
            capacity: p.kapacitet,
            depth: p.totaldjup,
            soil_depth: p.jorddjup,
            use_type: p.anvandning,
            raw_properties: JSON.stringify(p),
            geom_json: JSON.stringify(f.geometry),
          };
        },
        sql: `
          INSERT INTO env.sgu_well (well_id, property_designation, capacity, depth, use_type, geom)
          SELECT well_id, property_designation, capacity, depth, use_type, 
                 ST_Transform(ST_SetSRID(ST_GeomFromGeoJSON(geom_json), 4326), 3006)
          FROM stage.sgu_well_raw;
        `,
      },
      {
        id: 'aktsam_efterarbetad',
        label: 'Landslide Caution (Refined)',
        api: SGU_APIS.aktsam_efterarbetad,
        stage: 'sgu_aktsamhet_raw',
        target: 'env.sgu_aktsamhetsomrade',
        mapper: (f: GeoJsonFeature) => {
          const p = f.properties || {};
          return {
            source_key: f.id || p.objectid,
            source_object_id: p.objectid,
            feature_label: p.aktsamhet_tx || p.label,
            area_sqm: p.geom_area,
            length_m: p.geom_length,
            raw_properties: JSON.stringify(p),
            geom_json: JSON.stringify(f.geometry),
          };
        },
        sql: `
          INSERT INTO env.sgu_aktsamhetsomrade (source_key, source_object_id, feature_label, area_sqm, length_m, raw_properties, geom)
          SELECT source_key, source_object_id, feature_label, area_sqm, length_m, raw_properties,
                 ST_Multi(ST_Transform(ST_SetSRID(ST_GeomFromGeoJSON(geom_json), 4326), 3006))
          FROM stage.sgu_aktsamhet_raw ON CONFLICT (source_key) DO NOTHING;
        `,
      },
      {
        id: 'aktsam_strandnara',
        label: 'Landslide Caution (Coastal)',
        api: SGU_APIS.aktsam_strandnara,
        stage: 'sgu_aktsamhet_raw',
        target: 'env.sgu_aktsamhetsomrade',
        mapper: (f: GeoJsonFeature) => {
          const p = f.properties || {};
          return {
            source_key: f.id || p.objectid,
            source_object_id: p.objectid,
            feature_label: p.aktsamhet_tx || p.label || 'Strandnära',
            area_sqm: p.geom_area,
            length_m: p.geom_length,
            raw_properties: JSON.stringify(p),
            geom_json: JSON.stringify(f.geometry),
          };
        },
        sql: `
          INSERT INTO env.sgu_aktsamhetsomrade (source_key, source_object_id, feature_label, area_sqm, length_m, raw_properties, geom)
          SELECT source_key, source_object_id, feature_label, area_sqm, length_m, raw_properties,
                 ST_Multi(ST_Transform(ST_SetSRID(ST_GeomFromGeoJSON(geom_json), 4326), 3006))
          FROM stage.sgu_aktsamhet_raw ON CONFLICT (source_key) DO NOTHING;
        `,
      },
      {
        id: 'aktiv_erosion',
        label: 'Active Coastal Erosion',
        api: SGU_APIS.aktiv_erosion,
        stage: 'sgu_erosion_raw',
        target: 'env.sgu_erosion_feature',
        mapper: (f: GeoJsonFeature) => {
          const p = f.properties || {};
          return {
            source_key: f.id || p.objectid,
            source_object_id: p.objectid,
            feature_label: 'Aktiv erosion',
            value: null,
            unit: null,
            area_sqm: p.geom_area,
            length_m: p.geom_length,
            raw_properties: JSON.stringify(p),
            geom_json: JSON.stringify(f.geometry),
          };
        },
        sql: `
          INSERT INTO env.sgu_erosion_feature (source_key, source_object_id, feature_label, value, unit, area_sqm, length_m, raw_properties, geom)
          SELECT source_key, source_object_id, feature_label, value, unit, area_sqm, length_m, raw_properties,
                 ST_Transform(ST_SetSRID(ST_GeomFromGeoJSON(geom_json), 4326), 3006)
          FROM stage.sgu_erosion_raw ON CONFLICT (source_key) DO NOTHING;
        `,
      },
      {
        id: 'erosionsindex',
        label: 'Coastal Erosion Index',
        api: SGU_APIS.erosionsindex,
        stage: 'sgu_erosion_raw',
        target: 'env.sgu_erosion_feature',
        mapper: (f: GeoJsonFeature) => {
          const p = f.properties || {};
          return {
            source_key: f.id || p.objectid,
            source_object_id: p.objectid,
            feature_label: 'Erosionsindex: ' + (p.erosionsindex_tx || ''),
            value: p.erosionsindex,
            unit: 'index',
            area_sqm: p.geom_area,
            length_m: p.geom_length,
            raw_properties: JSON.stringify(p),
            geom_json: JSON.stringify(f.geometry),
          };
        },
        sql: `
          INSERT INTO env.sgu_erosion_feature (source_key, source_object_id, feature_label, value, unit, area_sqm, length_m, raw_properties, geom)
          SELECT source_key, source_object_id, feature_label, value, unit, area_sqm, length_m, raw_properties,
                 ST_Transform(ST_SetSRID(ST_GeomFromGeoJSON(geom_json), 4326), 3006)
          FROM stage.sgu_erosion_raw ON CONFLICT (source_key) DO NOTHING;
        `,
      },
      {
        id: 'vattenyta_prognos',
        label: 'Water Surface Prognosis',
        api: SGU_APIS.vattenyta_prognos,
        stage: 'sgu_erosion_raw',
        target: 'env.sgu_erosion_feature',
        mapper: (f: GeoJsonFeature) => {
          const p = f.properties || {};
          return {
            source_key: f.id || p.objectid,
            source_object_id: p.objectid,
            feature_label: 'Vattenyta prognos: ' + (p.prognos_tx || ''),
            value: p.meter_over_havet,
            unit: 'm',
            area_sqm: p.geom_area,
            length_m: p.geom_length,
            raw_properties: JSON.stringify(p),
            geom_json: JSON.stringify(f.geometry),
          };
        },
        sql: `
          INSERT INTO env.sgu_erosion_feature (source_key, source_object_id, feature_label, value, unit, area_sqm, length_m, raw_properties, geom)
          SELECT source_key, source_object_id, feature_label, value, unit, area_sqm, length_m, raw_properties,
                 ST_Transform(ST_SetSRID(ST_GeomFromGeoJSON(geom_json), 4326), 3006)
          FROM stage.sgu_erosion_raw ON CONFLICT (source_key) DO NOTHING;
        `,
      },
      {
        id: 'strander_eroderbarhet',
        label: 'Erosion Susceptibility (Coastal)',
        api: SGU_APIS.strander_eroderbarhet,
        stage: 'sgu_erosion_raw',
        target: 'env.sgu_erosion_feature',
        mapper: (f: GeoJsonFeature) => {
          const p = f.properties || {};
          return {
            source_key: f.id || p.objectid,
            source_object_id: p.objectid,
            feature_label: 'Eroderbarhet: ' + (p.eroderbarhet_tx || ''),
            value: p.eroderbarhetsklass,
            unit: 'klass',
            area_sqm: p.geom_area,
            length_m: p.geom_length,
            raw_properties: JSON.stringify(p),
            geom_json: JSON.stringify(f.geometry),
          };
        },
        sql: `
          INSERT INTO env.sgu_erosion_feature (source_key, source_object_id, feature_label, value, unit, area_sqm, length_m, raw_properties, geom)
          SELECT source_key, source_object_id, feature_label, value, unit, area_sqm, length_m, raw_properties,
                 ST_Transform(ST_SetSRID(ST_GeomFromGeoJSON(geom_json), 4326), 3006)
          FROM stage.sgu_erosion_raw ON CONFLICT (source_key) DO NOTHING;
        `,
      },
      {
        id: 'fastmark',
        label: 'Soil Stability (Fastmark)',
        api: SGU_APIS.fastmark,
        stage: 'sgu_fastmark_raw',
        target: 'env.sgu_fastmark_stabilitet',
        mapper: (f: GeoJsonFeature) => {
          const p = f.properties || {};
          return {
            source_key: f.id || p.objectid,
            source_object_id: p.objectid,
            stability_class: p.fastmark,
            stability_label: p.fastmark_tx,
            raw_properties: JSON.stringify(p),
            geom_json: JSON.stringify(f.geometry),
          };
        },
        sql: `
          INSERT INTO env.sgu_fastmark_stabilitet (source_key, source_object_id, stability_class, stability_label, raw_properties, geom)
          SELECT source_key, source_object_id, stability_class, stability_label, raw_properties,
                 ST_Multi(ST_Transform(ST_SetSRID(ST_GeomFromGeoJSON(geom_json), 4326), 3006))
          FROM stage.sgu_fastmark_raw ON CONFLICT (source_key) DO NOTHING;
        `,
      },
    ];

    for (const task of tasks) {
      if (options.target === 'all' || options.target === task.id) {
        await genericImport(
          client,
          task.label,
          task.api,
          task.stage,
          task.target,
          options,
          task.mapper,
          task.sql,
        );
      }
    }

    console.log('Import completed successfully.');
  } finally {
    await client.end();
    console.log('Database client disconnected.');
  }
}

main()
  .catch((err) => {
    console.error('An error occurred during the import process:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
