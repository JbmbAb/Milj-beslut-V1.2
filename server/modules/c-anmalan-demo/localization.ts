/**
 * Lokaliseringsavsnitt for DEMO-01 (K-26 §3).
 *
 * Same read-only layer queries as the testcase folder
 * (Claude outputs/demo-01-testcase-orsa-stackmora-3-12/mimer-db-evidence/02–05), run in a
 * READ ONLY transaction. Each result row carries the runtime-bound import batch and its bundle
 * hash from "PostgisImportBatch". Nothing here is inferred: missing data becomes
 * "ej analyserat", never a default.
 *
 * NOT the governed LU chain. The section is labelled LOCALIZATION_LABEL until D4-lite.
 * Deliberately does not import massGisService / spatialAuditService (import-scan test).
 */
import { prisma } from '../../../db.server';
import type { ProposalRow } from './types';

export const LOCALIZATION_LABEL =
  'Lokalisering: befintliga lagerfrågor, ej governed – ersätts av governed LU-kedja (W-serien)';

export const NOT_ANALYZED_MISSING = 'ej analyserat – underlag saknas';
export const NOT_ANALYZED_INCOMPLETE = 'ej analyserat – underlag ofullständigt';

interface BatchRow {
  layer: string;
  dataset_version: string | null;
  row_count: number | null;
  content_bundle_sha256: string | null;
}

export interface LayerFacts {
  propertyFound: boolean;
  municipality: string | null;
  areaM2: number | null;
  parts: number | null;
  wells: { within100: number; within300: number; nearestM: number | null; uses300: Array<{ distM: number; anvandning: string | null }> };
  ebh: { within500: number; nearestM: number | null };
  protectedArea: { intersects: number; within500: number };
  natura2000: { within1000: number };
  waterProtection: { within500: number };
  catchment: Array<{ name: string | null; msCd: string | null; versionSvar: string | null }>;
  stability: { landslide500: number; msbStab500: number; fastmarkIntersect: number; aktsamhetIntersect: number };
  flood: { intersects: number };
  nyckelbiotop: { within500: number };
  soil: { soilTypeIntersects: number; soil25kIntersects: number; soilTypeRows: number; soil25kRows: number };
  surfaceWaterLayerPresent: boolean;
  demLayerPresent: boolean;
  batches: Record<string, BatchRow>;
}

