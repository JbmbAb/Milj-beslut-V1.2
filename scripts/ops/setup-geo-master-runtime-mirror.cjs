/**
 * Create Docker-visible runtime mirror of GEO_Master_Archive.
 * Canonical truth remains on H: (Google Shared Drive — not bind-mountable into Docker).
 * Runtime path on NTFS: D:\GEO_Master_Archive_Runtime (or C: fallback).
 *
 * For PDF/chunk prerequisites: sync manifests + Documents/Sources/PDF* (+ optional).
 */
const fs = require("fs");
const path = require("path");
const { execSync, spawnSync } = require("child_process");

const CANONICAL = "H:\\Delade enheter\\Miljöbeslut\\GEO_Master_Archive";
const RUNTIME_D = "D:\\GEO_Master_Archive_Runtime";
const RUNTIME_C = "C:\\GEO_Master_Archive_Runtime";
const RECEIPT_DIR = path.join(
  process.cwd(),
  "storage",
  "manifests",
  "postgis-prerequisites-20260807"
);

function freeGb(letter) {
  const out = execSync(
    `powershell -NoProfile -Command "(Get-PSDrive ${letter}).Free"`,
    { encoding: "utf8" }
  ).trim();
  return Number(out) / 1e9;
}

function ensureDirs(root) {
  for (const p of [
    "Data",
    "Documents/Sources",
    "Rasters",
    "Vectors",
    "_manifests",
    "_logs",
    "_quarantine",
    "_review",
    "_temp",
  ]) {
    fs.mkdirSync(path.join(root, ...p.split("/")), { recursive: true });
  }
}

function robocopy(src, dest, extraArgs = []) {
  if (!fs.existsSync(src)) return { ok: false, skipped: true, src };
  fs.mkdirSync(dest, { recursive: true });
  const args = [src, dest, "/E", "/COPY:DAT", "/R:2", "/W:2", "/NFL", "/NDL", "/NJH", "/NJS", ...extraArgs];
  const r = spawnSync("robocopy", args, {
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 32 * 1024 * 1024,
  });
  const code = r.status ?? 1;
  return { ok: code < 8, exit: code, src, dest };
}

function main() {
  fs.mkdirSync(RECEIPT_DIR, { recursive: true });
  const dFree = freeGb("D");
  const cFree = freeGb("C");
  const runtimeRoot = dFree >= 40 ? RUNTIME_D : RUNTIME_C;
  console.log("runtimeRoot", runtimeRoot, { dFree, cFree });

  ensureDirs(runtimeRoot);
  fs.writeFileSync(
    path.join(runtimeRoot, "RUNTIME_MIRROR_NOTE.json"),
    JSON.stringify(
      {
        canonical: CANONICAL,
        runtime: runtimeRoot,
        policy: "Mimers Brunn v2.0.1",
        note: "Docker bind-mount target. H: (Google Shared Drive) is canonical truth but not visible inside Docker Desktop.",
        createdAt: new Date().toISOString(),
      },
      null,
      2
    )
  );

  const actions = [];
  // Always sync manifests (small, critical for provenance)
  actions.push(
    robocopy(path.join(CANONICAL, "_manifests"), path.join(runtimeRoot, "_manifests"))
  );

  // PDF/chunk focus: Documents/Sources (may be large — copy PDF subtree first)
  const pdfCandidates = [
    path.join(CANONICAL, "Documents", "Sources", "PDF"),
    path.join(CANONICAL, "Documents", "Sources"),
  ];
  let pdfSynced = false;
  for (const src of pdfCandidates) {
    if (!fs.existsSync(src)) continue;
    const rel = path.relative(path.join(CANONICAL, "Documents", "Sources"), src);
    const dest = path.join(runtimeRoot, "Documents", "Sources", rel || "");
    console.log("syncing", src, "->", dest);
    const r = robocopy(src, dest);
    actions.push(r);
    pdfSynced = r.ok;
    // If full Sources — only do PDF folder to start unless PDF missing
    if (src.endsWith("PDF") && r.ok) break;
  }

  const report = {
    createdAt: new Date().toISOString(),
    canonical: CANONICAL,
    runtimeRoot,
    dFreeGb: +dFree.toFixed(2),
    cFreeGb: +cFree.toFixed(2),
    pdfSynced,
    actions,
    composeEnv: {
      MASTER_ARCHIVE_HOST_PATH: runtimeRoot.replace(/\\/g, "/"),
    },
  };
  fs.writeFileSync(
    path.join(RECEIPT_DIR, "runtime-mirror.json"),
    JSON.stringify(report, null, 2)
  );
  console.log(JSON.stringify(report, null, 2));
}

main();
