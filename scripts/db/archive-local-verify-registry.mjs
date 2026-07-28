/**
 * Local Mimers Brunn verification for importRegistry LM + SGU datasets.
 * Scans GEO_Master_Archive on disk (not Drive).
 *
 *   node scripts/db/archive-local-verify-registry.mjs
 *   node scripts/db/archive-local-verify-registry.mjs --provider=SGU
 *   node scripts/db/archive-local-verify-registry.mjs --hash   # verify SHA-256 when manifest has files_detail
 */
import crypto from 'crypto';
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { validateArchiveManifestStructure } from '../import/types/manifestSchema.mjs';

const ROOT = process.cwd();
const MASTER = process.env.GEO_MASTER_ARCHIVE
  ?? 'H:\\Delade enheter\\Miljöbeslut\\GEO_Master_Archive';
const DATA = path.join(MASTER, 'Data');
const REPORT_JSON = path.join(ROOT, 'storage/manifests/archive-local-verify-registry.json');
const REPORT_CSV = path.join(ROOT, 'storage/manifests/archive-local-verify-registry.csv');

const DO_HASH = process.argv.includes('--hash');
const PROVIDER_FILTER = process.argv.find((a) => a.startsWith('--provider='))?.slice('--provider='.length) ?? '';

/** @typedef {'verified'|'missing_manifest'|'checksum_missing'|'file_unreadable'|'legacy_path_mismatch'|'needs_reharvest'} VerifyStatus */

/** @type {Array<{ provider: string, dataset: string, tier: number, searchNames: string[], expectedGpkg?: string, stacFolder?: string, zipNames?: string[] }>} */
const REGISTRY = [
  {
    provider: 'Lantmateriet',
    dataset: 'Fastighetsindelning_Nationell/Registerenhetsomradesytor',
    tier: 1,
    searchNames: ['Fastighetsindelning_Nationell', 'Fastighetsindelning'],
    expectedGpkg: 'registerenhetsomradesytor_nationell.gpkg',
    stacFolder: 'fastighetsindelning',
  },
  {
    provider: 'Lantmateriet',
    dataset: 'Fastighetsindelning_Nationell/Registerenhetsomradeslinjer',
    tier: 2,
    searchNames: ['Fastighetsindelning_Nationell', 'Fastighetsindelning'],
    expectedGpkg: 'registerenhetsomradeslinjer_nationell.gpkg',
    stacFolder: 'fastighetsindelning',
  },
  {
    provider: 'Lantmateriet',
    dataset: 'Byggnader_Nationell/Byggnad',
    tier: 1,
    searchNames: ['Byggnader_Nationell', 'byggnader'],
    expectedGpkg: 'byggnad_nationell.gpkg',
    stacFolder: 'byggnader',
  },
  {
    provider: 'Lantmateriet',
    dataset: 'Marktacke_Nationell/Mark',
    tier: 1,
    searchNames: ['Marktacke_Nationell', 'marktacke', 'Marktacke'],
    expectedGpkg: 'marktacke_nationell.gpkg',
    stacFolder: 'marktacke',
  },
  { provider: 'SGU', dataset: 'Brunnar', tier: 1, searchNames: ['Brunnar', 'brunnar'], zipNames: ['brunnar.zip'] },
  {
    provider: 'SGU',
    dataset: 'Jordarters25k100k',
    tier: 1,
    searchNames: ['Jordarters25k100k', 'Jordarter25k100k', 'jordarter25k-100k'],
    zipNames: ['jordarter25k-100k.zip'],
  },
  { provider: 'SGU', dataset: 'Fastmark', tier: 1, searchNames: ['Fastmark', 'fastmark'], zipNames: ['fastmark.zip'] },
  {
    provider: 'SGU',
    dataset: 'Grundvatten',
    tier: 1,
    searchNames: ['Grundvatten', 'grundvattenmagasin'],
    zipNames: ['grundvattenmagasin.zip'],
  },
  {
    provider: 'SGU',
    dataset: 'Jordskred',
    tier: 1,
    searchNames: ['Jordskred', 'jordskred-raviner'],
    zipNames: ['jordskred-raviner.zip'],
  },
  {
    provider: 'SGU',
    dataset: 'AktsamhetEfterarbetad',
    tier: 1,
    searchNames: ['AktsamhetEfterarbetad', 'forutsattningar-skred-finkornig-jordart'],
    zipNames: ['forutsattningar-skred-finkornig-jordart.zip'],
  },
  {
    provider: 'SGU',
    dataset: 'Jorddjup10m',
    tier: 2,
    searchNames: ['Jorddjupsmodell', 'jorddjupsmodell', 'Jorddjup10m'],
    zipNames: ['jorddjupsmodell.zip'],
  },
  {
    provider: 'SGU',
    dataset: 'StranderosionAktiv',
    tier: 2,
    searchNames: ['StranderosionAktiv', 'StranderosionKust', 'stranderosion-kust'],
    zipNames: ['stranderosion-kust.zip'],
  },
  {
    provider: 'SGU',
    dataset: 'Jordarter750kBlockighet',
    tier: 2,
    searchNames: ['Jordarter750kBlockighet', 'jordarter750k'],
    zipNames: ['jordarter750k.zip'],
  },
  {
    provider: 'SGU',
    dataset: 'Jordarter750kLandform',
    tier: 2,
    searchNames: ['Jordarter750kLandform', 'jordarter750k'],
    zipNames: ['jordarter750k.zip'],
  },
];

