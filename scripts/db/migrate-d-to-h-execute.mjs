/**
 * Execute D:/C: → H: migration from D_to_H_migration_plan.json
 * Phase 0: delete known junk (not geodata)
 * Phase 1+: copy copy_required items with sha256 manifest
 *
 * Run: node scripts/db/migrate-d-to-h-execute.mjs [--dry-run]
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';

const DRY_RUN = process.argv.includes('--dry-run');
const SKIP_H_SYNC = process.argv.includes('--staging-only');
const PLAN_PATH = path.join(process.cwd(), 'storage', 'manifests', 'D_to_H_migration_plan.json');
const LOG_PATH = path.join(process.cwd(), 'storage', 'manifests', 'D_to_H_migration_log.jsonl');
const MANIFEST_PATH = path.join(process.cwd(), 'storage', 'manifests', 'D_to_H_migration_executed.json');

const STAGING = path.join(process.cwd(), 'storage', 'migration_staging', '2026-06-19');
const MIGRATION_ROOT = path.join(STAGING, 'Data', '_migration_from_D', '2026-06-19');
const DOCS_MIGRATION_ROOT = path.join(STAGING, 'Documents', 'Sources', '_migration_from_D', '2026-06-19');

function resolveHRoot() {
  const base = 'H:\\Delade enheter';
  if (!fs.existsSync(base)) return null;
  const hit = fs.readdirSync(base).find((d) => d.includes('Milj') && d.includes('beslut'));
  return hit ? path.join(base, hit) : null;
}

function resolveHDestPaths() {
  const hRoot = resolveHRoot();
  if (!hRoot) return null;
  const master = path.join(hRoot, 'GEO_Master_Archive');
  return {
    hRoot,
    master,
    data: path.join(master, 'Data', '_migration_from_D', '2026-06-19'),
    docs: path.join(master, 'Documents', 'Sources', '_migration_from_D', '2026-06-19'),
  };
}

const JUNK_PATTERNS = [
  /\.tmp\.driveupload/i,
  /sxyprn\.mp4$/i,
  /\.mp4$/i,
  /CursorUserSetup.*\.exe$/i,
  /YIFY\.mp4$/i,
];

/** Whole-folder robocopy tiers (faster for large sets) */
const FOLDER_TIERS = [
  {
    id: 'tier1_lm_historiska',
    src: 'D:\\GEodata\\Lantmateriet_Historiska',
    dest: path.join(MIGRATION_ROOT, 'D_GEodata', 'Lantmateriet_Historiska'),
  },
  {
    id: 'tier1_temp_extract',
    src: 'D:\\GEodata\\temp_massive_extract',
    dest: path.join(MIGRATION_ROOT, 'D_GEodata', 'temp_massive_extract'),
  },
  {
    id: 'tier2_miljolut',
    src: 'D:\\Users\\jimmy\\Desktop\\MiljoBeslut_Produktdata\\Miljölut.se',
    dest: path.join(MIGRATION_ROOT, 'D_Desktop_Produktdata', 'Miljölut.se'),
  },
  {
    id: 'tier2_miljobeslut',
    src: 'D:\\Users\\jimmy\\Desktop\\MiljoBeslut_Produktdata\\Miljöbeslut.se',
    dest: path.join(MIGRATION_ROOT, 'D_Desktop_Produktdata', 'Miljöbeslut.se'),
  },
  {
    id: 'tier2_ops_pipeline',
    src: 'D:\\Users\\jimmy\\Desktop\\MiljoBeslut_Produktdata\\Miljobeslut_Ops_Pipeline',
    dest: path.join(MIGRATION_ROOT, 'D_Desktop_Produktdata', 'Miljobeslut_Ops_Pipeline'),
  },
  {
    id: 'tier2_figma',
    src: 'D:\\Users\\jimmy\\Desktop\\MiljoBeslut_Produktdata\\Figma_Modulunderlag',
    dest: path.join(MIGRATION_ROOT, 'D_Desktop_Produktdata', 'Figma_Modulunderlag'),
  },
  {
    id: 'tier2_docs',
    src: 'D:\\Users\\jimmy\\Desktop\\MiljoBeslut_Produktdata\\00_Dokumentation',
    dest: path.join(MIGRATION_ROOT, 'D_Desktop_Produktdata', '00_Dokumentation'),
  },
  {
    id: 'tier3_dataportal_v2',
    src: 'D:\\ingest-arkiv-2026-03-29\\dataportal-env-v2',
    dest: path.join(DOCS_MIGRATION_ROOT, 'D_ingest_arkiv', 'dataportal-env-v2'),
  },
  {
    id: 'tier3_legal',
    src: 'D:\\ingest-arkiv-2026-03-29\\legal',
    dest: path.join(DOCS_MIGRATION_ROOT, 'D_ingest_arkiv', 'legal'),
  },
  {
    id: 'tier3_rattspraxis',
    src: 'D:\\ingest-arkiv-2026-03-29\\rattspraxis',
    dest: path.join(DOCS_MIGRATION_ROOT, 'D_ingest_arkiv', 'rattspraxis'),
  },
  {
    id: 'tier3_rattspraxis_miljo',
    src: 'D:\\ingest-arkiv-2026-03-29\\rattspraxis-miljo',
    dest: path.join(DOCS_MIGRATION_ROOT, 'D_ingest_arkiv', 'rattspraxis-miljo'),
  },
  {
    id: 'tier3_rattspraxis_mark',
    src: 'D:\\ingest-arkiv-2026-03-29\\rattspraxis-mark-miljo-split',
    dest: path.join(DOCS_MIGRATION_ROOT, 'D_ingest_arkiv', 'rattspraxis-mark-miljo-split'),
  },
  {
    id: 'tier3_dataportal_env',
    src: 'D:\\ingest-arkiv-2026-03-29\\dataportal-env',
    dest: path.join(DOCS_MIGRATION_ROOT, 'D_ingest_arkiv', 'dataportal-env'),
  },
  {
    id: 'tier3_dataportal_v2_smoke',
    src: 'D:\\ingest-arkiv-2026-03-29\\dataportal-env-v2-smoke-fix',
    dest: path.join(DOCS_MIGRATION_ROOT, 'D_ingest_arkiv', 'dataportal-env-v2-smoke-fix'),
  },
  {
    id: 'tier4_kommun_beslut',
    src: 'C:\\GEO PDF\\kommun-beslut',
    dest: path.join(DOCS_MIGRATION_ROOT, 'C_GEO_PDF', 'kommun-beslut'),
  },
];

