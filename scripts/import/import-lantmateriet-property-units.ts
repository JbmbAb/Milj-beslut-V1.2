import "dotenv/config";

import { PrismaClient } from "@prisma/client";

type JsonObject = Record<string, unknown>;

interface CliOptions {
  municipalityCode?: string;
  municipalityName?: string;
  tract?: string;
  block?: string;
  unit?: number;
  areaNumber?: number;
  label?: string;
  filter?: string;
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
  numberReturned?: number;
}

interface StageRow {
  source_key: string;
  designation: string;
  municipality_code: string | null;
  municipality_name: string | null;
  county_code: string | null;
  source_updated_at: string | null;
  raw_properties: JsonObject;
  geom_geojson: JsonObject;
}

console.log(`DEBUG: DATABASE_URL is ${process.env.DATABASE_URL}`);
const prisma = new PrismaClient();

function printUsage(): void {
  console.log(`
Usage:
  npx tsx scripts/import/import-lantmateriet-property-units.ts [options]

Scope is mandatory. This script refuses national full import.

Examples:
  npx tsx scripts/import/import-lantmateriet-property-units.ts --municipality-code 0182 --dry-run
  npx tsx scripts/import/import-lantmateriet-property-units.ts --municipality-name NACKA --tract ORMINGE --max-features 200
  npx tsx scripts/import/import-lantmateriet-property-units.ts --filter "kommunkod = '0182' AND trakt = 'ORMINGE'" --dry-run

Options:
  --municipality-code <code>   Filter by kommunkod
  --municipality-name <name>   Filter by kommunnamn (stored uppercased)
  --tract <name>               Filter by trakt (stored uppercased)
  --block <value>              Filter by block
  --unit <number>              Filter by enhet
  --area-number <number>       Filter by omradesnummer
  --label <value>              Filter by etikett
  --filter <cql2>              Raw cql2-text filter. Cannot be combined with structured filters.
  --page-size <n>              Page size per OGC request (default 500)
  --max-pages <n>              Stop after n pages
  --max-features <n>           Stop after n imported features
  --dry-run                    Fetch and map, but do not write to database
  --verbose                    Log each page URL
  --help                       Show this help
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
      case "--municipality-code":
        options.municipalityCode = requireValue(arg).trim();
        break;
      case "--municipality-name":
        options.municipalityName = requireValue(arg).trim().toUpperCase();
        break;
      case "--tract":
        options.tract = requireValue(arg).trim().toUpperCase();
        break;
      case "--block":
        options.block = requireValue(arg).trim();
        break;
      case "--unit":
        options.unit = parsePositiveInt(requireValue(arg), arg);
        break;
      case "--area-number":
        options.areaNumber = parsePositiveInt(requireValue(arg), arg);
        break;
      case "--label":
        options.label = requireValue(arg).trim();
        break;
      case "--filter":
        options.filter = requireValue(arg).trim();
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

  const structuredFilterCount = [
    options.municipalityCode,
    options.municipalityName,
    options.tract,
    options.block,
    options.unit,
    options.areaNumber,
    options.label,
  ].filter((value) => value !== undefined).length;

  if (!options.filter && structuredFilterCount === 0) {
    throw new Error(
      "Scoped filter is required. Use --municipality-code, --municipality-name, --tract, --label or --filter. National full import is intentionally blocked.",
    );
  }

  if (options.filter && structuredFilterCount > 0) {
    throw new Error("--filter cannot be combined with structured filter flags.");
  }

  return options;
}

function escapeCqlString(value: string): string {
  return value.replace(/'/g, "''");
}

function buildCqlFilter(options: CliOptions): string {
  if (options.filter) {
    return options.filter;
  }

  const clauses: string[] = [];

  if (options.municipalityCode) {
    clauses.push(`kommunkod = '${escapeCqlString(options.municipalityCode)}'`);
  }
  if (options.municipalityName) {
    clauses.push(`kommunnamn = '${escapeCqlString(options.municipalityName)}'`);
  }
  if (options.tract) {
    clauses.push(`trakt = '${escapeCqlString(options.tract)}'`);
  }
  if (options.block) {
    clauses.push(`block = '${escapeCqlString(options.block)}'`);
  }
  if (options.unit !== undefined) {
    clauses.push(`enhet = ${options.unit}`);
  }
  if (options.areaNumber !== undefined) {
    clauses.push(`omradesnummer = ${options.areaNumber}`);
  }
  if (options.label) {
    clauses.push(`etikett = '${escapeCqlString(options.label)}'`);
  }

  if (clauses.length === 0) {
    throw new Error("No scoped filter clauses were built.");
  }

  return clauses.join(" AND ");
}

async function getAccessToken(baseUrl: string): Promise<string> {
  const directAccessToken = process.env.LANTMATERIET_ACCESS_TOKEN?.trim();
  if (directAccessToken) {
    return directAccessToken;
  }

  const consumerKey = process.env.LANTMATERIET_CONSUMER_KEY?.trim();
  const consumerSecret = process.env.LANTMATERIET_CONSUMER_SECRET?.trim();
  if (!consumerKey || !consumerSecret) {
    throw new Error("Missing LANTMATERIET_ACCESS_TOKEN or consumer key/secret.");
  }

  const configuredTokenUrl = process.env.LANTMATERIET_TOKEN_URL?.trim();
  const tokenUrl = configuredTokenUrl ? configuredTokenUrl : `${new URL(baseUrl).origin}/token`;
  const scope = process.env.LANTMATERIET_SCOPE?.trim() || "ogc-features:fastighetsindelning.read";
  const credentials = Buffer.from(`${consumerKey}:${consumerSecret}`).toString("base64");

  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: `grant_type=client_credentials&scope=${encodeURIComponent(scope)}`,
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch token (${response.status}): ${await response.text()}`);
  }

  const data = (await response.json()) as { access_token?: string };
  if (!data.access_token) {
    throw new Error("Token response did not include access_token.");
  }

  return data.access_token;
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