function csvEscape(value) {
  const s = String(value ?? '');
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function norm(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
}

function listDirs(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  } catch {
    return [];
  }
}

function walkFiles(dir, maxDepth = 6, depth = 0) {
  /** @type {string[]} */
  const out = [];
  if (depth > maxDepth) return out;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const fp = path.join(dir, e.name);
    if (e.isFile()) {
      out.push(fp);
    } else if (e.isDirectory()) {
      const subFiles = walkFiles(fp, maxDepth, depth + 1);
      for (const sf of subFiles) {
        out.push(sf);
      }
    }
  }
  return out;
}

function isZipReadable(filePath) {
  try {
    const fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(4);
    fs.readSync(fd, buf, 0, 4, 0);
    fs.closeSync(fd);
    return buf[0] === 0x50 && buf[1] === 0x4b;
  } catch {
    return false;
  }
}

function isGpkgReadable(filePath) {
  try {
    const fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(16);
    fs.readSync(fd, buf, 0, 16, 0);
    fs.closeSync(fd);
    return buf.toString('utf8', 0, 15).startsWith('SQLite format 3');
  } catch {
    return false;
  }
}

/**
 * SHA-256 via pwsh Get-FileHash or certutil — Node streams fail on H: Drive online-only files.
 */
function sha256File(filePath) {
  const psPath = filePath.replace(/'/g, "''");

  const tryPwsh = () => {
    const out = execFileSync(
      'pwsh',
      ['-NoProfile', '-Command', `(Get-FileHash -Algorithm SHA256 -LiteralPath '${psPath}').Hash`],
      { encoding: 'utf8', maxBuffer: 1024 * 1024 },
    );
    return out.trim().toLowerCase();
  };

  const tryCertutil = () => {
    const out = execFileSync('certutil', ['-hashfile', filePath, 'SHA256'], {
      encoding: 'utf8',
      maxBuffer: 1024 * 1024,
    });
    const line = out.split(/\r?\n/).find((l) => /^[0-9a-f]{64}$/i.test(l.trim()));
    if (!line) throw new Error(`certutil parse failed for ${filePath}`);
    return line.trim().toLowerCase();
  };

  let hash;
  try {
    hash = tryPwsh();
  } catch {
    hash = tryCertutil();
  }

  if (!/^[0-9a-f]{64}$/.test(hash)) {
    throw new Error(`unexpected hash output for ${filePath}: ${hash.slice(0, 80)}`);
  }
  return hash;
}

function findManifestNear(baseDir) {
  const versionDir = /[/\\]raw$/i.test(baseDir) ? path.dirname(baseDir) : baseDir;
  const candidates = [
    path.join(versionDir, 'manifest.json'),
    path.join(versionDir, 'raw', 'manifest.json'),
    path.join(baseDir, 'manifest.json'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

function canonicalVersionDir(providerRoot, datasetParts, version) {
  return path.join(providerRoot, ...datasetParts, version);
}

function findDataCandidates(entry) {
  /** @type {Array<{ kind: string, path: string, files: string[] }>} */
  const candidates = [];
  const providerRoots = entry.provider === 'Lantmateriet'
    ? [path.join(DATA, 'Lantmateriet'), path.join(DATA, 'LM')]
    : [path.join(DATA, 'SGU'), path.join(DATA, 'SGU', 'Legacy_Archive')];

  const datasetParts = entry.dataset.split('/');

  for (const root of providerRoots) {
    if (!fs.existsSync(root)) continue;

    // Canonical: Provider/DatasetPart/.../version/raw
    for (const name of entry.searchNames) {
      const base = path.join(root, name);
      if (!fs.existsSync(base)) continue;
      for (const ver of listDirs(base)) {
        if (!/^\d{4}-\d{2}-\d{2}/.test(ver)) continue;
        const verDir = path.join(base, ver);
        const rawDir = path.join(verDir, 'raw');
        const scanDir = fs.existsSync(rawDir) ? rawDir : verDir;
        const files = walkFiles(scanDir, 2).filter((f) => /\.(gpkg|zip|geojson|shp)$/i.test(f));
        if (files.length) candidates.push({ kind: 'canonical_version', path: verDir, files });
      }
      // Flat legacy folder with files directly
      const flatFiles = walkFiles(base, 2).filter((f) => /\.(gpkg|zip)$/i.test(f));
      if (flatFiles.length && !candidates.some((c) => c.path.startsWith(base))) {
        candidates.push({ kind: 'legacy_flat', path: base, files: flatFiles });
      }
    }

    // STAC archive for LM national
    if (entry.stacFolder) {
      const stac = path.join(DATA, 'LM', 'STAC_Archive', entry.stacFolder);
      if (fs.existsSync(stac)) {
        const zips = walkFiles(stac, 1).filter((f) => f.toLowerCase().endsWith('.zip'));
        if (zips.length) candidates.push({ kind: 'stac_zip', path: stac, files: zips });
      }
    }

    // Expected national GPKG anywhere under search base
    if (entry.expectedGpkg) {
      for (const name of entry.searchNames) {
        const base = path.join(root, name);
        if (!fs.existsSync(base)) continue;
        const all = walkFiles(base, 4).filter((f) => path.basename(f).toLowerCase() === entry.expectedGpkg.toLowerCase());
        for (const gpkg of all) {
          candidates.push({ kind: 'national_gpkg', path: path.dirname(gpkg), files: [gpkg] });
        }
      }
    }
  }

  // Repo staging (pre-promote harvest)
  const staging = path.join(ROOT, 'storage', 'manifests');
  for (const name of entry.searchNames) {
    const hits = walkFiles(staging, 3).filter((f) => {
      const rel = f.toLowerCase();
      return rel.includes(norm(name)) && /\.(gpkg|zip)$/i.test(f);
    });
    if (hits.length) candidates.push({ kind: 'repo_staging', path: staging, files: hits });
  }

  return candidates;
}

function pickBestCandidate(candidates) {
  if (!candidates.length) return null;
  const rank = { canonical_version: 0, national_gpkg: 1, stac_zip: 2, legacy_flat: 3, repo_staging: 9 };
  return [...candidates].sort((a, b) => {
    const ra = rank[a.kind] ?? 9;
    const rb = rank[b.kind] ?? 9;
    if (ra !== rb) return ra - rb;
    return b.files.reduce((s, f) => s + (fs.statSync(f).size), 0)
      - a.files.reduce((s, f) => s + (fs.statSync(f).size), 0);
  })[0];
}

function checkReadable(files) {
  for (const f of files) {
    const ext = path.extname(f).toLowerCase();
    if (ext === '.zip' && !isZipReadable(f)) return { ok: false, file: f };
    if (ext === '.gpkg' && !isGpkgReadable(f)) return { ok: false, file: f };
  }
  return { ok: true, file: null };
}

async function verifyEntry(entry) {
  const candidates = findDataCandidates(entry);
  const best = pickBestCandidate(candidates);

  if (!best) {
    return {
      provider: entry.provider,
      dataset: entry.dataset,
      tier: entry.tier,
      status: /** @type {VerifyStatus} */ ('needs_reharvest'),
      archive_path: null,
      manifest_path: null,
      file_count: 0,
      total_bytes: 0,
      note: 'no candidate files found under GEO_Master_Archive/Data',
      candidate_kinds: [],
    };
  }

  const totalBytes = best.files.reduce((s, f) => s + fs.statSync(f).size, 0);
  const manifestPath = findManifestNear(best.path);
  const readable = checkReadable(best.files.slice(0, 5));

  if (!readable.ok) {
    return {
      provider: entry.provider,
      dataset: entry.dataset,
      tier: entry.tier,
      status: 'file_unreadable',
      archive_path: best.path,
      manifest_path: manifestPath,
      file_count: best.files.length,
      total_bytes: totalBytes,
      note: `unreadable: ${readable.file}`,
      candidate_kinds: [...new Set(candidates.map((c) => c.kind))],
    };
  }

  if (best.kind === 'repo_staging') {
    return {
      provider: entry.provider,
      dataset: entry.dataset,
      tier: entry.tier,
      status: 'legacy_path_mismatch',
      archive_path: best.path,
      manifest_path: manifestPath,
      file_count: best.files.length,
      total_bytes: totalBytes,
      note: 'data only in repo staging — not promoted to GEO_Master_Archive',
      candidate_kinds: [...new Set(candidates.map((c) => c.kind))],
    };
  }

  if (best.kind !== 'canonical_version' && best.kind !== 'national_gpkg') {
    // Has data but not in librarian layout
    if (!manifestPath) {
      return {
        provider: entry.provider,
        dataset: entry.dataset,
        tier: entry.tier,
        status: 'legacy_path_mismatch',
        archive_path: best.path,
        manifest_path: null,
        file_count: best.files.length,
        total_bytes: totalBytes,
        note: `data at ${best.kind}, no manifest`,
        candidate_kinds: [...new Set(candidates.map((c) => c.kind))],
      };
    }
  }

  if (!manifestPath) {
    return {
      provider: entry.provider,
      dataset: entry.dataset,
      tier: entry.tier,
      status: 'missing_manifest',
      archive_path: best.path,
      manifest_path: null,
      file_count: best.files.length,
      total_bytes: totalBytes,
      note: `files ok at ${best.kind}`,
      candidate_kinds: [...new Set(candidates.map((c) => c.kind))],
    };
  }

  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (err) {
    return {
      provider: entry.provider,
      dataset: entry.dataset,
      tier: entry.tier,
      status: 'file_unreadable',
      archive_path: best.path,
      manifest_path: manifestPath,
      file_count: best.files.length,
      total_bytes: totalBytes,
      note: `manifest parse error: ${err instanceof Error ? err.message : String(err)}`,
      candidate_kinds: [...new Set(candidates.map((c) => c.kind))],
    };
  }

  const validated = validateArchiveManifestStructure(manifest);
  if (!validated.ok) {
    return {
      provider: entry.provider,
      dataset: entry.dataset,
      tier: entry.tier,
      status: 'missing_manifest',
      archive_path: best.path,
      manifest_path: manifestPath,
      file_count: best.files.length,
      total_bytes: totalBytes,
      note: `invalid manifest: ${validated.errors.join('; ')}`,
      candidate_kinds: [...new Set(candidates.map((c) => c.kind))],
    };
  }

  const details = validated.manifest.files_detail;
  if (!details?.length) {
    return {
      provider: entry.provider,
      dataset: entry.dataset,
      tier: entry.tier,
      status: 'checksum_missing',
      archive_path: best.path,
      manifest_path: manifestPath,
      file_count: best.files.length,
      total_bytes: totalBytes,
      note: 'manifest exists but files_detail/checksum absent (legacy)',
      candidate_kinds: [...new Set(candidates.map((c) => c.kind))],
    };
  }

  if (DO_HASH) {
    const manifestDir = path.dirname(manifestPath);
    for (const fd of details.slice(0, 20)) {
      const rel = fd.rel_path ?? fd.name;
      const candidates = [
        path.join(manifestDir, rel),
        path.join(manifestDir, 'raw', rel),
        path.join(manifestDir, fd.name),
        path.join(manifestDir, 'raw', fd.name),
      ];
      const filePath = candidates.find((c) => {
        try {
          return fs.statSync(c).isFile();
        } catch {
          return false;
        }
      });
      if (!filePath) {
        return {
          provider: entry.provider,
          dataset: entry.dataset,
          tier: entry.tier,
          status: 'needs_reharvest',
          archive_path: best.path,
          manifest_path: manifestPath,
          file_count: best.files.length,
          total_bytes: totalBytes,
          note: `manifest file missing on disk: ${fd.name}`,
          candidate_kinds: [...new Set(candidates.map((c) => c.kind))],
        };
      }
      const hash = await sha256File(filePath);
      if (hash !== fd.sha256) {
        return {
          provider: entry.provider,
          dataset: entry.dataset,
          tier: entry.tier,
          status: 'needs_reharvest',
          archive_path: best.path,
          manifest_path: manifestPath,
          file_count: best.files.length,
          total_bytes: totalBytes,
          note: `checksum mismatch: ${fd.name}`,
          candidate_kinds: [...new Set(candidates.map((c) => c.kind))],
        };
      }
    }
  }

  return {
    provider: entry.provider,
    dataset: entry.dataset,
    tier: entry.tier,
    status: /** @type {VerifyStatus} */ ('verified'),
    archive_path: best.path,
    manifest_path: manifestPath,
    file_count: best.files.length,
    total_bytes: totalBytes,
    note: DO_HASH ? 'manifest + checksum ok' : 'manifest ok (run --hash for SHA-256)',
    candidate_kinds: [...new Set(candidates.map((c) => c.kind))],
  };
}

async function main() {
  const entries = REGISTRY.filter((e) => !PROVIDER_FILTER || e.provider === PROVIDER_FILTER);
  console.log(`Verifying ${entries.length} registry datasets under ${DATA}...`);

  const rows = [];
  for (const entry of entries) {
    process.stderr.write(`  ${entry.provider}/${entry.dataset}...`);
    const row = await verifyEntry(entry);
    rows.push(row);
    process.stderr.write(` ${row.status}\n`);
  }

  const summary = rows.reduce((acc, r) => {
    acc[r.status] = (acc[r.status] ?? 0) + 1;
    return acc;
  }, /** @type {Record<string, number>} */ ({}));

  const report = {
    generatedAt: new Date().toISOString(),
    dataRoot: DATA,
    hashVerified: DO_HASH,
    summary,
    rows,
  };

  fs.mkdirSync(path.dirname(REPORT_JSON), { recursive: true });
  fs.writeFileSync(REPORT_JSON, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  const header = ['provider', 'dataset', 'tier', 'status', 'archive_path', 'manifest_path', 'file_count', 'total_bytes', 'note'];
  const csv = [
    header.join(','),
    ...rows.map((r) => header.map((h) => csvEscape(r[h])).join(',')),
  ].join('\n');
  fs.writeFileSync(REPORT_CSV, `${csv}\n`, 'utf8');

  console.log(JSON.stringify(summary, null, 2));
  console.log(`Report: ${REPORT_JSON}`);
  console.log(`CSV: ${REPORT_CSV}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
