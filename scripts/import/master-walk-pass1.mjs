/**
 * Admit v1 — Pass 1: cheap master discovery (no SHA).
 *
 * Walks GEO_Master_Archive/Data and emits a candidate manifest:
 *   source_id, path, filename, extension, size_bytes, modified_time,
 *   candidate_layer, candidate_authority, candidate_format
 *
 * Usage:
 *   node scripts/import/master-walk-pass1.mjs
 *   MASTER_ARCHIVE_ROOT="H:/..." node scripts/import/master-walk-pass1.mjs
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const MASTER_ROOT =
  process.env.MASTER_ARCHIVE_ROOT ||
  "H:\\Delade enheter\\Miljöbeslut\\GEO_Master_Archive";
const DATA_ROOT = path.join(MASTER_ROOT, "Data");

const OUT_DIR = path.resolve("storage/manifests/admit-v1");
const OUT_FILE = path.join(OUT_DIR, "master-walk-pass1-candidates.json");
const OUT_LATEST = path.join(OUT_DIR, "master-walk-pass1-candidates-latest.json");
const OUT_CSV = path.join(OUT_DIR, "master-walk-pass1-candidates.csv");

/** Skip noise / ops trees that are not spatial admit candidates. */
const SKIP_DIR_NAMES = new Set([
  "node_modules",
  ".git",
  "__pycache__",
  ".tmp",
  "tmp",
]);

const SPATIAL_EXT = new Set([
  ".gpkg",
  ".shp",
  ".geojson",
  ".json",
  ".gml",
  ".tif",
  ".tiff",
  ".zip",
  ".7z",
  ".tar",
  ".gz",
  ".csv",
  ".xyz",
  ".fgb",
  ".parquet",
]);

const AUTHORITY_BY_TOP = {
  Lantmateriet: "Lantmäteriet",
  LM: "Lantmäteriet",
  SGU: "SGU",
  Naturvardsverket: "Naturvårdsverket",
  LST: "Länsstyrelsen",
  MSB: "MSB",
  VISS: "VISS/LST",
  SMHI: "SMHI",
  SMED: "SMED",
  Skogsstyrelsen: "Skogsstyrelsen",
  RAA: "RAÄ",
  MCF: "MSB/MCF",
  Trafikverket: "Trafikverket",
  MPD: "Mark- och miljödomstol",
  MMD: "Mark- och miljödomstol",
  Gbg_Luftkvalitet: "Göteborg",
  Miljolut: "INTERNAL",
  Miljobeslut_Ops: "INTERNAL",
  _migration_from_D: "LEGACY_MIGRATION",
};

/** Path/filename heuristics → proposed layer_id family (Pass 1 guess only). */
const LAYER_RULES = [
  { re: /registerenhetsomrade|fastighetsindelning|property_unit|belagenhetsadress/i, layer: "lu.property_unit" },
  { re: /brunn|sgu_well|wells/i, layer: "lu.water_wells" },
  { re: /ebh|potentiellt.?fororenad/i, layer: "lu.ebh" },
  { re: /naturreservat|skyddade.?omraden|protected_area|skyddad.?natur/i, layer: "lu.protected_area" },
  { re: /natura.?2000|natura2000/i, layer: "lu.natura2000" },
  { re: /vattenskydd/i, layer: "lu.water_protection" },
  { re: /oversvamn|flood|pfra|apsfr/i, layer: "lu.flood_risk" },
  { re: /jordart|soil.?type|sgu_soil/i, layer: "lu.soil_type" },
  { re: /jordskred|landslide|ravin/i, layer: "lu.landslide" },
  { re: /viss|vattenforekomst/i, layer: "lu.viss_waterbody" },
  { re: /topo.*vatten|vattenyta|hydrograf/i, layer: "lu.topo_water" },
  { re: /nyckelbiotop|biotopskydd|naturvardsavtal|sks_/i, layer: "lu.sks_nature" },
  { re: /fornlamning|kulturmiljo|byggnadsminne|raa/i, layer: "lu.raa_culture" },
  { re: /fastmark|stabilitet|aktsamhet/i, layer: "lu.stability" },
  { re: /grundvatten|magasin|sarbarhet/i, layer: "lu.groundwater" },
  { re: /marktacke|mark\.gpkg/i, layer: "foundation.marktacke" },
  { re: /byggnad/i, layer: "foundation.byggnad" },
  { re: /ortnamn|kommun|lan|rike|adress/i, layer: "foundation.admin" },
];

