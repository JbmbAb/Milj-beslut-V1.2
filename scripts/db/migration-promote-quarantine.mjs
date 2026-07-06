/**
 * Promote unique migration files + quarantine verified duplicates on Drive.
 *
 * Workflow:
 *   1. node scripts/db/migration-promote-quarantine.mjs
 *      → mapping_proposal.json (+ mapping_proposal_unclassified.csv)
 *   2. Edit mapping_proposal_unclassified.csv (provider, dataset, approved=true/false, action=skip)
 *   3. node scripts/db/migration-promote-quarantine.mjs --execute --merge-csv=mapping_proposal_unclassified.csv
 *
 * Flags:
 *   --execute              Apply moves (default: dry-run)
 *   --mapping=<file>       Proposal JSON to execute (default: mapping_proposal.json)
 *   --merge-csv=<file>     Apply manual CSV edits into proposal before execute (or with --merge-only)
 *   --merge-only           Merge CSV → mapping_proposal.merged.json without executing
 *   --quarantine-only      Only quarantine duplicates
 *   --promote-only         Only promote classified rows
 *   --export-csv           Also write full mapping_proposal.csv (optional)
 */
import crypto from 'crypto';
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const ROOT = process.cwd();
const STAGING = path.join(ROOT, 'storage', 'migration_staging', '2026-06-19');
const MIGRATION_DATA = path.join(STAGING, 'Data', '_migration_from_D', '2026-06-19');
const MIGRATION_DOCS = path.join(STAGING, 'Documents', 'Sources', '_migration_from_D', '2026-06-19');
const MANIFESTS = path.join(ROOT, 'storage', 'manifests');
const CANONICAL_INDEX = path.join(MANIFESTS, 'canonical_sha256_index.json');
const HASH_CACHE = path.join(MANIFESTS, 'migration_file_hashes.json');
const EXECUTED = path.join(MANIFESTS, 'D_to_H_migration_executed.json');
const RCLONE_CONFIG = path.join(ROOT, 'storage', 'rclone');
const MAPPING_OUT = path.join(MANIFESTS, 'mapping_proposal.json');
const MAPPING_CSV_OUT = path.join(MANIFESTS, 'mapping_proposal_unclassified.csv');
const MAPPING_CSV_FULL = path.join(MANIFESTS, 'mapping_proposal.csv');

const VERSION = '2026-06-19';
const QUARANTINE_REMOTE = `drive:GEO_Master_Archive/_quarantine/duplicate_verified_${VERSION}_from_D`;
const MIGRATION_DATA_REMOTE = `drive:GEO_Master_Archive/Data/_migration_from_D/${VERSION}`;
const MIGRATION_DOCS_REMOTE = `drive:GEO_Master_Archive/Documents/Sources/_migration_from_D/${VERSION}`;

const EXECUTE = process.argv.includes('--execute');
const MERGE_ONLY = process.argv.includes('--merge-only');
const EXPORT_CSV_FULL = process.argv.includes('--export-csv');
const QUARANTINE_ONLY = process.argv.includes('--quarantine-only');
const PROMOTE_ONLY = process.argv.includes('--promote-only');
const MAPPING_ARG = process.argv.find((a) => a.startsWith('--mapping='));
const MERGE_CSV_ARG = process.argv.find((a) => a.startsWith('--merge-csv='));
const MAPPING_FILE = MAPPING_ARG
  ? path.resolve(MAPPING_ARG.slice('--mapping='.length))
  : MAPPING_OUT;
const MERGE_CSV_FILE = MERGE_CSV_ARG
  ? path.resolve(MERGE_CSV_ARG.slice('--merge-csv='.length))
  : MAPPING_CSV_OUT;
const MERGED_OUT = MAPPING_FILE.replace(/\.json$/i, '.merged.json');

const EXCLUDE_DIR = new Set([
  'node_modules', '.git', '__pycache__', '.venv', 'dist', '.next', 'metadata',
]);
const EXCLUDE_EXT = new Set(['.json']);
const GEODATA_EXT = new Set([
  '.tif', '.tiff', '.gpkg', '.shp', '.zip', '.gdb', '.geojson', '.pdf',
  '.docx', '.doc', '.xlsx', '.csv', '.shx', '.dbf', '.prj', '.cpg',
]);

