/**
 * Admit v1 — Pass 2: stream SHA-256 for classified canonical candidates.
 *
 * Does NOT hash the full archive. Reads files in chunks; records size_bytes
 * with hash for later verification without re-hash when size unchanged.
 *
 * Usage:
 *   node scripts/import/master-walk-pass2-sha.mjs
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";

const MASTER_ROOT =
  process.env.MASTER_ARCHIVE_ROOT ||
  "H:\\Delade enheter\\Miljöbeslut\\GEO_Master_Archive";
const DATA_ROOT = path.join(MASTER_ROOT, "Data");
const OUT_DIR = path.resolve("storage/manifests/admit-v1");
const OUT_JSON = path.join(OUT_DIR, "master-walk-pass2-sha-ledger.json");
const OUT_LATEST = path.join(OUT_DIR, "master-walk-pass2-sha-ledger-latest.json");
const DOC_OUT = path.resolve("docs/architecture/admit-v1/master-walk-pass2-sha-ledger.json");

/** Canonical Admit v1 candidates — one primary source file per layer_id. */
const CANONICALS = [
  {
    layer_id: "lu.property_unit",
    authority: "Lantmäteriet",
    source_id: "Lantmateriet/Fastighetsindelning_Nationell/Registerenhetsomradesytor/2026-06-28",
    relative_path:
      "Lantmateriet/Fastighetsindelning_Nationell/Registerenhetsomradesytor/2026-06-28/raw/registerenhetsomradesytor_nationell.gpkg",
    format: "gpkg",
    admit_status: "pending_sha",
    notes: "National register polygons (newer harvest preferred over 2026-06-18)",
  },
  {
    layer_id: "lu.water_wells",
    authority: "SGU",
    source_id: "SGU/brunnar/2026-06-19",
    relative_path: "SGU/brunnar/2026-06-19/raw/brunnar.gpkg",
    format: "gpkg",
    admit_status: "pending_sha",
    notes: "Prefer non-extracted GPKG over later extracted duplicates",
  },
  {
    layer_id: "lu.ebh",
    authority: "Länsstyrelsen",
    source_id: "LST/EBH_Potentiellt_fororenade_omraden/2026-07-23",
    relative_path:
      "LST/EBH_Potentiellt_fororenade_omraden/2026-07-23/raw/ebh_potentiellt_fororenade_omraden.gpkg",
    format: "gpkg",
    admit_status: "pending_sha",
    notes: "Latest dated GPKG harvest",
  },
  {
    layer_id: "lu.protected_area",
    authority: "Naturvårdsverket",
    source_id: "Naturvardsverket/SkyddadeOmraden/Naturreservat/legacy-adopted-2026-07-20",
    relative_path:
      "Naturvardsverket/SkyddadeOmraden/Naturreservat/legacy-adopted-2026-07-20/NR_polygon.shp",
    format: "shp",
    admit_status: "pending_sha",
    notes: "Primary .shp; sidecars listed separately",
  },
  {
    layer_id: "lu.water_protection",
    authority: "Naturvårdsverket",
    source_id: "Naturvardsverket/Vatten/Vattenskyddsomrade/legacy-adopted-2026-07-20",
    relative_path:
      "Naturvardsverket/Vatten/Vattenskyddsomrade/legacy-adopted-2026-07-20/VSO_polygon.shp",
    format: "shp",
    admit_status: "pending_sha",
    notes: "NV candidate only — LST vattenskydd absent in Pass 1; authority still NV xor LST",
  },
  {
    layer_id: "lu.natura2000",
    authority: "Naturvårdsverket",
    source_id: "Naturvardsverket/Natura2000/2026-05-08/SPA_Rikstackande",
    relative_path:
      "Naturvardsverket/Natura2000/2026-05-08/SPA_Rikstackande/SPA_rikstackande.shp",
    format: "shp",
    admit_status: "pending_sha",
    notes: "SPA rikstäckande; SCI split files remain additional candidates",
  },
  {
    layer_id: "lu.raa_culture",
    authority: "RAÄ",
    source_id: "RAA/Kulturhistoriska_lamningar/2026-06-29",
    relative_path:
      "RAA/Kulturhistoriska_lamningar/2026-06-29/raw/lämningar_sverige.gpkg",
    format: "gpkg",
    admit_status: "pending_sha",
    notes: "Primary lämningar GPKG — ADMIT still requires IMPORT_REGISTRY or OUT_OF_SCOPE",
  },
  {
    layer_id: "lu.flood_risk",
    authority: "MSB",
    source_id: "MSB/oversvamning_nationell/2026-07-23",
    relative_path:
      "MSB/oversvamning_nationell/2026-07-23/raw/msb_oversvamning_nationell.gpkg",
    format: "gpkg",
    admit_status: "pending_sha",
    notes: "Latest national flood GPKG",
  },
  {
    layer_id: "lu.soil_type",
    authority: "SGU",
    source_id: "SGU/Jordarter25k100k/2026-06-13_123533",
    relative_path: "SGU/Jordarter25k100k/2026-06-13_123533/raw/Jordarter25k100k.gpkg",
    format: "gpkg",
    admit_status: "pending_sha",
    notes: "Full soil GPKG (~1.5 GB); ignore tiny MCF false-positives",
  },
  {
    layer_id: "lu.landslide",
    authority: "SGU",
    source_id: "SGU/Jordskred/2026-07-06_035736",
    relative_path: "SGU/Jordskred/2026-07-06_035736/raw/extracted/jordskred_raviner.gpkg",
    format: "gpkg",
    admit_status: "pending_sha",
    notes: "SGU jordskred/raviner extracted GPKG",
  },
  {
    layer_id: "lu.viss_waterbody",
    authority: "SMHI/VISS",
    source_id: "SMHI/water_catchment_svar_2022/legacy-adopted-2026-07-20",
    relative_path:
      "SMHI/water_catchment_svar_2022/legacy-adopted-2026-07-20/SVAR2022_vattenforekomstavrinningsomraden.gpkg",
    format: "gpkg",
    admit_status: "pending_sha",
    notes: "SVAR2022 catchment — confirm VISS vs SMHI authority labeling before ADMIT",
  },
  {
    layer_id: "lu.sks_nature",
    authority: "Skogsstyrelsen",
    source_id: "Skogsstyrelsen/SksNyckelbiotoper/2026-06-28_121057",
    relative_path:
      "Skogsstyrelsen/SksNyckelbiotoper/2026-06-28_121057/raw/nyckelbiotoper.gpkg",
    format: "gpkg",
    admit_status: "pending_sha",
    notes: "Nyckelbiotoper GPKG",
  },
  {
    layer_id: "lu.topo_water",
    authority: "Lantmäteriet",
    source_id: "Lantmateriet/Topografi50/hydrografi_sverige",
    relative_path: "Lantmateriet/Topografi50/hydrografi_sverige/hydrografi_sverige.gpkg",
    format: "gpkg",
    admit_status: "pending_sha",
    notes: "Topo50 hydrografi as water foundation candidate",
  },
];