function guessLayer(relPosix, filename) {
  const hay = `${relPosix}/${filename}`;
  for (const rule of LAYER_RULES) {
    if (rule.re.test(hay)) return rule.layer;
  }
  return "unclassified";
}

function guessFormat(ext, filename) {
  const e = ext.toLowerCase();
  if (e === ".gpkg") return "gpkg";
  if (e === ".shp") return "shp";
  if (e === ".geojson" || (e === ".json" && /geo/i.test(filename))) return "geojson";
  if (e === ".gml") return "gml";
  if (e === ".tif" || e === ".tiff") return "tif";
  if (e === ".zip" || e === ".7z") return "archive";
  if (e === ".csv" || e === ".xyz") return "tabular";
  if (e === ".fgb") return "flatgeobuf";
  if (e === ".parquet") return "parquet";
  if (!e) return "unknown";
  return e.replace(/^\./, "");
}

function sourceId(top, relPosix, filename) {
  const base = path.posix.join(top, relPosix, filename).replace(/\\/g, "/");
  return base;
}

function* walkFiles(dir, relative = "") {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    yield { error: String(err?.message || err), dir };
    return;
  }
  for (const ent of entries) {
    if (SKIP_DIR_NAMES.has(ent.name)) continue;
    const abs = path.join(dir, ent.name);
    const rel = relative ? path.join(relative, ent.name) : ent.name;
    if (ent.isDirectory()) {
      yield* walkFiles(abs, rel);
    } else if (ent.isFile() || ent.isSymbolicLink()) {
      yield { abs, rel };
    }
  }
}