/** Sidecars must never be quarantined alone — they follow the main file in the same folder. */
const SIDECAR_EXT = new Set([
  '.prj', '.cpg', '.shx', '.dbf', '.sbn', '.sbx', '.xml', '.aux', '.ovr', '.tfw', '.wld',
  '.gdbindexes', '.gdbtablx', '.freelist', '.atx',
]);
const MAIN_ANCHOR_EXT = new Set([
  '.shp', '.tif', '.tiff', '.gpkg', '.zip', '.pdf', '.geojson', '.docx', '.gdbtable',
]);
const SMALL_FILE_BYTES = 5 * 1024;

/** @typedef {'QUARANTINE_DUPLICATE'|'CLASSIFIED_HIGH'|'CLASSIFIED_MEDIUM'|'UNCLASSIFIED'|'SKIP_OTHER'} MappingStatus */

/**
 * Path heuristics from original D:/staging folder layout.
 * First match wins.
 */
const PATH_HEURISTICS = [
  {
    id: 'lm_historiska',
    test: (rel) => /D_GEodata\/Lantmateriet_Historiska/i.test(rel),
    provider: 'Lantmateriet',
    dataset: 'Haradsekonomiska_kartan',
    kind: 'data',
    status: 'CLASSIFIED_HIGH',
    subpath: (rel) => rel.split('Lantmateriet_Historiska/')[1] ?? path.basename(rel),
  },
  {
    id: 'lm_direct',
    test: (rel) => /D_GEodata\/lm_direct/i.test(rel),
    provider: 'Lantmateriet',
    dataset: 'lm_direct',
    kind: 'data',
    status: 'CLASSIFIED_HIGH',
    subpath: (rel) => rel.split(/lm_direct\//i)[1] ?? path.basename(rel),
  },
  {
    id: 'sgu_temp_extract',
    test: (rel) => /D_GEodata\/temp_massive_extract/i.test(rel),
    provider: 'SGU',
    dataset: (rel) => path.basename(rel).replace(/\.[^.]+$/, '') || 'temp_massive_extract',
    kind: 'data',
    status: 'CLASSIFIED_HIGH',
    subpath: (rel) => path.basename(rel),
  },
  {
    id: 'ops_extracted',
    test: (rel) => /Miljobeslut_Ops_Pipeline\/storage\/extracted\//i.test(rel),
    provider: (rel) => {
      const m = rel.match(/\/extracted\/([^/]+)/i);
      return inferProviderFromFolder(m?.[1] ?? '');
    },
    dataset: (rel) => rel.match(/\/extracted\/([^/]+)/i)?.[1] ?? 'unknown',
    kind: 'data',
    status: (rel) => {
      const folder = rel.match(/\/extracted\/([^/]+)/i)?.[1] ?? '';
      return inferProviderFromFolder(folder) === 'UNCLASSIFIED' ? 'UNCLASSIFIED' : 'CLASSIFIED_MEDIUM';
    },
    subpath: (rel) => rel.split(/\/extracted\/[^/]+\//i)[1] ?? path.basename(rel),
  },
  {
    id: 'miljolut',
    test: (rel) => /D_Desktop_Produktdata\/Miljölut\.se\//i.test(rel),
    provider: 'Miljolut',
    dataset: (rel) => path.basename(rel).replace(/\.[^.]+$/, '') || 'downloads',
    kind: 'data',
    status: 'CLASSIFIED_MEDIUM',
    subpath: (rel) => rel.split(/Miljölut\.se\//i)[1] ?? path.basename(rel),
  },
  {
    id: 'nv_dataportal_geo',
    test: (rel) => /D_ingest_arkiv\/dataportal-env/i.test(rel) && /\.(geojson|gpkg)$/i.test(rel),
    provider: 'Naturvardsverket',
    dataset: (rel) => path.basename(rel).replace(/\.[^.]+$/, ''),
    kind: 'documents',
    status: 'CLASSIFIED_MEDIUM',
    subpath: (rel) => path.basename(rel),
  },
  {
    id: 'raa_docs',
    test: (rel) => /catalog-raa-se|arkeolog/i.test(rel),
    provider: 'Riksantikvarieambetet',
    dataset: (rel) => path.basename(rel).replace(/\.[^.]+$/, ''),
    kind: 'documents',
    status: 'CLASSIFIED_MEDIUM',
    subpath: (rel) => path.basename(rel),
  },
  {
    id: 'kommun_docs',
    test: (rel) => /C_GEO_PDF|kommun-beslut/i.test(rel),
    provider: 'Kommun',
    dataset: '_migration_from_D',
    kind: 'documents',
    status: 'CLASSIFIED_MEDIUM',
    subpath: (rel) => path.basename(rel),
  },
];

function parseValue(v, rel) {
  return typeof v === 'function' ? v(rel) : v;
}

function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  const fd = fs.openSync(filePath, 'r');
  const buf = Buffer.alloc(1024 * 1024);
  let bytes = 0;
  while ((bytes = fs.readSync(fd, buf, 0, buf.length, null)) > 0) {
    hash.update(buf.subarray(0, bytes));
  }
  fs.closeSync(fd);
  return hash.digest('hex');
}

function loadHashCache() {
  if (!fs.existsSync(HASH_CACHE)) return {};
  return JSON.parse(fs.readFileSync(HASH_CACHE, 'utf8'));
}

function saveHashCache(cache) {
  fs.writeFileSync(HASH_CACHE, JSON.stringify(cache, null, 2), 'utf8');
}

function loadCanonicalIndex() {
  const raw = JSON.parse(fs.readFileSync(CANONICAL_INDEX, 'utf8'));
  return { byHash: new Map(Object.entries(raw.byHash)), fileCount: raw.fileCount };
}

function loadExecutedHashes() {
  const map = new Map();
  if (!fs.existsSync(EXECUTED)) return map;
  const data = JSON.parse(fs.readFileSync(EXECUTED, 'utf8'));
  for (const item of data.fileManifest ?? []) {
    if (item.destPath && item.sha256) map.set(path.normalize(item.destPath), item.sha256);
  }
  return map;
}

function shouldSkip(relPath, fileName) {
  const parts = relPath.split(/[/\\]/);
  if (parts.some((p) => EXCLUDE_DIR.has(p.toLowerCase()))) return true;
  if (EXCLUDE_EXT.has(path.extname(fileName).toLowerCase())) return true;
  return false;
}

function walkFiles(rootDir) {
  const files = [];
  const stack = [rootDir];
  while (stack.length) {
    const current = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (EXCLUDE_DIR.has(entry.name.toLowerCase())) continue;
        stack.push(full);
      } else if (entry.isFile()) {
        const rel = path.relative(rootDir, full);
        if (shouldSkip(rel, entry.name)) continue;
        try {
          const stat = fs.statSync(full);
          files.push({ rel: rel.replace(/\\/g, '/'), full, size: stat.size });
        } catch {
          // skip
        }
      }
    }
  }
  return files;
}