const JUNK_PATHS = [
  'D:\\Users\\jimmy\\Downloads\\.tmp.driveupload',
  'D:\\Users\\jimmy\\Desktop\\MiljoBeslut_Produktdata\\.tmp.driveupload',
];

function log(entry) {
  const line = JSON.stringify({ ts: new Date().toISOString(), dryRun: DRY_RUN, ...entry });
  fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
  fs.appendFileSync(LOG_PATH, `${line}\n`);
  console.log(`[${entry.phase ?? entry.action ?? '?'}] ${entry.message ?? entry.id ?? ''}`);
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

function isJunk(relativePath, fileName) {
  const probe = `${relativePath}/${fileName}`;
  return JUNK_PATTERNS.some((re) => re.test(probe));
}

function rmRecursive(target) {
  if (!fs.existsSync(target)) return { deleted: false, reason: 'missing' };
  if (DRY_RUN) return { deleted: false, dryRun: true };
  fs.rmSync(target, { recursive: true, force: true });
  return { deleted: true };
}

function robocopyMirror(src, dest, logTag = 'robocopy') {
  if (!fs.existsSync(src)) {
    return { ok: false, skipped: true, reason: 'source_missing' };
  }
  if (DRY_RUN) return { ok: true, dryRun: true };
  const logFile = path.join(process.cwd(), 'storage', 'manifests', `${logTag}.log`);
  const args = [
    src,
    dest,
    '/E',
    '/COPY:DAT',
    '/R:2',
    '/W:5',
    '/MT:8',
    '/LOG+:' + logFile,
    '/TEE',
    '/NP',
  ];
  const result = spawnSync('robocopy', args, { encoding: 'utf8', shell: true });
  const code = result.status ?? 0;
  const ok = code >= 0 && code < 8;
  return { ok, exitCode: code, logFile };
}

function phaseSyncStagingToH() {
  if (SKIP_H_SYNC) {
    log({ phase: 'h-sync', message: 'Skipped (--staging-only)' });
    return { skipped: true };
  }
  const h = resolveHDestPaths();
  if (!h) {
    log({ phase: 'h-sync', message: 'H: not available — data remains in local staging' });
    return { skipped: true, reason: 'h_unavailable' };
  }
  log({ phase: 'h-sync', message: `Sync Data → ${h.data}` });
  const dataSync = robocopyMirror(MIGRATION_ROOT, h.data, 'h-sync-data');
  log({ phase: 'h-sync', message: `Sync Docs → ${h.docs}` });
  const docsSync = robocopyMirror(DOCS_MIGRATION_ROOT, h.docs, 'h-sync-docs');
  return { h, dataSync, docsSync };
}

function resolveSourcePath(plan, item) {
  const src = plan.sources.find((s) => s.id === item.sourceId);
  if (!src) return null;
  return path.join(src.path, item.relativePath.replace(/\//g, path.sep));
}

function resolveDestPath(item) {
  const base = item.targetHint.startsWith('Documents') ? DOCS_MIGRATION_ROOT : MIGRATION_ROOT;
  const relDir = path.dirname(item.relativePath.replace(/\//g, path.sep));
  return path.join(base, item.sourceId, relDir);
}

function phaseCleanup() {
  log({ phase: '0-cleanup', message: 'Removing junk paths' });
  const results = [];
  for (const p of JUNK_PATHS) {
    const r = rmRecursive(p);
    results.push({ path: p, ...r });
    log({ phase: '0-cleanup', path: p, ...r });
  }

  const downloads = 'D:\\Users\\jimmy\\Downloads';
  if (fs.existsSync(downloads)) {
    for (const e of fs.readdirSync(downloads, { withFileTypes: true })) {
      const full = path.join(downloads, e.name);
      if (isJunk(e.name, e.name) || /\.mp4$/i.test(e.name) || /sxyprn/i.test(e.name)) {
        if (DRY_RUN) {
          log({ phase: '0-cleanup', path: full, dryRun: true });
        } else {
          fs.rmSync(full, { recursive: true, force: true });
          log({ phase: '0-cleanup', path: full, deleted: true });
        }
      }
    }
  }
  return results;
}

function phaseFolderTiers() {
  const results = [];
  for (const tier of FOLDER_TIERS) {
    log({ phase: 'folder-tier', id: tier.id, src: tier.src, dest: tier.dest });
    const r = robocopyMirror(tier.src, tier.dest);
    results.push({ ...tier, ...r });
    log({ phase: 'folder-tier', id: tier.id, ...r });
  }
  return results;
}

function buildFolderPrefixes(plan) {
  return FOLDER_TIERS.map((tier) => {
    for (const s of plan.sources) {
      const base = s.path.toLowerCase();
      if (tier.src.toLowerCase().startsWith(base)) {
        const rel = tier.src.slice(s.path.length).replace(/^\\/, '').replace(/\\/g, '/').toLowerCase();
        return { sourceId: s.id, prefix: rel, tierId: tier.id };
      }
    }
    if (tier.src.startsWith('C:\\')) {
      const rel = tier.src.slice('C:\\GEO PDF\\'.length).replace(/\\/g, '/').toLowerCase();
      return { sourceId: 'C_GEO_PDF', prefix: rel, tierId: tier.id };
    }
    return null;
  }).filter(Boolean);
}

function coveredByFolderTier(item, folderPrefixes) {
  const rel = item.relativePath.replace(/\\/g, '/').toLowerCase();
  return folderPrefixes.some(
    (fp) => fp.sourceId === item.sourceId && (rel === fp.prefix || rel.startsWith(`${fp.prefix}/`)),
  );
}

function phasePlanFiles(plan) {
  const items = (plan.copyRequired ?? []).filter((i) => i.verdict === 'copy_required');
  const folderPrefixes = buildFolderPrefixes(plan);
  const results = [];
  let copied = 0;
  let skipped = 0;

  for (const item of items) {
    if (isJunk(item.relativePath, item.fileName)) {
      skipped++;
      continue;
    }

    const srcPath = resolveSourcePath(plan, item);
    if (!srcPath || !fs.existsSync(srcPath)) {
      skipped++;
      continue;
    }

    if (coveredByFolderTier(item, folderPrefixes)) {
      skipped++;
      continue;
    }

    const destDir = resolveDestPath(item);
    const destPath = path.join(destDir, item.fileName);
    fs.mkdirSync(destDir, { recursive: true });

    if (fs.existsSync(destPath)) {
      const ss = fs.statSync(srcPath);
      const ds = fs.statSync(destPath);
      if (ss.size === ds.size) {
        skipped++;
        continue;
      }
    }

    if (DRY_RUN) {
      log({ phase: 'file-copy', src: srcPath, dest: destPath, dryRun: true });
      copied++;
      continue;
    }

    fs.copyFileSync(srcPath, destPath);
    const sha256 = sha256File(destPath);
    const row = {
      sourceId: item.sourceId,
      relativePath: item.relativePath,
      srcPath,
      destPath,
      sizeBytes: item.sizeBytes,
      sha256,
    };
    results.push(row);
    copied++;
    if (copied % 25 === 0) log({ phase: 'file-copy', message: `${copied} files copied...` });
  }

  log({ phase: 'file-copy', message: `Done: ${copied} copied, ${skipped} skipped` });
  return { copied, skipped, files: results };
}

function main() {
  if (!fs.existsSync(PLAN_PATH)) {
    console.error(`Missing plan: ${PLAN_PATH}. Run migrate-d-to-h-plan.mjs first.`);
    process.exit(1);
  }

  const plan = JSON.parse(fs.readFileSync(PLAN_PATH, 'utf8'));
  log({ phase: 'start', message: DRY_RUN ? 'DRY RUN' : 'LIVE EXECUTION', planGenerated: plan.generatedAt });

  const cleanup = phaseCleanup();
  const folders = phaseFolderTiers();
  const files = phasePlanFiles(plan);
  const hSync = phaseSyncStagingToH();

  const report = {
    executedAt: new Date().toISOString(),
    dryRun: DRY_RUN,
    planGeneratedAt: plan.generatedAt,
    cleanup,
    folderTiers: folders,
    fileCopy: { copied: files.copied, skipped: files.skipped, manifestCount: files.files.length },
    hSync,
    fileManifest: files.files,
    targets: {
      staging: STAGING,
      data: MIGRATION_ROOT,
      documents: DOCS_MIGRATION_ROOT,
      h: resolveHDestPaths(),
    },
  };

  fs.mkdirSync(path.dirname(MANIFEST_PATH), { recursive: true });
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(report, null, 2));

  const h = resolveHDestPaths();
  if (h) {
    try {
      const hManifest = path.join(h.master, '_manifests', 'D_to_H_migration_executed.json');
      fs.mkdirSync(path.dirname(hManifest), { recursive: true });
      fs.writeFileSync(hManifest, JSON.stringify(report, null, 2));
      log({ phase: 'done', message: `Manifest on H: ${hManifest}` });
    } catch (err) {
      log({ phase: 'done', message: `H: manifest write failed: ${err.message}` });
    }
  }

  log({ phase: 'done', message: `Local manifest: ${MANIFEST_PATH}` });
  console.log(JSON.stringify({ folderTiers: folders.length, fileCopy: files }, null, 2));
}

main();
