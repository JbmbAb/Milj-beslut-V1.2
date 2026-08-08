/**
 * Read-only hash-based dedupe audit: D: candidates vs Master manifest SHA-256 index.
 *
 *   node scripts/ops/dedupe-d-against-master.mjs
 *   node scripts/ops/dedupe-d-against-master.mjs --resume
 *   node scripts/ops/dedupe-d-against-master.mjs --index-only
 *   node scripts/ops/dedupe-d-against-master.mjs --roots=D:\\GEodata;D:\\Geo inlärning
 *
 * No moves. No uploads. No mutations of Master or D:.
 * Writes only under storage/manifests/dedupe-d-vs-master/.
 *
 * Classification per file:
 *   already_in_master  — SHA-256 present in Master files_detail index
 *   missing_from_master — SHA-256 not in index (see index_coverage caveat)
 *   name_conflict      — basename exists in Master with different SHA-256
 *   staging_skip       — path/role marks staging/backup/temp (still hashed)
 *
 * "missing_from_master" is only as strong as the index. Manifests without
 * files_detail, unreadable Drive stubs, and unmanifested Master files are
 * outside the index and can produce false "missing".
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, "storage", "manifests", "dedupe-d-vs-master");
const INDEX_JSON = path.join(OUT_DIR, "master-sha256-index.json");
const CHECKPOINT = path.join(OUT_DIR, "hash-checkpoint.jsonl");
const REPORT_JSON = path.join(OUT_DIR, "dedupe-report.json");
const REPORT_CSV = path.join(OUT_DIR, "dedupe-report.csv");
const SUMMARY_MD = path.join(OUT_DIR, "SUMMARY.md");

const INVENTORY = path.join(ROOT, "storage", "manifests", "archive-full-inventory.json");
const LOCAL_MANIFEST_ROOT = path.join(ROOT, "storage", "manifests");

const RESUME = process.argv.includes("--resume");
const INDEX_ONLY = process.argv.includes("--index-only");
const ROOTS_ARG = process.argv.find((a) => a.startsWith("--roots="))?.slice("--roots=".length);

const DEFAULT_ROOTS = [
  "D:\\GEodata",
  "D:\\Geo inlärning",
  "D:\\ingest-arkiv-2026-03-29",
  "D:\\miljobeslut_staging",
];

const STAGING_DIR_HINTS = [
  /staging/i,
  /backup/i,
  /temp[_-]?/i,
  /cache/i,
  /extract/i,
  /mellanlagring/i,
  /quarantine/i,
  /_review/i,
  /komplettering/i,
];

const STAGING_ROOT_ROLES = {
  "D:\\GEodata": "legacy_source_candidate",
  "D:\\Geo inlärning": "legacy_training_candidate",
  "D:\\ingest-arkiv-2026-03-29": "ingest_archive_candidate",
  "D:\\miljobeslut_staging": "staging",
};

function ensureOut() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
}

function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  const fd = fs.openSync(filePath, "r");
  try {
    const buf = Buffer.alloc(1024 * 1024);
    let n;
    while ((n = fs.readSync(fd, buf, 0, buf.length, null)) > 0) {
      hash.update(buf.subarray(0, n));
    }
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest("hex");
}

function walkFiles(root, out = []) {
  let entries;
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const abs = path.join(root, e.name);
    if (e.isDirectory()) {
      if (e.name === "$RECYCLE.BIN" || e.name === "System Volume Information") continue;
      walkFiles(abs, out);
    } else if (e.isFile()) {
      out.push(abs);
    }
  }
  return out;
}

function addManifestHashes(manifestPath, byHash, byName, stats, source) {
  let m;
  try {
    m = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch {
    stats.unreadable += 1;
    return;
  }
  const details = Array.isArray(m.files_detail) ? m.files_detail : [];
  if (!details.length) {
    stats.noDetail += 1;
    return;
  }
  stats.withDetail += 1;
  for (const fd of details) {
    const sha = String(fd.sha256 || "").toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(sha)) continue;
    const name = String(fd.name || path.basename(String(fd.rel_path || ""))).toLowerCase();
    const size = Number(fd.size || fd.bytes || 0) || 0;
    const entry = {
      sha256: sha,
      name,
      size,
      manifest: manifestPath,
      source,
      rel_path: fd.rel_path || null,
    };
    if (!byHash.has(sha)) byHash.set(sha, []);
    byHash.get(sha).push(entry);
    if (name) {
      if (!byName.has(name)) byName.set(name, []);
      byName.get(name).push(entry);
    }
    stats.hashes += 1;
    stats.bytes += size;
  }
}

function buildIndex() {
  const byHash = new Map();
  const byName = new Map();
  const stats = {
    inventoryRows: 0,
    inventoryPaths: 0,
    localManifests: 0,
    withDetail: 0,
    noDetail: 0,
    unreadable: 0,
    hashes: 0,
    bytes: 0,
  };

  if (fs.existsSync(INVENTORY)) {
    const inv = JSON.parse(fs.readFileSync(INVENTORY, "utf8"));
    stats.inventoryRows = (inv.rows || []).length;
    for (const row of inv.rows || []) {
      const mp = row.manifest_path;
      if (!mp) continue;
      stats.inventoryPaths += 1;
      if (!fs.existsSync(mp)) {
        stats.unreadable += 1;
        continue;
      }
      addManifestHashes(mp, byHash, byName, stats, "master_inventory");
    }
  }

  // Local rclone-manifest mirrors fill gaps when Drive stubs are unread.
  for (const e of fs.readdirSync(LOCAL_MANIFEST_ROOT, { withFileTypes: true })) {
    if (!e.isDirectory() || !e.name.startsWith("rclone-manifests-")) continue;
    const walk = (dir) => {
      for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, ent.name);
        if (ent.isDirectory()) walk(p);
        else if (ent.name === "manifest.json") {
          stats.localManifests += 1;
          addManifestHashes(p, byHash, byName, stats, "local_rclone_mirror");
        }
      }
    };
    walk(path.join(LOCAL_MANIFEST_ROOT, e.name));
  }

  const uniqueHashes = byHash.size;
  const serializable = {
    generatedAt: new Date().toISOString(),
    mode: "read_only",
    caveat:
      "Index covers only files_detail.sha256 from readable manifests. Unmanifested Master files and unread Drive stubs are outside the index.",
    stats: {
      ...stats,
      uniqueHashes,
      indexedBytesGB: Number((stats.bytes / 1e9).toFixed(3)),
    },
    // Compact: one representative per hash for lookup; keep name multimap sizes.
    byHash: Object.fromEntries(
      [...byHash.entries()].map(([sha, arr]) => [
        sha,
        {
          count: arr.length,
          size: arr[0].size,
          name: arr[0].name,
          sources: [...new Set(arr.map((a) => a.source))],
          manifests: [...new Set(arr.map((a) => a.manifest))].slice(0, 3),
        },
      ]),
    ),
    byNameCounts: Object.fromEntries(
      [...byName.entries()].map(([name, arr]) => [
        name,
        {
          count: arr.length,
          sha256s: [...new Set(arr.map((a) => a.sha256))],
        },
      ]),
    ),
  };

  fs.writeFileSync(INDEX_JSON, `${JSON.stringify(serializable)}\n`, "utf8");
  return { byHash, byName, stats: serializable.stats };
}

function loadIndex() {
  if (!fs.existsSync(INDEX_JSON)) return buildIndex();
  const raw = JSON.parse(fs.readFileSync(INDEX_JSON, "utf8"));
  const byHash = new Map(
    Object.entries(raw.byHash).map(([sha, v]) => [sha, [v]]),
  );
  const byName = new Map(
    Object.entries(raw.byNameCounts).map(([name, v]) => [
      name,
      (v.sha256s || []).map((sha) => ({ sha256: sha, name })),
    ]),
  );
  return { byHash, byName, stats: raw.stats, fromDisk: true };
}

function loadCheckpoint() {
  /** @type {Map<string, {sha256:string, bytes:number, mtimeMs:number}>} */
  const map = new Map();
  if (!RESUME || !fs.existsSync(CHECKPOINT)) return map;
  for (const line of fs.readFileSync(CHECKPOINT, "utf8").split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line);
      if (row.path && row.sha256) map.set(row.path, row);
    } catch {
      // skip bad line
    }
  }
  return map;
}