function inferProviderFromFolder(folder) {
  const f = folder.toLowerCase();
  if (!f) return 'UNCLASSIFIED';
  if (/berg|brunn|grund/.test(f)) return 'SGU';
  if (/sci|spa|natura|nmd|tradslag/.test(f)) return 'Naturvardsverket';
  if (/avrinn|vatten|smhi/.test(f)) return 'SMHI';
  if (/genomslapplighet|tathets|boreal|skoglig|patcher|komponent|betweeness/.test(f)) {
    return 'Miljobeslut_Ops';
  }
  return 'UNCLASSIFIED';
}

function buildTargetRemote(kind, provider, dataset, subpath) {
  if (kind === 'documents') {
    return `drive:GEO_Master_Archive/Documents/Sources/${provider}/${dataset}/${VERSION}/${subpath}`;
  }
  return `drive:GEO_Master_Archive/Data/${provider}/${dataset}/${VERSION}/raw/${subpath}`;
}

function fileExt(rel) {
  return path.extname(rel).toLowerCase();
}

function sourceDir(rel) {
  return path.dirname(rel).replace(/\\/g, '/');
}

/** Sidecar or tiny file — unsafe to dedupe by hash alone (EPSG .prj collisions etc.). */
function isSidecarOrTiny(rel, sizeBytes) {
  const ext = fileExt(rel);
  if (SIDECAR_EXT.has(ext)) return true;
  if (sizeBytes < SMALL_FILE_BYTES && !MAIN_ANCHOR_EXT.has(ext)) return true;
  return false;
}

function quarantineRemote(section, rel) {
  const prefix = section === 'docs' ? 'Documents_Sources' : 'Data';
  return `${QUARANTINE_REMOTE}/${prefix}/${rel}`;
}