/** Runs all layer queries for one property in a single READ ONLY transaction. */
export async function readLayerFacts(designation: string): Promise<LayerFacts> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
    await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '120s'");

    // Same exact-designation predicate as the testcase SQL, plus the indexed designation_norm
    // so the 4.4M-row table is not scanned once per layer; later queries use the row id.
    const prop = await tx.$queryRaw<Array<{ id: number; municipality_name: string | null; area_m2: number | null; parts: number | null }>>`
      SELECT id, municipality_name, round(ST_Area(geom))::float8 AS area_m2, ST_NumGeometries(geom)::int AS parts
      FROM core.property_unit
      WHERE designation_norm = core.normalize_designation(${designation}) AND designation = ${designation} LIMIT 1`;
    const batches = await tx.$queryRaw<BatchRow[]>`
      SELECT DISTINCT ON (target_schema, target_table) target_schema||'.'||target_table AS layer,
             dataset_version, row_count::int AS row_count, content_bundle_sha256
      FROM "PostgisImportBatch" WHERE status = 'SUCCESS'
      ORDER BY target_schema, target_table, completed_at DESC NULLS LAST, imported_at DESC`;
    const batchMap = Object.fromEntries(batches.map((b) => [b.layer, b]));

    const empty: LayerFacts = {
      propertyFound: false, municipality: null, areaM2: null, parts: null,
      wells: { within100: 0, within300: 0, nearestM: null, uses300: [] },
      ebh: { within500: 0, nearestM: null }, protectedArea: { intersects: 0, within500: 0 },
      natura2000: { within1000: 0 }, waterProtection: { within500: 0 }, catchment: [],
      stability: { landslide500: 0, msbStab500: 0, fastmarkIntersect: 0, aktsamhetIntersect: 0 },
      flood: { intersects: 0 }, nyckelbiotop: { within500: 0 },
      soil: { soilTypeIntersects: 0, soil25kIntersects: 0, soilTypeRows: 0, soil25kRows: 0 },
      surfaceWaterLayerPresent: false, demLayerPresent: false, batches: batchMap,
    };
    if (!prop[0]) return empty;
    const propertyId = prop[0].id;

    const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));
    const [w] = await tx.$queryRaw<Array<Record<string, unknown>>>`
      WITH p AS (SELECT geom FROM core.property_unit WHERE id = ${propertyId})
      SELECT (SELECT count(*) FROM env.sgu_well w, p WHERE ST_DWithin(w.geom,p.geom,100))::int AS within_100m,
             (SELECT count(*) FROM env.sgu_well w, p WHERE ST_DWithin(w.geom,p.geom,300))::int AS within_300m,
             (SELECT round(min(ST_Distance(w.geom,p.geom))) FROM env.sgu_well w, p WHERE ST_DWithin(w.geom,p.geom,2000))::float8 AS nearest_m`;
    // Only distance and use are kept; neighbouring property ids and free-text location are dropped.
    const uses = await tx.$queryRaw<Array<{ dist_m: number; anvandning: string | null }>>`
      WITH p AS (SELECT geom FROM core.property_unit WHERE id = ${propertyId})
      SELECT round(ST_Distance(w.geom,p.geom))::float8 AS dist_m, (to_jsonb(w)->>'anvandning') AS anvandning
      FROM env.sgu_well w, p WHERE ST_DWithin(w.geom,p.geom,300) ORDER BY 1`;
    const [e] = await tx.$queryRaw<Array<Record<string, unknown>>>`
      WITH p AS (SELECT geom FROM core.property_unit WHERE id = ${propertyId})
      SELECT count(*)::int AS ebh_within_500m, round(min(ST_Distance(e.geom,p.geom)))::float8 AS nearest_m
      FROM env.ebh_potentiellt_fororenade_omraden e, p WHERE ST_DWithin(e.geom,p.geom,500)`;
    const [pa] = await tx.$queryRaw<Array<Record<string, unknown>>>`
      WITH p AS (SELECT geom FROM core.property_unit WHERE id = ${propertyId})
      SELECT (SELECT count(*) FROM env.protected_area a, p WHERE ST_Intersects(a.geom,p.geom))::int AS intersects,
             (SELECT count(*) FROM env.protected_area a, p WHERE ST_DWithin(a.geom,p.geom,500))::int AS within_500m,
             (SELECT count(*) FROM env.natura2000_area a, p WHERE ST_DWithin(a.geom,p.geom,1000))::int AS n2k_within_1000m,
             (SELECT count(*) FROM env.water_protection_area a, p WHERE ST_DWithin(a.geom,p.geom,500))::int AS wpa_within_500m`;
    const catchment = await tx.$queryRaw<Array<{ name: string | null; ms_cd: string | null; version_svar: string | null }>>`
      WITH p AS (SELECT geom FROM core.property_unit WHERE id = ${propertyId})
      SELECT a.name, a.ms_cd, a.version_svar FROM hydro.water_catchment a, p WHERE ST_Intersects(a.geom,p.geom) LIMIT 3`;
    const [st] = await tx.$queryRaw<Array<Record<string, unknown>>>`
      WITH p AS (SELECT geom FROM core.property_unit WHERE id = ${propertyId})
      SELECT (SELECT count(*) FROM env.sgu_landslide_feature a, p WHERE ST_DWithin(a.geom,p.geom,500))::int AS landslide_500m,
             (SELECT count(*) FROM env.msb_stabilitetszon a, p WHERE ST_DWithin(a.geom,p.geom,500))::int AS msb_stab_500m,
             (SELECT count(*) FROM env.sgu_fastmark_stabilitet a, p WHERE ST_Intersects(a.geom,p.geom))::int AS fastmark_intersect,
             (SELECT count(*) FROM env.sgu_aktsamhet_efterarbetad a, p WHERE ST_Intersects(a.geom,p.geom))::int AS aktsamhet_intersect,
             (SELECT count(*) FROM climate.flood_risk_area a, p WHERE ST_Intersects(a.geom,p.geom))::int AS flood_intersect,
             (SELECT count(*) FROM env.sks_nyckelbiotoper a, p WHERE ST_DWithin(a.geom,p.geom,500))::int AS nyckelbiotop_500m`;
    const [so] = await tx.$queryRaw<Array<Record<string, unknown>>>`
      WITH p AS (SELECT geom FROM core.property_unit WHERE id = ${propertyId})
      SELECT (SELECT count(*) FROM env.sgu_soil_type s, p WHERE ST_Intersects(s.geom,p.geom))::int AS soil_intersects,
             (SELECT count(*) FROM env.sgu_soil_type_25k_100k s, p WHERE ST_Intersects(s.geom,p.geom))::int AS soil25k_intersects,
             (SELECT count(*) FROM env.sgu_soil_type)::int AS soil_rows,
             (SELECT count(*) FROM env.sgu_soil_type_25k_100k)::int AS soil25k_rows`;
    const [reg] = await tx.$queryRaw<Array<{ vatten: string | null; dem: number }>>`
      SELECT to_regclass('topo10.vatten')::text AS vatten,
             (SELECT count(*) FROM information_schema.tables
               WHERE table_name ILIKE ANY (ARRAY['%hojdmodell%','%höjdmodell%','%dem%','%elevation%'])
                 AND table_schema IN ('env','topo10','hydro','climate'))::int AS dem`;

    return {
      propertyFound: true,
      municipality: prop[0].municipality_name,
      areaM2: n(prop[0].area_m2),
      parts: n(prop[0].parts),
      wells: {
        within100: Number(w.within_100m), within300: Number(w.within_300m), nearestM: n(w.nearest_m),
        uses300: uses.map((u) => ({ distM: Number(u.dist_m), anvandning: u.anvandning })),
      },
      ebh: { within500: Number(e.ebh_within_500m), nearestM: n(e.nearest_m) },
      protectedArea: { intersects: Number(pa.intersects), within500: Number(pa.within_500m) },
      natura2000: { within1000: Number(pa.n2k_within_1000m) },
      waterProtection: { within500: Number(pa.wpa_within_500m) },
      catchment: catchment.map((c) => ({ name: c.name, msCd: c.ms_cd, versionSvar: c.version_svar })),
      stability: {
        landslide500: Number(st.landslide_500m), msbStab500: Number(st.msb_stab_500m),
        fastmarkIntersect: Number(st.fastmark_intersect), aktsamhetIntersect: Number(st.aktsamhet_intersect),
      },
      flood: { intersects: Number(st.flood_intersect) },
      nyckelbiotop: { within500: Number(st.nyckelbiotop_500m) },
      soil: {
        soilTypeIntersects: Number(so.soil_intersects), soil25kIntersects: Number(so.soil25k_intersects),
        soilTypeRows: Number(so.soil_rows), soil25kRows: Number(so.soil25k_rows),
      },
      surfaceWaterLayerPresent: Boolean(reg.vatten),
      demLayerPresent: Number(reg.dem) > 0,
      batches: batchMap,
    };
  }, { timeout: 150_000, maxWait: 10_000 });
}

