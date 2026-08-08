/**
 * Diagnose divergence between the two master-archive roots.
 *
 * `scripts/import/config/mimersBrunn.ts` falls back to the canonical shared-drive
 * archive; `scripts/import/loke/lokeRuntime.ts` falls back to a local path under
 * the repository. Neither MASTER_ARCHIVE_ROOT nor GEO_MASTER_ARCHIVE is set in
 * .env, so both fallbacks are live and Loke has been writing to the local one.
 *
 * Read-only. Moves nothing, writes nothing into either archive
 * (MASTER_ARCHIVE_MANUAL_MOVES_FROZEN). The report lands under storage/.
 *
 * Direction is deliberately one-way: every path in the local shadow is looked up
 * on the canonical side. The canonical archive is ~293k files and ~2 TB on a
 * streamed Drive mount, so enumerating it to find canonical-only paths would
 * force a download of the entire archive and answer a question nobody asked.
 *
 *   npx tsx scripts/ops/diagnose-archive-root-divergence.mjs
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";

const SHADOW =
  process.env.ARCHIVE_SHADOW_ROOT ??
  "C:\\miljöbeslut\\storage\\geo_master_archive";

const CANONICAL =
  process.env.MASTER_ARCHIVE_ROOT ??
  process.env.GEO_MASTER_ARCHIVE ??
  "H:\\Delade enheter\\Miljöbeslut\\GEO_Master_Archive";

const REPORT_DIR = path.join(process.cwd(), "storage", "manifests", "archive-divergence");

function walk(root) {
  const files = [];
  const visit = (absolute) => {
    for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
      const child = path.join(absolute, entry.name);
      if (entry.isDirectory()) visit(child);
      else if (entry.isFile()) {
        files.push(path.relative(root, child).split(path.sep).join("/"));
      }
    }
  };
  visit(root);
  return files.sort();
}

function sha256(file) {
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function main() {
  for (const [label, root] of [["shadow", SHADOW], ["canonical", CANONICAL]]) {
    if (!fs.existsSync(root)) {
      console.error(`[FATAL] ${label} root not reachable: ${root}`);
      process.exit(1);
    }
  }

  const relatives = walk(SHADOW);

  const onlyInShadow = [];
  const identical = [];
  const divergent = [];

  for (const relative of relatives) {
    const shadowFile = path.join(SHADOW, relative.split("/").join(path.sep));
    const canonicalFile = path.join(CANONICAL, relative.split("/").join(path.sep));

    const shadowStat = fs.statSync(shadowFile);

    if (!fs.existsSync(canonicalFile)) {
      onlyInShadow.push({ path: relative, bytes: shadowStat.size, sha256: sha256(shadowFile) });
      continue;
    }

    const canonicalStat = fs.statSync(canonicalFile);
    const shadowHash = sha256(shadowFile);
    const canonicalHash = sha256(canonicalFile);

    const record = {
      path: relative,
      shadow: { bytes: shadowStat.size, sha256: shadowHash },
      canonical: { bytes: canonicalStat.size, sha256: canonicalHash },
    };

    if (shadowHash === canonicalHash) identical.push(record);
    else divergent.push(record);
  }

  // Which authority directories exist on each side, one level under
  // National_Archive. This is the shape difference that prompted the diagnosis.
  const authorities = (root) => {
    const dir = path.join(root, "National_Archive");
    if (!fs.existsSync(dir)) return [];
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
  };

  const shadowAuthorities = authorities(SHADOW);
  const canonicalAuthorities = authorities(CANONICAL);

  const report = {
    generated_by: "scripts/ops/diagnose-archive-root-divergence.mjs",
    shadow_root: SHADOW,
    canonical_root: CANONICAL,
    direction: "shadow -> canonical (one-way; canonical is not enumerated)",
    env: {
      MASTER_ARCHIVE_ROOT: process.env.MASTER_ARCHIVE_ROOT ?? null,
      GEO_MASTER_ARCHIVE: process.env.GEO_MASTER_ARCHIVE ?? null,
    },
    totals: {
      shadow_files: relatives.length,
      only_in_shadow: onlyInShadow.length,
      identical: identical.length,
      divergent: divergent.length,
      only_in_shadow_bytes: onlyInShadow.reduce((sum, f) => sum + f.bytes, 0),
    },
    authorities: {
      shadow: shadowAuthorities,
      canonical: canonicalAuthorities,
      only_in_shadow: shadowAuthorities.filter((a) => !canonicalAuthorities.includes(a)),
    },
    divergent,
    only_in_shadow: onlyInShadow,
    identical: identical.map((r) => r.path),
  };

  fs.mkdirSync(REPORT_DIR, { recursive: true });
  const out = path.join(REPORT_DIR, "shadow-vs-canonical.json");
  fs.writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  console.log(`shadow root     : ${SHADOW}`);
  console.log(`canonical root  : ${CANONICAL}`);
  console.log("");
  console.log(`shadow files    : ${report.totals.shadow_files}`);
  console.log(`  only in shadow: ${report.totals.only_in_shadow} (${report.totals.only_in_shadow_bytes} bytes)`);
  console.log(`  identical     : ${report.totals.identical}`);
  console.log(`  DIVERGENT     : ${report.totals.divergent}`);
  console.log("");
  console.log(`authorities only in shadow (${report.authorities.only_in_shadow.length}):`);
  for (const a of report.authorities.only_in_shadow) console.log(`  ${a}`);
  if (divergent.length > 0) {
    console.log("");
    console.log("divergent paths — same name, different content:");
    for (const d of divergent) console.log(`  ${d.path}`);
  }
  console.log("");
  console.log(`report: ${out}`);
}

main();