function isStagingPath(absPath, root) {
  const role = STAGING_ROOT_ROLES[root];
  if (role === "staging") return { staging: true, reason: "root_is_staging" };
  const rel = path.relative(root, absPath);
  for (const re of STAGING_DIR_HINTS) {
    if (re.test(rel) || re.test(root)) {
      return { staging: true, reason: `path_hint:${re}` };
    }
  }
  // Compact archives under ingest/staging roots are often containers, not Master members.
  if (/\.(zip|7z|rar|tar|gz|tgz)$/i.test(absPath) && /ingest|staging|backup/i.test(root + rel)) {
    return { staging: true, reason: "archive_under_staging_root" };
  }
  return { staging: false, reason: null };
}

function classify(file, sha, byHash, byName) {
  const name = path.basename(file).toLowerCase();
  const inMaster = byHash.has(sha);
  const nameHits = byName.get(name) || [];
  const otherHashes = [...new Set(nameHits.map((h) => h.sha256).filter((h) => h !== sha))];

  if (inMaster && otherHashes.length === 0) {
    return { class: "already_in_master", note: null };
  }
  if (inMaster && otherHashes.length > 0) {
    return {
      class: "already_in_master",
      note: "basename also exists under other hashes in Master",
    };
  }
  if (!inMaster && otherHashes.length > 0) {
    return {
      class: "name_conflict",
      note: `same basename in Master under ${otherHashes.length} other hash(es)`,
      conflicting_sha256s: otherHashes.slice(0, 5),
    };
  }
  return { class: "missing_from_master", note: "not present in indexed Master hashes" };
}