function anchorScore(entry) {
  const ext = fileExt(entry.sourceRel);
  let score = entry.sizeBytes;
  if (MAIN_ANCHOR_EXT.has(ext)) score += 1e15;
  if (entry.action === 'promote' && entry.approved) score += 1e12;
  if (entry.action === 'quarantine') score += 1e11;
  return score;
}

function sidecarTargetFromAnchor(anchor, sidecarRel) {
  if (anchor.action === 'quarantine') {
    return quarantineRemote(anchor.section, sidecarRel);
  }
  if (!anchor.targetRemote) return '';

  if (anchor.targetRemote.includes('/raw/')) {
    const rawPrefix = `${anchor.targetRemote.split('/raw/')[0]}/raw/`;
    const anchorSub = anchor.targetRemote.split('/raw/')[1] ?? '';
    const anchorDir = sourceDir(anchorSub);
    const sidecarBase = path.basename(sidecarRel);
    const relFromAnchorDir = sidecarRel.startsWith(`${sourceDir(anchor.sourceRel)}/`)
      ? sidecarRel.slice(sourceDir(anchor.sourceRel).length + 1)
      : sidecarBase;
    if (anchorDir && anchorDir !== '.') {
      return `${rawPrefix}${anchorDir}/${sidecarBase}`;
    }
    return `${rawPrefix}${relFromAnchorDir}`;
  }

  const targetDir = anchor.targetRemote.replace(/\/[^/]+$/, '');
  return `${targetDir}/${path.basename(sidecarRel)}`;
}

/**
 * Bind sidecars/tiny files to the dominant main file in the same directory.
 * Prevents orphan .prj/.dbf when a hash collision would quarantine the sidecar only.
 */
function applySidecarBindings(entries) {
  /** @type {Map<string, object[]>} */
  const byDir = new Map();
  for (const entry of entries) {
    const key = `${entry.section}:${sourceDir(entry.sourceRel)}`;
    if (!byDir.has(key)) byDir.set(key, []);
    byDir.get(key).push(entry);
  }

  let rebound = 0;
  for (const group of byDir.values()) {
    const anchor = [...group].sort((a, b) => anchorScore(b) - anchorScore(a))[0];
    if (!anchor) continue;

    for (const entry of group) {
      if (entry === anchor) continue;
      if (!isSidecarOrTiny(entry.sourceRel, entry.sizeBytes)) continue;

      entry.action = anchor.action;
      entry.status = anchor.status;
      entry.provider = anchor.provider ?? '';
      entry.dataset = anchor.dataset ?? '';
      entry.targetRemote = anchor.action === 'quarantine'
        ? quarantineRemote(entry.section, entry.sourceRel)
        : sidecarTargetFromAnchor(anchor, entry.sourceRel);
      entry.heuristicId = 'sidecar_follows_anchor';
      entry.heuristicNote = `Sidecar follows ${path.basename(anchor.sourceRel)} in ${sourceDir(entry.sourceRel)}`;
      entry.approved = anchor.approved;
      if (anchor.action === 'quarantine') {
        entry.canonicalPaths = anchor.canonicalPaths ?? entry.canonicalPaths ?? [];
      } else {
        entry.canonicalPaths = [];
      }
      rebound++;
    }
  }
  return rebound;
}