/** Pure: facts → proposal rows. Every row names its layer, batch and bundle hash, or says "ej analyserat". */
export function localizationRows(f: LayerFacts): ProposalRow[] {
  const rows: ProposalRow[] = [];
  const layerProv = (layer: string, query: string) => ({
    kind: 'mimer_layer' as const,
    layer,
    datasetVersion: f.batches[layer]?.dataset_version ?? null,
    bundleSha256: f.batches[layer]?.content_bundle_sha256 ?? null,
    query,
  });
  const add = (id: string, label: string, text: string, layer: string, query: string, note?: string) => {
    // A fact from a layer without a runtime-bound import batch has no provenance: not shown.
    const unbound = !f.batches[layer]?.content_bundle_sha256 && !text.startsWith('ej analyserat');
    rows.push({
      id: `lok-${id}`,
      section: 'lokalisering',
      label,
      text: unbound ? `${NOT_ANALYZED_MISSING}: ingen bunden importbatch för ${layer}` : text,
      provenance: layerProv(layer, query),
      note,
    });
  };

  if (!f.propertyFound) {
    add('fastighet', 'Fastighet', `${NOT_ANALYZED_MISSING}: fastigheten finns inte i core.property_unit`, 'env.registerenhetsomradesytor', 'core.property_unit designation =');
    return rows;
  }
  add('fastighet', 'Fastighet', `${f.parts ?? '?'} skiften, total yta ${f.areaM2?.toLocaleString('sv-SE') ?? '?'} m², kommun ${f.municipality ?? '?'}`, 'env.registerenhetsomradesytor', 'core.property_unit ST_Area/ST_NumGeometries');

  const useCounts = new Map<string, number>();
  for (const u of f.wells.uses300) useCounts.set(u.anvandning ?? 'okänd användning', (useCounts.get(u.anvandning ?? 'okänd användning') ?? 0) + 1);
  const useText = [...useCounts].map(([k, v]) => `${v} ${k}`).join(', ');
  add('brunnar', 'Brunnar (SGU brunnsarkiv)',
    `${f.wells.within100} inom 100 m; ${f.wells.within300} inom 300 m${useText ? ` (${useText})` : ''}; närmaste ${f.wells.nearestM ?? 'ingen inom 2 000'} m`,
    'env.sgu_well', 'ST_DWithin 100/300 m, min ST_Distance inom 2 000 m');
  add('ebh', 'Potentiellt förorenade områden (EBH)', `${f.ebh.within500} inom 500 m`, 'env.ebh_potentiellt_fororenade_omraden', 'ST_DWithin 500 m');
  add('skydd', 'Naturreservat / skyddade områden', `${f.protectedArea.intersects} korsar fastigheten; ${f.protectedArea.within500} inom 500 m`, 'env.protected_area', 'ST_Intersects, ST_DWithin 500 m');
  add('natura2000', 'Natura 2000 (SPA)', `${f.natura2000.within1000} inom 1 000 m`, 'env.natura2000_area', 'ST_DWithin 1 000 m',
    'lagret är ofullständigt (D-5): frånvaro kan inte påstås');
  add('vattenskydd', 'Vattenskyddsområde', `${f.waterProtection.within500} inom 500 m`, 'env.water_protection_area', 'ST_DWithin 500 m',
    'förbehåll PL-1: lagret innehåller en ogiltig polygon');
  add('avrinning', 'Avrinningsområde (SVAR)',
    f.catchment.length ? f.catchment.map((c) => `${c.name ?? '?'} (${c.msCd ?? '?'}, SVAR ${c.versionSvar ?? '?'})`).join('; ') : '0 träffar',
    'hydro.water_catchment', 'ST_Intersects', 'kontext, inte kommunal bedömning');
  add('skred', 'Skred / stabilitet',
    `skredföreteelser inom 500 m: ${f.stability.landslide500}; MSB stabilitetszon inom 500 m: ${f.stability.msbStab500}; SGU fastmark korsar: ${f.stability.fastmarkIntersect}; aktsamhetsområde korsar: ${f.stability.aktsamhetIntersect}`,
    'env.sgu_landslide_feature', 'ST_DWithin 500 m / ST_Intersects (fyra lager)');
  add('oversvamning', 'Översvämning', `${f.flood.intersects} korsar fastigheten`, 'climate.flood_risk_area', 'ST_Intersects');
  add('nyckelbiotop', 'Nyckelbiotoper', `${f.nyckelbiotop.within500} inom 500 m`, 'env.sks_nyckelbiotoper', 'ST_DWithin 500 m');

  const soilCovered = f.soil.soilTypeIntersects + f.soil.soil25kIntersects > 0;
  add('jordart', 'Jordart',
    soilCovered
      ? `jordartspolygoner som korsar fastigheten: ${f.soil.soilTypeIntersects} (sgu_soil_type), ${f.soil.soil25kIntersects} (25k–100k)`
      : `${NOT_ANALYZED_INCOMPLETE}: ingen jordartspolygon täcker fastigheten (sgu_soil_type ${f.soil.soilTypeRows} rader; sgu_soil_type_25k_100k ${f.soil.soil25kRows} rader, trunkerat, OD-09)`,
    'env.sgu_soil_type_25k_100k', 'ST_Intersects mot sgu_soil_type och sgu_soil_type_25k_100k',
    soilCovered ? undefined : 'jordart för lagringsytan är användarens uppgift');
  add('lutning', 'Lutning',
    f.demLayerPresent ? `${NOT_ANALYZED_MISSING}: höjdmodell finns men används inte i demon` : `${NOT_ANALYZED_MISSING}: ingen höjdmodell admitterad`,
    'höjdmodell', 'information_schema: tabeller för höjdmodell', 'lutning och avrinning på ytan är användarens uppgift');
  add('ytvatten', 'Ytvatten / strandskydd',
    f.surfaceWaterLayerPresent ? `${NOT_ANALYZED_MISSING}: hydrografi används inte i demon` : `${NOT_ANALYZED_MISSING}: ingen hydrografi admitterad (topo10.vatten saknas)`,
    'topo10.vatten', "to_regclass('topo10.vatten')", 'avstånd till ytvatten är användarens uppgift');
  return rows;
}