function buildDesignation(properties: JsonObject): string | null {
  const municipalityName = safeString(properties.kommunnamn);
  const tract = safeString(properties.trakt);
  const label = safeString(properties.etikett);

  if (!label) {
    return null;
  }

  const labelUpper = label.toUpperCase();
  const tractUpper = tract?.toUpperCase();
  const municipalityUpper = municipalityName?.toUpperCase();

  const parts: string[] = [];
  if (municipalityName && !labelUpper.startsWith(`${municipalityUpper} `)) {
    parts.push(municipalityName);
  }
  if (tract && tractUpper !== labelUpper && !labelUpper.startsWith(`${tractUpper} `)) {
    parts.push(tract);
  }
  parts.push(label);

  return parts.join(" ").replace(/\s+/g, " ").trim();
}

function mapFeatureToStageRow(feature: OgcFeature): StageRow | null {
  const properties = feature.properties ?? {};
  const geometry = feature.geometry;

  if (!geometry || typeof geometry !== "object") {
    return null;
  }

  const sourceKey =
    safeString(properties.objektidentitet) ??
    safeString(properties.registerenhetsreferens) ??
    safeString(feature.id);
  const designation = buildDesignation(properties);

  if (!sourceKey || !designation) {
    return null;
  }

  const sourceUpdatedAt = safeString(properties.senastandrad);

  return {
    source_key: sourceKey,
    designation,
    municipality_code: safeString(properties.kommunkod),
    municipality_name: safeString(properties.kommunnamn),
    county_code: safeString(properties.lanskod),
    source_updated_at: sourceUpdatedAt,
    raw_properties: properties,
    geom_geojson: geometry,
  };
}

async function assertStageTableExists(): Promise<void> {
  try {
    await prisma.$executeRawUnsafe('SELECT 1 FROM stage.property_unit_raw LIMIT 1');
  } catch (e: any) {
    console.error(`DEBUG: Table check failed: ${e.message}`);
    throw new Error(
      "stage.property_unit_raw does not exist. Run scripts/enable_postgis.sql and scripts/db/create_property_unit_pipeline.sql first.",
    );
  }
}

async function upsertBatch(rows: StageRow[]): Promise<void> {
  if (rows.length === 0) {
    return;
  }

  const payload = JSON.stringify(rows);

  await prisma.$executeRaw`
    WITH payload AS (
      SELECT *
      FROM jsonb_to_recordset(${payload}::jsonb) AS x(
        source_key text,
        designation text,
        municipality_code text,
        municipality_name text,
        county_code text,
        source_updated_at timestamptz,
        raw_properties jsonb,
        geom_geojson jsonb
      )
    )
    INSERT INTO stage.property_unit_raw (
      source_key,
      designation,
      municipality_code,
      municipality_name,
      county_code,
      geom,
      raw_properties,
      imported_at
    )
    SELECT
      p.source_key,
      p.designation,
      p.municipality_code,
      p.municipality_name,
      p.county_code,
      ST_Multi(
        ST_CollectionExtract(
          ST_MakeValid(
            ST_SetSRID(ST_GeomFromGeoJSON(p.geom_geojson::text), 3006)
          ),
          3
        )
      )::geometry(MultiPolygon, 3006),
      p.raw_properties,
      now()
    FROM payload p
    WHERE p.geom_geojson IS NOT NULL
    ON CONFLICT (source_key) DO UPDATE
    SET
      designation = EXCLUDED.designation,
      municipality_code = EXCLUDED.municipality_code,
      municipality_name = EXCLUDED.municipality_name,
      county_code = EXCLUDED.county_code,
      geom = EXCLUDED.geom,
      raw_properties = EXCLUDED.raw_properties,
      imported_at = now()
  `;
}