function inferMapping(f, section, canonical, hashCache, executedHashes) {
  const cacheKey = `${section}:${f.rel}`;
  let sha256 = hashCache[cacheKey] ?? executedHashes.get(path.normalize(f.full));
  if (!sha256) {
    sha256 = sha256File(f.full);
    hashCache[cacheKey] = sha256;
  }

  const migrationRemote = section === 'docs' ? MIGRATION_DOCS_REMOTE : MIGRATION_DATA_REMOTE;
  const sourceRemote = `${migrationRemote}/${f.rel}`;

  const dupes = canonical.byHash.get(sha256) ?? [];
  if (dupes.length > 0 && !isSidecarOrTiny(f.rel, f.size)) {
    return {
      action: 'quarantine',
      status: 'QUARANTINE_DUPLICATE',
      section,
      sourceRel: f.rel,
      sourceRemote,
      targetRemote: quarantineRemote(section, f.rel),
      provider: '',
      dataset: '',
      sha256,
      sizeBytes: f.size,
      heuristicId: 'hash_match',
      heuristicNote: `Duplicate of ${dupes[0].path}`,
      canonicalPaths: dupes.map((d) => d.path),
      approved: true,
    };
  }

  const ext = path.extname(f.rel).toLowerCase();
  if (!GEODATA_EXT.has(ext)) {
    return {
      action: 'skip',
      status: 'SKIP_OTHER',
      section,
      sourceRel: f.rel,
      sourceRemote,
      targetRemote: '',
      provider: '',
      dataset: '',
      sha256,
      sizeBytes: f.size,
      heuristicId: 'non_geodata',
      heuristicNote: `Skipped non-geodata extension ${ext}`,
      canonicalPaths: [],
      approved: false,
    };
  }

  for (const rule of PATH_HEURISTICS) {
    if (!rule.test(f.rel)) continue;
    const provider = parseValue(rule.provider, f.rel);
    const dataset = parseValue(rule.dataset, f.rel);
    const status = parseValue(rule.status, f.rel);
    const subpath = parseValue(rule.subpath, f.rel);
    const kind = rule.kind;
    if (provider === 'UNCLASSIFIED' || status === 'UNCLASSIFIED') {
      return {
        action: 'promote',
        status: 'UNCLASSIFIED',
        section,
        sourceRel: f.rel,
        sourceRemote,
        targetRemote: '',
        provider: '',
        dataset: '',
        sha256,
        sizeBytes: f.size,
        heuristicId: rule.id,
        heuristicNote: `Rule matched but provider unknown: ${rule.id}`,
        canonicalPaths: [],
        approved: false,
      };
    }
    return {
      action: 'promote',
      status,
      section,
      sourceRel: f.rel,
      sourceRemote,
      targetRemote: buildTargetRemote(kind, provider, dataset, subpath),
      provider,
      dataset,
      sha256,
      sizeBytes: f.size,
      heuristicId: rule.id,
      heuristicNote: `Matched rule ${rule.id}`,
      canonicalPaths: [],
      approved: status.startsWith('CLASSIFIED_'),
    };
  }

  return {
    action: 'promote',
    status: 'UNCLASSIFIED',
    section,
    sourceRel: f.rel,
    sourceRemote,
    targetRemote: '',
    provider: '',
    dataset: '',
    sha256,
    sizeBytes: f.size,
    heuristicId: 'none',
    heuristicNote: 'No path heuristic matched — fill provider and dataset manually',
    canonicalPaths: [],
    approved: false,
  };
}