const CHUNK = 4 * 1024 * 1024; // 4 MiB — friendlier on Shared Drive
const MAX_RETRIES = 6;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Stream SHA-256 with resume on transient Shared Drive cancel/EIO.
 */
async function sha256File(absPath) {
  const st = fs.statSync(absPath);
  const total = st.size;
  let offset = 0;
  let attempt = 0;
  const hash = crypto.createHash("sha256");

  while (offset < total) {
    try {
      const fd = fs.openSync(absPath, "r");
      try {
        const buf = Buffer.allocUnsafe(Math.min(CHUNK, total - offset));
        while (offset < total) {
          const toRead = Math.min(CHUNK, total - offset);
          const bytesRead = fs.readSync(fd, buf, 0, toRead, offset);
          if (bytesRead <= 0) {
            throw new Error(`short read at offset=${offset}`);
          }
          hash.update(buf.subarray(0, bytesRead));
          offset += bytesRead;
          if (offset % (64 * 1024 * 1024) < CHUNK) {
            process.stderr.write(
              `  … ${((offset / total) * 100).toFixed(1)}% (${offset}/${total})\n`,
            );
          }
        }
      } finally {
        fs.closeSync(fd);
      }
    } catch (err) {
      const code = err?.code || "";
      const retryable = ["ECANCELED", "EIO", "EAGAIN", "EBUSY", "ETIMEDOUT"].includes(code);
      attempt += 1;
      if (!retryable || attempt > MAX_RETRIES) {
        throw err;
      }
      const wait = Math.min(30_000, 500 * 2 ** attempt);
      process.stderr.write(
        `  retry ${attempt}/${MAX_RETRIES} after ${code} at offset=${offset}; wait ${wait}ms\n`,
      );
      await sleep(wait);
    }
  }

  return {
    source_sha256: hash.digest("hex"),
    size_bytes: total,
    mtime: st.mtime.toISOString(),
  };
}

function listShpSidecars(shpAbs) {
  const base = shpAbs.replace(/\.shp$/i, "");
  const exts = [".shp", ".shx", ".dbf", ".prj", ".cpg", ".sbn", ".sbx", ".qix", ".fix"];
  const sidecars = [];
  for (const ext of exts) {
    const p = base + ext;
    if (fs.existsSync(p)) {
      const st = fs.statSync(p);
      sidecars.push({
        filename: path.basename(p),
        path: path.relative(DATA_ROOT, p).split(path.sep).join("/"),
        size_bytes: st.size,
      });
    }
  }
  return sidecars;
}