function summarizeRows(rows: StageRow[]): string {
  return rows
    .slice(0, 5)
    .map((row) => `${row.designation} [${row.source_key}]`)
    .join("; ");
}

function shouldStop(totalRows: number, pageCount: number, options: CliOptions): boolean {
  if (options.maxFeatures && totalRows >= options.maxFeatures) {
    return true;
  }
  if (options.maxPages && pageCount >= options.maxPages) {
    return true;
  }
  return false;
}

function trimToMaxFeatures(rows: StageRow[], options: CliOptions, importedCount: number): StageRow[] {
  if (!options.maxFeatures) {
    return rows;
  }
  const remaining = options.maxFeatures - importedCount;
  if (remaining <= 0) {
    return [];
  }
  return rows.slice(0, remaining);
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const baseUrl = (process.env.LANTMATERIET_BASE_URL || "https://api.lantmateriet.se/ogc-features/v1").replace(/\/+$/, "");
  const collection = process.env.LANTMATERIET_OGC_COLLECTION || "registerenhetsomradesytor";
  const token = await getAccessToken(baseUrl);
  const cqlFilter = buildCqlFilter(options);
  const baseItemsUrl = `${baseUrl}/fastighetsindelning/collections/${encodeURIComponent(collection)}/items`;

  // await assertStageTableExists();

  console.log("Lantmateriet property import");
  console.log(`Collection: ${collection}`);
  console.log(`Filter: ${cqlFilter}`);
  console.log(`Mode: ${options.dryRun ? "dry-run" : "stage upsert"}`);

  let nextUrl = `${baseItemsUrl}?filter=${encodeURIComponent(cqlFilter)}&filter-lang=cql2-text&limit=${options.pageSize}`;
  let pageCount = 0;
  let importedCount = 0;
  let matchedCount: number | undefined;

  while (nextUrl) {
    if (options.verbose) {
      console.log(`Fetching page ${pageCount + 1}: ${nextUrl}`);
    } else {
      console.log(`Fetching page ${pageCount + 1}...`);
    }

    console.log(`DEBUG: Fetching ${nextUrl}`);
    const response = await fetch(nextUrl, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/geo+json, application/json",
      },
    });

    if (!response.ok) {
      throw new Error(`OGC request failed (${response.status}): ${await response.text()}`);
    }

    const data = (await response.json()) as OgcFeatureCollection;
    matchedCount = matchedCount ?? data.numberMatched;
    const rows = (data.features ?? [])
      .map(mapFeatureToStageRow)
      .filter((row): row is StageRow => row !== null);

    const boundedRows = trimToMaxFeatures(rows, options, importedCount);
    if (boundedRows.length > 0) {
      if (options.dryRun) {
        console.log(`Dry-run page ${pageCount + 1}: mapped ${boundedRows.length} rows.`);
        console.log(`Sample: ${summarizeRows(boundedRows)}`);
      } else {
        await upsertBatch(boundedRows);
        console.log(`Upserted ${boundedRows.length} rows into stage.property_unit_raw.`);
      }
      importedCount += boundedRows.length;
    } else {
      console.log(`Page ${pageCount + 1}: no importable rows after mapping.`);
    }

    pageCount += 1;

    if (shouldStop(importedCount, pageCount, options)) {
      break;
    }

    const nextHref = data.links?.find((link) => link.rel === "next")?.href;
    nextUrl = nextHref ?? "";
  }

  console.log(
    `Done. Pages: ${pageCount}, rows ${options.dryRun ? "mapped" : "upserted"}: ${importedCount}${
      matchedCount !== undefined ? `, numberMatched: ${matchedCount}` : ""
    }`,
  );
  console.log("Merge to core.property_unit remains a separate manual/granskad step.");
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