function main() {
  if (!fs.existsSync(DATA_ROOT)) {
    console.error(`DATA_ROOT missing: ${DATA_ROOT}`);
    process.exit(1);
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const started = Date.now();
  const candidates = [];
  const errors = [];
  let filesSeen = 0;
  let spatialish = 0;

  const tops = fs
    .readdirSync(DATA_ROOT, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();

  for (const top of tops) {
    const topAbs = path.join(DATA_ROOT, top);
    const authority = AUTHORITY_BY_TOP[top] || `UNKNOWN(${top})`;
    console.error(`[pass1] scanning ${top} …`);

    for (const item of walkFiles(topAbs)) {
      if (item.error) {
        errors.push({ top, ...item });
        continue;
      }
      filesSeen += 1;
      const filename = path.basename(item.abs);
      const ext = path.extname(filename).toLowerCase();
      // Record spatial-ish + manifests; skip tiny noise like .ds_store later via ext filter
      const isManifest =
        /manifest|checksum|sha256|sidecar|\.md5$|\.sha256$/i.test(filename);
      if (!SPATIAL_EXT.has(ext) && !isManifest) {
        continue;
      }
      spatialish += 1;

      let st;
      try {
        st = fs.statSync(item.abs);
      } catch (err) {
        errors.push({ path: item.abs, error: String(err?.message || err) });
        continue;
      }

      const relUnderTop = path.relative(topAbs, item.abs);
      const relPosix = relUnderTop.split(path.sep).join("/");
      const sid = sourceId(top, path.posix.dirname(relPosix) === "." ? "" : path.posix.dirname(relPosix), filename);

      candidates.push({
        source_id: sid.replace(/\/+/g, "/").replace(/\/$/, ""),
        path: path.join("Data", top, relUnderTop).split(path.sep).join("/"),
        absolute_path: item.abs,
        filename,
        extension: ext || "",
        size_bytes: st.size,
        modified_time: st.mtime.toISOString(),
        candidate_layer: isManifest ? "manifest_sidecar" : guessLayer(`${top}/${relPosix}`, filename),
        candidate_authority: authority,
        candidate_format: isManifest ? "manifest" : guessFormat(ext, filename),
        top_provider_folder: top,
        pass1_priority_hint: priorityHint(guessLayer(`${top}/${relPosix}`, filename), top),
      });

      if (spatialish % 500 === 0) {
        console.error(`[pass1] ${spatialish} spatialish / ${filesSeen} files…`);
      }
    }
  }

  candidates.sort((a, b) => a.path.localeCompare(b.path));

  const byLayer = {};
  const byAuthority = {};
  const byFormat = {};
  for (const c of candidates) {
    byLayer[c.candidate_layer] = (byLayer[c.candidate_layer] || 0) + 1;
    byAuthority[c.candidate_authority] =
      (byAuthority[c.candidate_authority] || 0) + 1;
    byFormat[c.candidate_format] = (byFormat[c.candidate_format] || 0) + 1;
  }

  const report = {
    pass: 1,
    mode: "metadata_only_no_sha",
    generated_at: new Date().toISOString(),
    elapsed_ms: Date.now() - started,
    master_root: MASTER_ROOT,
    data_root: DATA_ROOT,
    admit_v1_ref: "docs/architecture/ADR-POSTGIS-ADMIT-V1.md",
    totals: {
      top_folders: tops.length,
      files_seen: filesSeen,
      candidates: candidates.length,
      errors: errors.length,
    },
    histograms: { byLayer, byAuthority, byFormat },
    pass2_policy:
      "SHA-256 only after authority+format known; stream hash; store size_bytes with hash",
    empty_postgis: "BLOCKED until Admit v1 frozen",
    errors: errors.slice(0, 200),
    candidates,
  };

  // Stable-ish id for the survey run (not content hash of archives)
  report.survey_id = crypto
    .createHash("sha256")
    .update(`${report.generated_at}|${candidates.length}|${filesSeen}`)
    .digest("hex")
    .slice(0, 16);

  fs.writeFileSync(OUT_FILE, JSON.stringify(report, null, 2), "utf8");
  fs.writeFileSync(OUT_LATEST, JSON.stringify(report, null, 2), "utf8");

  const csvHeader = [
    "source_id",
    "path",
    "filename",
    "extension",
    "size_bytes",
    "modified_time",
    "candidate_layer",
    "candidate_authority",
    "candidate_format",
    "pass1_priority_hint",
  ];
  const csvLines = [csvHeader.join(",")];
  for (const c of candidates) {
    csvLines.push(
      [
        c.source_id,
        c.path,
        c.filename,
        c.extension,
        c.size_bytes,
        c.modified_time,
        c.candidate_layer,
        c.candidate_authority,
        c.candidate_format,
        c.pass1_priority_hint,
      ]
        .map(csvEscape)
        .join(","),
    );
  }
  fs.writeFileSync(OUT_CSV, csvLines.join("\n"), "utf8");

  console.log(
    JSON.stringify(
      {
        out_file: OUT_FILE,
        out_latest: OUT_LATEST,
        out_csv: OUT_CSV,
        survey_id: report.survey_id,
        totals: report.totals,
        elapsed_ms: report.elapsed_ms,
        byLayer,
        byAuthority,
      },
      null,
      2,
    ),
  );
}

function priorityHint(layer, top) {
  if (layer === "lu.property_unit" || layer === "foundation.admin") return 1;
  if (
    layer === "lu.water_wells" ||
    layer === "lu.ebh" ||
    layer === "lu.protected_area"
  ) {
    return 2;
  }
  if (
    [
      "lu.water_protection",
      "lu.natura2000",
      "lu.raa_culture",
      "lu.flood_risk",
      "lu.soil_type",
      "lu.landslide",
      "lu.viss_waterbody",
      "lu.sks_nature",
      "lu.topo_water",
    ].includes(layer)
  ) {
    return 3;
  }
  if (top === "_migration_from_D" || top === "Miljobeslut_Ops") return 9;
  return 4;
}

function csvEscape(v) {
  const s = String(v ?? "");
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

main();