function csvEscape(v) {
  const s = String(v ?? "");
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function writeReports(results, indexStats, roots) {
  const summary = {
    generatedAt: new Date().toISOString(),
    mode: "read_only",
    roots,
    index: indexStats,
    totals: {
      files: results.length,
      bytes: results.reduce((s, r) => s + r.bytes, 0),
      already_in_master: results.filter((r) => r.class === "already_in_master").length,
      missing_from_master: results.filter((r) => r.class === "missing_from_master").length,
      name_conflict: results.filter((r) => r.class === "name_conflict").length,
      staging_skip: results.filter((r) => r.staging).length,
    },
    bytesByClass: {},
    byRoot: {},
  };

  for (const cls of ["already_in_master", "missing_from_master", "name_conflict"]) {
    const rows = results.filter((r) => r.class === cls);
    summary.bytesByClass[cls] = {
      files: rows.length,
      bytes: rows.reduce((s, r) => s + r.bytes, 0),
      GB: Number((rows.reduce((s, r) => s + r.bytes, 0) / 1e9).toFixed(3)),
    };
  }

  for (const root of roots) {
    const rows = results.filter((r) => r.root === root);
    summary.byRoot[root] = {
      role: STAGING_ROOT_ROLES[root] || "candidate",
      files: rows.length,
      bytesGB: Number((rows.reduce((s, r) => s + r.bytes, 0) / 1e9).toFixed(3)),
      already_in_master: rows.filter((r) => r.class === "already_in_master").length,
      missing_from_master: rows.filter((r) => r.class === "missing_from_master").length,
      name_conflict: rows.filter((r) => r.class === "name_conflict").length,
      staging_skip: rows.filter((r) => r.staging).length,
    };
  }

  const report = {
    ...summary,
    caveat:
      "missing_from_master means absent from the indexed files_detail SHA-256 set, not proven absent from Master bytes on disk. Index coverage is incomplete when manifests lack checksums or Drive stubs are unread.",
    samples: {
      already_in_master: results.filter((r) => r.class === "already_in_master").slice(0, 20),
      missing_from_master: results
        .filter((r) => r.class === "missing_from_master" && !r.staging)
        .sort((a, b) => b.bytes - a.bytes)
        .slice(0, 40),
      name_conflict: results.filter((r) => r.class === "name_conflict").slice(0, 40),
      staging_skip: results.filter((r) => r.staging).slice(0, 20),
    },
    // Full rows kept for machine use; SUMMARY.md is human-facing.
    results,
  };

  fs.writeFileSync(REPORT_JSON, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  const header = [
    "class",
    "staging",
    "staging_reason",
    "bytes",
    "sha256",
    "root",
    "rel_path",
    "note",
  ];
  const lines = [header.join(",")];
  for (const r of results) {
    lines.push(
      [
        r.class,
        r.staging,
        r.staging_reason,
        r.bytes,
        r.sha256,
        r.root,
        r.rel_path,
        r.note,
      ]
        .map(csvEscape)
        .join(","),
    );
  }
  fs.writeFileSync(REPORT_CSV, `${lines.join("\n")}\n`, "utf8");

  const md = [
    "# D: vs Master — hash dedupe audit (read-only)",
    "",
    `Generated: ${summary.generatedAt}`,
    "",
    "## Index coverage",
    "",
    `- Unique Master hashes: **${indexStats.uniqueHashes}**`,
    `- Indexed bytes (where size present): **${indexStats.indexedBytesGB} GB**`,
    `- Inventory manifests scanned: ${indexStats.inventoryPaths ?? "n/a"}`,
    `- Unreadable manifests: ${indexStats.unreadable ?? "n/a"}`,
    "",
    "> `missing_from_master` = not in indexed `files_detail.sha256`. Unmanifested Master content can look like a miss.",
    "",
    "## Totals",
    "",
    `| Class | Files | GB |`,
    `| --- | ---: | ---: |`,
    `| already_in_master | ${summary.bytesByClass.already_in_master.files} | ${summary.bytesByClass.already_in_master.GB} |`,
    `| missing_from_master | ${summary.bytesByClass.missing_from_master.files} | ${summary.bytesByClass.missing_from_master.GB} |`,
    `| name_conflict | ${summary.bytesByClass.name_conflict.files} | ${summary.bytesByClass.name_conflict.GB} |`,
    `| staging_skip (flag, not exclusive) | ${summary.totals.staging_skip} | — |`,
    "",
    "## By root",
    "",
    ...Object.entries(summary.byRoot).flatMap(([root, s]) => [
      `### \`${root}\` (${s.role})`,
      "",
      `- files: ${s.files} (${s.bytesGB} GB)`,
      `- already: ${s.already_in_master}`,
      `- missing: ${s.missing_from_master}`,
      `- name conflict: ${s.name_conflict}`,
      `- staging flag: ${s.staging_skip}`,
      "",
    ]),
    "## Artifacts",
    "",
    `- \`${path.relative(ROOT, REPORT_JSON)}\``,
    `- \`${path.relative(ROOT, REPORT_CSV)}\``,
    `- \`${path.relative(ROOT, INDEX_JSON)}\``,
    "",
    "No files were moved or uploaded.",
  ].join("\n");

  fs.writeFileSync(SUMMARY_MD, `${md}\n`, "utf8");
  return summary;
}

function main() {
  ensureOut();
  console.log("[dedupe] building/loading Master SHA-256 index…");
  const { byHash, byName, stats: indexStats } = RESUME && fs.existsSync(INDEX_JSON)
    ? loadIndex()
    : buildIndex();
  console.log(
    `[dedupe] index: uniqueHashes=${indexStats.uniqueHashes} indexedBytesGB=${indexStats.indexedBytesGB} unreadable=${indexStats.unreadable}`,
  );

  if (INDEX_ONLY) {
    console.log(`[dedupe] index-only done → ${INDEX_JSON}`);
    return;
  }

  const roots = (ROOTS_ARG ? ROOTS_ARG.split(";") : DEFAULT_ROOTS)
    .map((r) => r.trim())
    .filter(Boolean)
    .filter((r) => {
      if (!fs.existsSync(r)) {
        console.warn(`[dedupe] SKIP missing root: ${r}`);
        return false;
      }
      return true;
    });

  const checkpoint = loadCheckpoint();
  const cpStream = fs.openSync(CHECKPOINT, RESUME ? "a" : "w");

  /** @type {any[]} */
  const results = [];
  let hashed = 0;
  let reused = 0;
  let errors = 0;
  const started = Date.now();

  for (const root of roots) {
    console.log(`[dedupe] walking ${root}…`);
    const files = walkFiles(root);
    console.log(`[dedupe] ${root}: ${files.length} files`);

    for (let i = 0; i < files.length; i++) {
      const abs = files[i];
      let st;
      try {
        st = fs.statSync(abs);
      } catch {
        errors += 1;
        continue;
      }

      const staging = isStagingPath(abs, root);
      let sha;
      let fromCp = false;
      const prev = checkpoint.get(abs);
      if (
        prev &&
        prev.sha256 &&
        prev.bytes === st.size &&
        Math.abs((prev.mtimeMs || 0) - st.mtimeMs) < 1
      ) {
        sha = prev.sha256;
        fromCp = true;
        reused += 1;
      } else {
        try {
          sha = sha256File(abs);
          hashed += 1;
          const row = {
            path: abs,
            sha256: sha,
            bytes: st.size,
            mtimeMs: st.mtimeMs,
            at: new Date().toISOString(),
          };
          fs.writeSync(cpStream, `${JSON.stringify(row)}\n`);
          checkpoint.set(abs, row);
        } catch (err) {
          errors += 1;
          results.push({
            class: "error",
            staging: staging.staging,
            staging_reason: staging.reason,
            bytes: st.size,
            sha256: null,
            root,
            rel_path: path.relative(root, abs).split(path.sep).join("/"),
            note: String(err?.message || err),
          });
          continue;
        }
      }

      const verdict = classify(abs, sha, byHash, byName);
      results.push({
        class: verdict.class,
        staging: staging.staging,
        staging_reason: staging.reason,
        bytes: st.size,
        sha256: sha,
        root,
        rel_path: path.relative(root, abs).split(path.sep).join("/"),
        note: verdict.note,
        conflicting_sha256s: verdict.conflicting_sha256s || null,
      });

      if ((i + 1) % 200 === 0 || i === files.length - 1) {
        const elapsedMin = ((Date.now() - started) / 60000).toFixed(1);
        console.log(
          `[dedupe] ${root}: ${i + 1}/${files.length} (hashed=${hashed} reused=${reused} errors=${errors}) ${elapsedMin}m`,
        );
      }
    }
  }

  fs.closeSync(cpStream);
  const summary = writeReports(results, indexStats, roots);
  console.log("[dedupe] DONE");
  console.log(JSON.stringify(summary.totals, null, 2));
  console.log(JSON.stringify(summary.bytesByClass, null, 2));
  console.log(`report: ${SUMMARY_MD}`);
}

main();
