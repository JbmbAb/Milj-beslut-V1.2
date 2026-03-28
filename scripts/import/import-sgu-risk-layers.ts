import "dotenv/config";

import { PrismaClient } from "@prisma/client";

type JsonObject = Record<string, unknown>;

type LayerName = "grundlager" | "jordskred-raviner";

interface CliOptions {
  layer: LayerName | "all";
  bbox?: string;
  allowNational: boolean;
  pageSize: number;
  maxPages?: number;
  maxFeatures?: number;
  dryRun: boolean;
  verbose: boolean;
}

interface OgcFeature {
  id?: string | number;
  geometry?: JsonObject | null;
  properties?: JsonObject;
}

interface OgcFeatureCollection {
  features?: OgcFeature[];
  links?: Array<{ href?: string; rel?: string }>;
  numberMatched?: number;
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

const prisma = new PrismaClient();

const LAYER_CONFIG = {
  grundlager: {
    baseUrl: "https://api.sgu.se/oppnadata/jordarter1miljon/ogc/features/v1",
    collection: "grundlager",
    stageTable: "env.sgu_ground_layer",
    datasetLabel: "SGU jordarter 1 miljon / grundlager",
  },
  "jordskred-raviner": {
    baseUrl: "https://api.sgu.se/oppnadata/jordskred-raviner/ogc/features/v1",
    collection: "jordskred-raviner",
    stageTable: "env.sgu_landslide_feature",
    datasetLabel: "SGU jordskred-raviner",
  },
} as const;

function printUsage(): void {
  console.log(`
Usage:
  npx tsx scripts/import/import-sgu-risk-layers.ts --layer grundlager [options]
  npx tsx scripts/import/import-sgu-risk-layers.ts --layer jordskred-raviner [options]
  npx tsx scripts/import/import-sgu-risk-layers.ts --layer all [options]

Examples:
  npx tsx scripts/import/import-sgu-risk-layers.ts --layer grundlager --bbox 12.1,56.2,12.7,56.6
  npx tsx scripts/import/import-sgu-risk-layers.ts --layer jordskred-raviner --allow-national --max-features 200 --dry-run

Options:
  --layer <name>             grundlager | jordskred-raviner | all
  --bbox <minLng,minLat,maxLng,maxLat>
                             Spatialt scope i WGS84. Rekommenderas.
  --allow-national           Tillat nationellt scope. Anvand alltid med max-features/max-pages om du inte avser full import.
  --page-size <n>            Features per request (default 500)
  --max-pages <n>            Stop after n pages
  --max-features <n>         Stop after n imported features
  --dry-run                  Fetch and map but do not write to database
  --verbose                  Log each page URL
  --help                     Show this help
`.trim());
}

function parsePositiveInt(value: string, flagName: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${flagName} must be a positive integer.`);
  }
  return parsed;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    layer: "all",
    allowNational: false,
    pageSize: 500,
    dryRun: false,
    verbose: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    }

    const next = argv[i + 1];
    const requireValue = (flagName: string): string => {
      if (!next || next.startsWith("--")) {
        throw new Error(`${flagName} requires a value.`);
      }
      i += 1;
      return next;
    };

    switch (arg) {
      case "--layer": {
        const value = requireValue(arg).trim() as CliOptions["layer"];
        if (!["grundlager", "jordskred-raviner", "all"].includes(value)) {
          throw new Error("--layer must be grundlager, jordskred-raviner or all.");
        }
        options.layer = value;
        break;
      }
      case "--bbox":
        options.bbox = requireValue(arg).trim();
        break;
      case "--allow-national":
        options.allowNational = true;
        break;
      case "--page-size":
        options.pageSize = parsePositiveInt(requireValue(arg), arg);
        break;
      case "--max-pages":
        options.maxPages = parsePositiveInt(requireValue(arg), arg);
        break;
      case "--max-features":
        options.maxFeatures = parsePositiveInt(requireValue(arg), arg);
        break;
      case "--dry-run":
        options.dryRun = true;
        break;
      case "--verbose":
        options.verbose = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!options.bbox && !options.allowNational) {
    throw new Error("Either --bbox or --allow-national is required. Full national scope must be explicit.");
  }

  return options;
}

function safeString(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return null;
}

function safeNumber(value: unknown): number | null {
  const num = typeof value === "number" ? value : Number(value);
  return Number.isFinite(num) ? num : null;
}

function buildSourceKey(feature: OgcFeature, properties: JsonObject): string | null {
  return safeString(feature.id) ?? safeString(properties.objectid);
}

function mapGroundLayerFeature(feature: OgcFeature): GroundLayerStageRow | null {
  const properties = feature.properties ?? {};
  const geometry = feature.geometry;
  const sourceKey = buildSourceKey(feature, properties);

  if (!geometry || typeof geometry !== "object" || !sourceKey) {
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

  if (!geometry || typeof geometry !== "object" || !sourceKey) {
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

async function assertStageTableExists(tableName: string): Promise<void> {
  const result = (await prisma.$queryRaw<Array<{ regclass: string | null }>>`
    SELECT to_regclass(${tableName})::text AS regclass
  `) as Array<{ regclass: string | null }>;

  if (!result[0]?.regclass) {
    throw new Error(`Missing ${tableName}. Run prisma/spatial/001_env_spatial_tables.sql first.`);
  }
}

async function upsertGroundLayerBatch(rows: GroundLayerStageRow[]): Promise<void> {
  if (rows.length === 0) return;
  const payload = JSON.stringify(rows);

  await prisma.$executeRaw`
    WITH payload AS (
      SELECT *
      FROM jsonb_to_recordset(${payload}::jsonb) AS x(
        source_key text,
        source_object_id bigint,
        layer_code integer,
        layer_label text,
        mapping_name text,
        map_type integer,
        symbol integer,
        area_sqm double precision,
        length_m double precision,
        raw_properties jsonb,
        geom_geojson jsonb
      )
    )
    INSERT INTO env.sgu_ground_layer (
      source_key,
      source_object_id,
      layer_code,
      layer_label,
      mapping_name,
      map_type,
      symbol,
      area_sqm,
      length_m,
      raw_properties,
      geom,
      imported_at
    )
    SELECT
      p.source_key,
      p.source_object_id,
      p.layer_code,
      p.layer_label,
      p.mapping_name,
      p.map_type,
      p.symbol,
      p.area_sqm,
      p.length_m,
      p.raw_properties,
      ST_Multi(
        ST_CollectionExtract(
          ST_MakeValid(
            ST_Transform(
              ST_SetSRID(ST_GeomFromGeoJSON(p.geom_geojson::text), 4326),
              3006
            )
          ),
          3
        )
      )::geometry(MultiPolygon, 3006),
      now()
    FROM payload p
    ON CONFLICT (source_key) DO UPDATE
    SET
      source_object_id = EXCLUDED.source_object_id,
      layer_code = EXCLUDED.layer_code,
      layer_label = EXCLUDED.layer_label,
      mapping_name = EXCLUDED.mapping_name,
      map_type = EXCLUDED.map_type,
      symbol = EXCLUDED.symbol,
      area_sqm = EXCLUDED.area_sqm,
      length_m = EXCLUDED.length_m,
      raw_properties = EXCLUDED.raw_properties,
      geom = EXCLUDED.geom,
      imported_at = now()
  `;
}

async function upsertLandslideBatch(rows: LandslideStageRow[]): Promise<void> {
  if (rows.length === 0) return;
  const payload = JSON.stringify(rows);

  await prisma.$executeRaw`
    WITH payload AS (
      SELECT *
      FROM jsonb_to_recordset(${payload}::jsonb) AS x(
        source_key text,
        source_object_id bigint,
        feature_code integer,
        feature_label text,
        symbol integer,
        length_m double precision,
        raw_properties jsonb,
        geom_geojson jsonb
      )
    )
    INSERT INTO env.sgu_landslide_feature (
      source_key,
      source_object_id,
      feature_code,
      feature_label,
      symbol,
      length_m,
      raw_properties,
      geom,
      imported_at
    )
    SELECT
      p.source_key,
      p.source_object_id,
      p.feature_code,
      p.feature_label,
      p.symbol,
      p.length_m,
      p.raw_properties,
      ST_Multi(
        ST_CollectionExtract(
          ST_MakeValid(
            ST_Transform(
              ST_SetSRID(ST_GeomFromGeoJSON(p.geom_geojson::text), 4326),
              3006
            )
          ),
          2
        )
      )::geometry(MultiLineString, 3006),
      now()
    FROM payload p
    ON CONFLICT (source_key) DO UPDATE
    SET
      source_object_id = EXCLUDED.source_object_id,
      feature_code = EXCLUDED.feature_code,
      feature_label = EXCLUDED.feature_label,
      symbol = EXCLUDED.symbol,
      length_m = EXCLUDED.length_m,
      raw_properties = EXCLUDED.raw_properties,
      geom = EXCLUDED.geom,
      imported_at = now()
  `;
}

function trimToMaxFeatures<T>(rows: T[], options: CliOptions, importedCount: number): T[] {
  if (!options.maxFeatures) return rows;
  const remaining = options.maxFeatures - importedCount;
  if (remaining <= 0) return [];
  return rows.slice(0, remaining);
}

function shouldStop(totalRows: number, pageCount: number, options: CliOptions): boolean {
  if (options.maxFeatures && totalRows >= options.maxFeatures) return true;
  if (options.maxPages && pageCount >= options.maxPages) return true;
  return false;
}

function summarizeRows(rows: Array<GroundLayerStageRow | LandslideStageRow>): string {
  return rows
    .slice(0, 5)
    .map((row) => {
      if ("layer_label" in row) {
        return `${row.layer_label || "okand"} [${row.source_key}]`;
      }
      return `${row.feature_label || "okand"} [${row.source_key}]`;
    })
    .join("; ");
}

async function importLayer(layer: LayerName, options: CliOptions): Promise<void> {
  const config = LAYER_CONFIG[layer];
  await assertStageTableExists(config.stageTable);

  const params = new URLSearchParams({ limit: String(options.pageSize), f: "application/geo+json" });
  if (options.bbox) {
    params.set("bbox", options.bbox);
  }

  let nextUrl = `${config.baseUrl}/collections/${encodeURIComponent(config.collection)}/items?${params.toString()}`;
  let pageCount = 0;
  let importedCount = 0;
  let matchedCount: number | undefined;

  console.log(`SGU import: ${config.datasetLabel}`);
  console.log(`Mode: ${options.dryRun ? "dry-run" : "stage upsert"}`);
  console.log(`Scope: ${options.bbox ? `bbox=${options.bbox}` : "national (explicitly allowed)"}`);

  while (nextUrl) {
    console.log(options.verbose ? `Fetching page ${pageCount + 1}: ${nextUrl}` : `Fetching page ${pageCount + 1}...`);

    const response = await fetch(nextUrl, {
      headers: { Accept: "application/geo+json, application/json" },
    });

    if (!response.ok) {
      throw new Error(`SGU request failed (${response.status}): ${await response.text()}`);
    }

    const data = (await response.json()) as OgcFeatureCollection;
    matchedCount = matchedCount ?? data.numberMatched;

    if (layer === "grundlager") {
      const rows = (data.features ?? [])
        .map(mapGroundLayerFeature)
        .filter((row): row is GroundLayerStageRow => row !== null);
      const boundedRows = trimToMaxFeatures(rows, options, importedCount);

      if (boundedRows.length > 0) {
        if (options.dryRun) {
          console.log(`Dry-run page ${pageCount + 1}: mapped ${boundedRows.length} rows.`);
          console.log(`Sample: ${summarizeRows(boundedRows)}`);
        } else {
          await upsertGroundLayerBatch(boundedRows);
          console.log(`Upserted ${boundedRows.length} rows into stage.sgu_ground_layer_raw.`);
        }
        importedCount += boundedRows.length;
      }
    } else {
      const rows = (data.features ?? [])
        .map(mapLandslideFeature)
        .filter((row): row is LandslideStageRow => row !== null);
      const boundedRows = trimToMaxFeatures(rows, options, importedCount);

      if (boundedRows.length > 0) {
        if (options.dryRun) {
          console.log(`Dry-run page ${pageCount + 1}: mapped ${boundedRows.length} rows.`);
          console.log(`Sample: ${summarizeRows(boundedRows)}`);
        } else {
          await upsertLandslideBatch(boundedRows);
          console.log(`Upserted ${boundedRows.length} rows into stage.sgu_landslide_feature_raw.`);
        }
        importedCount += boundedRows.length;
      }
    }

    pageCount += 1;
    if (shouldStop(importedCount, pageCount, options)) {
      break;
    }

    const nextHref = data.links?.find((link) => link.rel === "next")?.href;
    nextUrl = nextHref ?? "";
  }

  console.log(
    `Done (${layer}). Pages: ${pageCount}, rows ${options.dryRun ? "mapped" : "upserted"}: ${importedCount}${
      matchedCount !== undefined ? `, numberMatched: ${matchedCount}` : ""
    }`,
  );
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const layers: LayerName[] =
    options.layer === "all" ? ["grundlager", "jordskred-raviner"] : [options.layer];

  for (const layer of layers) {
    await importLayer(layer, options);
  }

  console.log("Reviewed merge remains a separate step via scripts/db/merge_sgu_layers_stage_to_env.sql.");
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