function inspectGeometry(absPath, format) {
  const ogr = spawnSync(
    "ogrinfo",
    ["-so", "-al", absPath],
    { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 },
  );
  if (ogr.error || ogr.status !== 0) {
    return {
      ok: false,
      tool: "ogrinfo",
      error: ogr.error?.message || ogr.stderr?.slice(0, 500) || "ogrinfo failed",
    };
  }
  const text = ogr.stdout || "";
  const srid =
    text.match(/EPSG[:\s]*(\d+)/i)?.[1] ||
    text.match(/AUTHORITY\["EPSG","(\d+)"\]/i)?.[1] ||
    null;
  const geom =
    text.match(/Geometry:\s*([^\r\n]+)/i)?.[1]?.trim() ||
    text.match(/GEO[Mm]etry Type\s*=\s*([^\r\n]+)/i)?.[1]?.trim() ||
    null;
  const layerName = text.match(/Layer name:\s*([^\r\n]+)/i)?.[1]?.trim() || null;
  const featureCount = text.match(/Feature Count:\s*(\d+)/i)?.[1] || null;
  return {
    ok: true,
    tool: "ogrinfo",
    layer_name: layerName,
    geometry_type: geom,
    srid: srid ? Number(srid) : null,
    feature_count: featureCount ? Number(featureCount) : null,
    format,
  };
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.mkdirSync(path.dirname(DOC_OUT), { recursive: true });

  if (!fs.existsSync(DATA_ROOT)) {
    console.error(
      JSON.stringify(
        {
          error: "MASTER_DATA_ROOT_MISSING",
          data_root: DATA_ROOT,
          hint: "Remount GEO_Master_Archive (e.g. Google Drive H:) or set MASTER_ARCHIVE_ROOT",
        },
        null,
        2,
      ),
    );
    process.exit(2);
  }

  const started = Date.now();
  const entries = [];

  for (const c of CANONICALS) {
    const row = {
      layer_id: c.layer_id,
      authority: c.authority,
      source_id: c.source_id,
      format: c.format,
      notes: c.notes,
      admit_status: c.admit_status,
    };

    if (!c.relative_path) {
      row.source_sha256 = null;
      row.size_bytes = null;
      entries.push(row);
      console.error(`[skip] ${c.layer_id}: ${c.notes}`);
      continue;
    }

    const abs = path.join(DATA_ROOT, c.relative_path);
    row.path = path.join("Data", c.relative_path).split(path.sep).join("/");
    row.absolute_path = abs;

    if (!fs.existsSync(abs)) {
      row.admit_status = "BLOCKED";
      row.error = "file_missing";
      entries.push(row);
      console.error(`[missing] ${c.layer_id}: ${abs}`);
      continue;
    }

    console.error(`[sha] ${c.layer_id} ← ${c.relative_path}`);
    const t0 = Date.now();
    const hashed = await sha256File(abs);
    row.source_sha256 = hashed.source_sha256;
    row.size_bytes = hashed.size_bytes;
    row.modified_time = hashed.mtime;
    row.sha_elapsed_ms = Date.now() - t0;

    if (c.format === "shp") {
      row.sidecars = listShpSidecars(abs);
    }

    console.error(`[geom] ${c.layer_id}`);
    row.geometry_inspection = inspectGeometry(abs, c.format);

    // Status after SHA: still pending authority decisions where noted
    if (c.layer_id === "lu.water_protection") {
      row.admit_status = "BLOCKED";
      row.block_reason = "authority_decision_required_NV_xor_LST";
    } else if (c.layer_id === "lu.raa_culture") {
      row.admit_status = "BLOCKED";
      row.block_reason = "requires_IMPORT_REGISTRY_or_OUT_OF_SCOPE_v1";
    } else {
      row.admit_status = "SHA_RECORDED";
    }

    console.error(
      `  sha=${row.source_sha256.slice(0, 16)}… size=${row.size_bytes} (${row.sha_elapsed_ms}ms) status=${row.admit_status}`,
    );
    entries.push(row);
  }

  const ledger = {
    pass: 2,
    mode: "stream_sha256_canonical_candidates",
    generated_at: new Date().toISOString(),
    elapsed_ms: Date.now() - started,
    master_root: MASTER_ROOT,
    pass1_survey_id: "957f38492c05b159",
    admit_v1_ref: "docs/architecture/ADR-POSTGIS-ADMIT-V1.md",
    identity_chain: "source_sha256 → import manifest → dataset/version hash → PostGIS layer",
    empty_postgis: "BLOCKED until Admit v1 frozen",
    policy: {
      stream_chunk_bytes: CHUNK,
      hash_full_archive: false,
      store_size_with_hash: true,
    },
    entries,
  };

  fs.writeFileSync(OUT_JSON, JSON.stringify(ledger, null, 2));
  fs.writeFileSync(OUT_LATEST, JSON.stringify(ledger, null, 2));
  fs.writeFileSync(DOC_OUT, JSON.stringify(ledger, null, 2));

  console.log(
    JSON.stringify(
      {
        out: OUT_LATEST,
        doc_out: DOC_OUT,
        elapsed_ms: ledger.elapsed_ms,
        entries: entries.map((e) => ({
          layer_id: e.layer_id,
          admit_status: e.admit_status,
          source_sha256: e.source_sha256,
          size_bytes: e.size_bytes,
          srid: e.geometry_inspection?.srid ?? null,
          geometry_type: e.geometry_inspection?.geometry_type ?? null,
        })),
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
