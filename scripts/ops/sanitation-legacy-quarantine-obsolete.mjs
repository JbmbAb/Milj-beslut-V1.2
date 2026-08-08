/**
 * SAN-2026-006 — MOVE obsolete _migration_from_D buckets → quarantine.
 * Evidence-preserving; no delete. Based on LEGACY-INV-2026-005.
 *
 *   node scripts/ops/sanitation-legacy-quarantine-obsolete.mjs
 *   node scripts/ops/sanitation-legacy-quarantine-obsolete.mjs --execute
 */
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const DRY = !process.argv.includes('--execute');
const MASTER = process.env.GEO_MASTER_ARCHIVE
  ?? 'H:\\Delade enheter\\Miljöbeslut\\GEO_Master_Archive';
const VERSION = '2026-06-19';
const QROOT = path.join(MASTER, '_quarantine', `legacy_migration_obsolete_${VERSION}`);
const OPS_DIR = path.join(MASTER, '_ops', 'sanitation');
const REPO_OPS = path.join(process.cwd(), 'storage', 'manifests', 'sanitation');
const INV = path.join(REPO_OPS, 'LEGACY-INV-2026-005.json');

/** Top-level obsolete moves (children covered by parent move). */
const MOVES = [
  {
    id: 'SAN-2026-006-001',
    rel: `Data/_migration_from_D/${VERSION}/D_Desktop_Produktdata`,
  },
  {
    id: 'SAN-2026-006-002',
    rel: `Data/_migration_from_D/${VERSION}/D_Downloads`,
  },
  {
    id: 'SAN-2026-006-003',
    rel: `Documents/Sources/_migration_from_D/${VERSION}/D_ingest_arkiv/dataportal-env`,
  },
  {
    id: 'SAN-2026-006-004',
    rel: `Documents/Sources/_migration_from_D/${VERSION}/D_ingest_arkiv/dataportal-env-v2`,
  },
  {
    id: 'SAN-2026-006-005',
    rel: `Documents/Sources/_migration_from_D/${VERSION}/D_ingest_arkiv/dataportal-env-v2-smoke-fix`,
  },
];

function writeJson(fp, obj) {
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  fs.writeFileSync(fp, `${JSON.stringify(obj, null, 2)}\n`, 'utf8');
}

function countFiles(dir) {
  let n = 0;
  const walk = (d) => {
    let entries;
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const fp = path.join(d, e.name);
      if (e.isDirectory()) {
        if (['node_modules', '.git', 'dist', '.next'].includes(e.name)) {
          n += 1; // opaque marker
          continue;
        }
        walk(fp);
      } else n += 1;
    }
  };
  if (fs.existsSync(dir)) walk(dir);
  return n;
}

function moveDir(src, dest) {
  if (DRY) {
    console.log(`[dry-run] MOVE\n  ${src}\n  → ${dest}`);
    return;
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (fs.existsSync(dest)) throw new Error(`destination exists: ${dest}`);
  try {
    fs.renameSync(src, dest);
  } catch {
    execFileSync(
      'pwsh',
      [
        '-NoProfile',
        '-Command',
        `Move-Item -LiteralPath '${src.replace(/'/g, "''")}' -Destination '${dest.replace(/'/g, "''")}' -Force`,
      ],
      { stdio: 'inherit' },
    );
  }
}

function main() {
  console.log(DRY ? 'DRY-RUN SAN-2026-006' : 'EXECUTE SAN-2026-006 obsolete → quarantine');

  if (!fs.existsSync(INV)) {
    throw new Error(`Missing inventory ${INV} — run SAN-2026-005 first`);
  }

  if (!DRY) fs.mkdirSync(QROOT, { recursive: true });

  const results = [];
  for (const move of MOVES) {
    const src = path.join(MASTER, move.rel);
    const destName = move.rel.replace(/\//g, '__');
    const dest = path.join(QROOT, destName);
    const destRel = path.relative(MASTER, dest).replace(/\\/g, '/');

    if (!fs.existsSync(src)) {
      results.push({
        id: move.id,
        status: 'skipped_missing',
        source: move.rel,
        target: destRel,
      });
      continue;
    }

    const files = countFiles(src);
    try {
      moveDir(src, dest);
      const artifact = {
        schema_version: '1.0',
        operation_id: move.id,
        action: 'MOVE',
        reason: 'legacy_migration',
        source: move.rel,
        target: destRel,
        provider: '_migration_from_D',
        dataset: VERSION,
        files,
        old_hashes: [],
        new_hashes: [],
        classification: 'obsolete',
        approved_by: 'governance',
        created_at: new Date().toISOString(),
        closed_at: DRY ? undefined : new Date().toISOString(),
        status: DRY ? 'planned' : 'completed',
        notes: 'Obsolete bucket from LEGACY-INV-2026-005 → quarantine (no delete).',
        related_operation_ids: ['SAN-2026-005', 'SAN-2026-006'],
        evidence: {
          inventory: 'LEGACY-INV-2026-005.json',
          batch: 'SAN-2026-006',
        },
      };
      writeJson(path.join(REPO_OPS, `${move.id}.json`), artifact);
      if (!DRY) writeJson(path.join(OPS_DIR, `${move.id}.json`), artifact);
      results.push({
        id: move.id,
        status: DRY ? 'planned' : 'completed',
        source: move.rel,
        target: destRel,
        files,
      });
    } catch (err) {
      console.error(`FAIL ${move.id}:`, err instanceof Error ? err.message : err);
      results.push({
        id: move.id,
        status: 'failed',
        source: move.rel,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const batch = {
    schema_version: '1.0',
    operation_id: 'SAN-2026-006',
    action: 'MOVE',
    reason: 'legacy_migration',
    source: '_migration_from_D obsolete buckets (from SAN-2026-005)',
    target: `_quarantine/legacy_migration_obsolete_${VERSION}`,
    files: results.reduce((s, r) => s + (r.files ?? 0), 0),
    old_hashes: [],
    new_hashes: [],
    classification: 'obsolete',
    approved_by: 'governance',
    created_at: new Date().toISOString(),
    closed_at: DRY ? undefined : new Date().toISOString(),
    status: DRY
      ? 'planned'
      : results.some((r) => r.status === 'failed')
        ? 'in_progress'
        : 'completed',
    notes:
      'Controlled emptying of obsolete class only. Legal/unknown corpora and D_GEodata duplicate '
      + 'remain for SAN-2026-007 / SAN-2026-008.',
    related_operation_ids: ['SAN-2026-005'],
    evidence: { moves: results },
  };

  writeJson(path.join(REPO_OPS, 'SAN-2026-006.json'), batch);
  writeJson(path.join(REPO_OPS, 'SAN-2026-006-summary.json'), {
    dry_run: DRY,
    ...batch,
    remaining_in_migration: {
      note: 'After this op, unknown legal + C_GEO_PDF + D_GEodata duplicate should remain',
    },
  });
  if (!DRY) writeJson(path.join(OPS_DIR, 'SAN-2026-006.json'), batch);

  console.log(JSON.stringify({
    dry_run: DRY,
    operation_id: 'SAN-2026-006',
    completed: results.filter((r) => r.status === 'completed' || r.status === 'planned').length,
    failed: results.filter((r) => r.status === 'failed').length,
    skipped: results.filter((r) => r.status === 'skipped_missing').length,
    files: batch.files,
    quarantine: `_quarantine/legacy_migration_obsolete_${VERSION}`,
    results,
  }, null, 2));
}

main();