function csvEscape(value) {
  const s = String(value ?? '');
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function writeCsv(filePath, rows, columns) {
  const lines = [columns.join(',')];
  for (const row of rows) {
    lines.push(columns.map((c) => csvEscape(row[c])).join(','));
  }
  fs.writeFileSync(filePath, `${lines.join('\n')}\n`, 'utf8');
}

function parseCsvRow(line) {
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

function readCsv(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];
  const headers = parseCsvRow(lines[0]);
  return lines.slice(1).map((line) => {
    const values = parseCsvRow(line);
    /** @type {Record<string, string>} */
    const row = {};
    headers.forEach((h, i) => {
      row[h] = values[i] ?? '';
    });
    return row;
  });
}

function parseApproved(value) {
  const v = String(value ?? '').trim().toLowerCase();
  if (v === 'true' || v === 'yes' || v === '1') return true;
  if (v === 'false' || v === 'no' || v === '0') return false;
  return null;
}

/**
 * Apply manual CSV edits onto proposal entries (matched by sourceRel).
 * CSV columns: sourceRel, provider, dataset, targetRemote, approved, action
 */
function mergeCsvIntoProposal(proposal, csvPath) {
  if (!fs.existsSync(csvPath)) {
    throw new Error(`CSV not found: ${csvPath}`);
  }
  const rows = readCsv(csvPath);
  const byRel = new Map(proposal.entries.map((e) => [e.sourceRel, e]));
  let updated = 0;
  let skipped = 0;
  let approved = 0;
  let missing = 0;

  for (const row of rows) {
    const entry = byRel.get(row.sourceRel);
    if (!entry) {
      missing++;
      continue;
    }

    if (row.provider?.trim()) entry.provider = row.provider.trim();
    if (row.dataset?.trim()) entry.dataset = row.dataset.trim();
    if (row.targetRemote?.trim()) entry.targetRemote = row.targetRemote.trim();

    const action = row.action?.trim().toLowerCase();
    if (action === 'skip') {
      entry.action = 'skip';
      entry.status = 'SKIP_OTHER';
      entry.approved = false;
      entry.heuristicNote = `${entry.heuristicNote ?? ''} | manual CSV: skip`.trim();
      skipped++;
      updated++;
      continue;
    }

    const approvedVal = parseApproved(row.approved);
    if (approvedVal === true) {
      entry.approved = true;
      entry.action = 'promote';
      if (entry.status === 'UNCLASSIFIED' && entry.provider && entry.dataset) {
        entry.status = 'CLASSIFIED_MEDIUM';
        entry.heuristicNote = `${entry.heuristicNote ?? ''} | manual CSV approval`.trim();
        if (!entry.targetRemote) {
          const kind = entry.section === 'docs' ? 'documents' : 'data';
          const sub = kind === 'documents'
            ? path.basename(entry.sourceRel)
            : entry.sourceRel.split('/').slice(1).join('/') || path.basename(entry.sourceRel);
          entry.targetRemote = buildTargetRemote(kind, entry.provider, entry.dataset, sub);
        }
      }
      approved++;
      updated++;
    } else if (approvedVal === false) {
      entry.approved = false;
      updated++;
    } else if (row.provider || row.dataset) {
      updated++;
    }
  }

  proposal.mergedFromCsv = csvPath;
  proposal.mergedAt = new Date().toISOString();
  proposal.mergeSummary = { csvRows: rows.length, updated, approved, skipped, missing };
  return proposal;
}

function loadProposalWithOptionalCsvMerge(mappingPath, csvPath) {
  const proposal = JSON.parse(fs.readFileSync(mappingPath, 'utf8'));
  if (!fs.existsSync(csvPath)) {
    console.warn(`No CSV at ${csvPath} — executing proposal as-is.`);
    return proposal;
  }
  console.log(`Merging manual edits from ${csvPath}...`);
  const merged = mergeCsvIntoProposal(proposal, csvPath);
  fs.writeFileSync(MERGED_OUT, JSON.stringify(merged, null, 2), 'utf8');
  console.log(`Merged proposal: ${MERGED_OUT}`);
  console.log(JSON.stringify(merged.mergeSummary, null, 2));
  return merged;
}

function buildProposal() {
  const canonical = loadCanonicalIndex();
  const executedHashes = loadExecutedHashes();
  const hashCache = loadHashCache();
  /** @type {object[]} */
  const entries = [];

  for (const [section, root] of [
    ['data', MIGRATION_DATA],
    ['docs', MIGRATION_DOCS],
  ]) {
    if (!fs.existsSync(root)) continue;
    const files = walkFiles(root);
    console.log(`Classifying ${section}: ${files.length} files...`);
    let i = 0;
    for (const f of files) {
      i++;
      if (i % 100 === 0) process.stdout.write(`\r  ${i}/${files.length}`);
      entries.push(inferMapping(f, section, canonical, hashCache, executedHashes));
    }
    process.stdout.write('\n');
  }

  saveHashCache(hashCache);

  const sidecarRebound = applySidecarBindings(entries);
  console.log(`Sidecar binding: ${sidecarRebound} files tied to folder anchor`);

  const summary = {
    total: entries.length,
    quarantine: entries.filter((e) => e.status === 'QUARANTINE_DUPLICATE').length,
    classifiedHigh: entries.filter((e) => e.status === 'CLASSIFIED_HIGH').length,
    classifiedMedium: entries.filter((e) => e.status === 'CLASSIFIED_MEDIUM').length,
    unclassified: entries.filter((e) => e.status === 'UNCLASSIFIED').length,
    skipOther: entries.filter((e) => e.status === 'SKIP_OTHER').length,
    sidecarFollowsAnchor: entries.filter((e) => e.heuristicId === 'sidecar_follows_anchor').length,
    sidecarRebound,
    quarantineGB: Number((entries.filter((e) => e.action === 'quarantine').reduce((s, e) => s + e.sizeBytes, 0) / 1024 ** 3).toFixed(2)),
    promoteReadyGB: Number((entries.filter((e) => e.approved && e.action === 'promote').reduce((s, e) => s + e.sizeBytes, 0) / 1024 ** 3).toFixed(2)),
  };

  const proposal = {
    version: 1,
    generatedAt: new Date().toISOString(),
    mode: 'proposal',
    versionTag: VERSION,
    instructions: [
      'Edit provider/dataset on UNCLASSIFIED rows, set approved=true, fill targetRemote or leave blank to auto-build.',
      'Execute: node scripts/db/migration-promote-quarantine.mjs --execute --mapping=mapping_proposal.json',
    ],
    summary,
    entries,
  };

  fs.mkdirSync(MANIFESTS, { recursive: true });
  fs.writeFileSync(MAPPING_OUT, JSON.stringify(proposal, null, 2), 'utf8');

  const csvColumns = [
    'sourceRel', 'status', 'action', 'provider', 'dataset', 'targetRemote',
    'approved', 'heuristicId', 'heuristicNote', 'sizeBytes', 'sha256',
  ];
  writeCsv(
    MAPPING_CSV_OUT,
    entries.filter((e) => e.status === 'UNCLASSIFIED'),
    csvColumns,
  );
  if (EXPORT_CSV_FULL) {
    writeCsv(MAPPING_CSV_FULL, entries, csvColumns);
  }

  console.log(`\nProposal: ${MAPPING_OUT}`);
  console.log(`UNCLASSIFIED CSV: ${MAPPING_CSV_OUT}`);
  console.log(JSON.stringify(summary, null, 2));
  return proposal;
}

function resolveTarget(entry) {
  if (entry.targetRemote) return entry.targetRemote;
  if (!entry.provider || !entry.dataset) {
    throw new Error(`Missing provider/dataset for ${entry.sourceRel}`);
  }
  const kind = entry.section === 'docs' ? 'documents' : 'data';
  const subpath = kind === 'documents'
    ? path.basename(entry.sourceRel)
    : entry.sourceRel.split('/').slice(1).join('/') || path.basename(entry.sourceRel);
  return buildTargetRemote(kind, entry.provider, entry.dataset, subpath);
}

function isAlreadyMovedError(err) {
  const blob = [err?.message, err?.stderr, err?.stdout].filter(Boolean).join('\n');
  return /source doesn't exist|doesn't exist or is a directory|object not found|couldn't find file|directory not found|didn't find section/i.test(blob);
}

function rcloneMove(sourceRemote, destRemote, { retries = 3 } = {}) {
  const dockerArgs = [
    'run', '--rm',
    '-v', `${RCLONE_CONFIG}:/config/rclone:ro`,
    'rclone/rclone',
    'moveto', sourceRemote, destRemote,
    '--log-level', 'INFO',
  ];
  let lastErr;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const stdout = execFileSync('docker', dockerArgs, {
        encoding: 'utf8',
        maxBuffer: 32 * 1024 * 1024,
      });
      if (stdout) process.stdout.write(stdout);
      return 'moved';
    } catch (err) {
      lastErr = err;
      if (err.stdout) process.stdout.write(err.stdout);
      if (err.stderr) process.stderr.write(err.stderr);
      if (isAlreadyMovedError(err)) {
        console.warn(`  already moved: ${path.basename(sourceRemote)}`);
        return 'already_moved';
      }
      if (attempt < retries) {
        const waitSec = attempt * 15;
        const hint = String(err.stderr ?? err.message ?? err).split('\n').find((l) => l.trim()) ?? '';
        console.warn(`  retry ${attempt}/${retries} in ${waitSec}s: ${path.basename(sourceRemote)} — ${hint.slice(0, 120)}`);
        execFileSync('powershell', ['-Command', `Start-Sleep -Seconds ${waitSec}`], { stdio: 'ignore' });
      }
    }
  }
  throw lastErr;
}

function writeDatasetManifest(manifestRemote, files) {
  const manifest = {
    generated_at: new Date().toISOString(),
    provider: files[0].provider,
    dataset: files[0].dataset,
    version: VERSION,
    promotion_source: '_migration_from_D',
    file_count: files.length,
    total_bytes: files.reduce((s, f) => s + f.sizeBytes, 0),
    files: files.map((f) => ({
      name: path.basename(f.sourceRel),
      sha256: f.sha256,
      size_bytes: f.sizeBytes,
      source_rel: f.sourceRel,
    })),
  };
  const localTmp = path.join(MANIFESTS, '_tmp_promote_manifest.json');
  fs.writeFileSync(localTmp, JSON.stringify(manifest, null, 2), 'utf8');
  execFileSync('docker', [
    'run', '--rm',
    '-v', `${RCLONE_CONFIG}:/config/rclone:ro`,
    '-v', `${localTmp}:/tmp/manifest.json:ro`,
    'rclone/rclone',
    'copyto', '/tmp/manifest.json', manifestRemote,
    '--log-level', 'INFO',
  ], { stdio: 'inherit' });
}

function executeFromMapping(proposal) {
  const entries = proposal.entries ?? [];
  const doQuarantine = !PROMOTE_ONLY;
  const doPromote = !QUARANTINE_ONLY;

  const pendingUnclassified = entries.filter(
    (e) => e.action === 'promote' && e.status === 'UNCLASSIFIED' && !e.approved,
  );
  if (pendingUnclassified.length > 0) {
    console.warn(`Warning: ${pendingUnclassified.length} UNCLASSIFIED rows not approved — will skip.`);
  }

  /** @type {string[]} */
  const failures = [];
  const stats = { moved: 0, alreadyMoved: 0, failed: 0 };

  if (doQuarantine) {
    const q = entries.filter((e) => e.action === 'quarantine' && e.status === 'QUARANTINE_DUPLICATE');
    console.log(`Quarantining ${q.length} files...`);
    for (const e of q) {
      console.log(`  ${e.sourceRel}`);
      try {
        const result = rcloneMove(e.sourceRemote, e.targetRemote);
        if (result === 'already_moved') stats.alreadyMoved++;
        else stats.moved++;
      } catch (err) {
        stats.failed++;
        failures.push(`${e.sourceRel}: ${err.message ?? err}`);
        console.error(`  FAILED quarantine: ${e.sourceRel}`);
      }
    }
  }

  if (doPromote) {
    const promote = entries.filter(
      (e) => e.action === 'promote'
        && e.approved
        && (e.status !== 'UNCLASSIFIED' || (e.provider && e.dataset)),
    );
    console.log(`Promoting ${promote.length} files...`);
    const manifestGroups = new Map();
    for (const e of promote) {
      const target = resolveTarget(e);
      console.log(`  ${e.sourceRel} -> ${target}`);
      try {
        const result = rcloneMove(e.sourceRemote, target);
        if (result === 'already_moved') {
          stats.alreadyMoved++;
        } else {
          stats.moved++;
          const manifestKey = target.includes('/raw/')
            ? target.replace(/\/raw\/.*$/, '')
            : target.replace(/\/[^/]+$/, '');
          const manifestRemote = `${manifestKey}/manifest.json`;
          if (!manifestGroups.has(manifestRemote)) manifestGroups.set(manifestRemote, []);
          manifestGroups.get(manifestRemote).push({ ...e, targetRemote: target });
        }
      } catch (err) {
        stats.failed++;
        failures.push(`${e.sourceRel}: ${err.message ?? err}`);
        console.error(`  FAILED promote: ${e.sourceRel}`);
      }
    }
    for (const [manifestRemote, files] of manifestGroups) {
      try {
        writeDatasetManifest(manifestRemote, files);
      } catch (err) {
        failures.push(`manifest ${manifestRemote}: ${err.message ?? err}`);
      }
    }
  }

  if (failures.length > 0) {
    const failPath = path.join(MANIFESTS, 'migration_promote_quarantine_failures.json');
    fs.writeFileSync(failPath, JSON.stringify({ failedAt: new Date().toISOString(), stats, failures }, null, 2), 'utf8');
    console.warn(`\n${failures.length} failures logged: ${failPath}`);
  }

  console.log('Execute complete.', JSON.stringify(stats));
}

async function main() {
  if (MERGE_ONLY) {
    if (!fs.existsSync(MAPPING_FILE)) {
      throw new Error(`Mapping file missing: ${MAPPING_FILE}. Run dry-run first.`);
    }
    loadProposalWithOptionalCsvMerge(MAPPING_FILE, MERGE_CSV_FILE);
    return;
  }

  if (EXECUTE) {
    if (!fs.existsSync(MAPPING_FILE)) {
      throw new Error(`Mapping file missing: ${MAPPING_FILE}. Run dry-run first.`);
    }
    console.log(`=== EXECUTE from ${MAPPING_FILE} ===`);
    const proposal = loadProposalWithOptionalCsvMerge(MAPPING_FILE, MERGE_CSV_FILE);
    executeFromMapping(proposal);
    return;
  }

  console.log('=== DRY RUN — building mapping proposal ===');
  buildProposal();
  console.log('\nReview mapping_proposal.json + mapping_proposal_unclassified.csv');
  console.log('Edit CSV, then: --execute --merge-csv=storage/manifests/mapping_proposal_unclassified.csv');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
