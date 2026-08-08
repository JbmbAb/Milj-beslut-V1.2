/**
 * P1 provider sanitation: MOVE misclassified datasets (never delete).
 *
 *   node scripts/ops/sanitation-p1-provider-moves.mjs
 *   node scripts/ops/sanitation-p1-provider-moves.mjs --execute
 */
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const DRY = !process.argv.includes('--execute');
const MASTER = process.env.GEO_MASTER_ARCHIVE
  ?? 'H:\\Delade enheter\\Miljöbeslut\\GEO_Master_Archive';
const DATA = path.join(MASTER, 'Data');
const DOCS = path.join(MASTER, 'Documents', 'Sources');
const QUAR = path.join(MASTER, '_quarantine', 'SAN-2026-004-provider-mismatch');
const OPS_DIR = path.join(MASTER, '_ops', 'sanitation');
const REPO_OPS = path.join(process.cwd(), 'storage', 'manifests', 'sanitation');

function listDirs(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  } catch {
    return [];
  }
}

function findDir(parent, predicate) {
  return listDirs(parent).find((n) => predicate(n)) ?? null;
}

function ensureDir(dir) {
  if (!DRY) fs.mkdirSync(dir, { recursive: true });
}

function writeJson(fp, obj) {
  ensureDir(path.dirname(fp));
  if (DRY && !fp.includes('storage\\manifests') && !fp.includes('storage/manifests')) {
    console.log(`[dry-run] write ${fp}`);
    return;
  }
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
      if (e.isDirectory()) walk(fp);
      else n += 1;
    }
  };
  if (fs.existsSync(dir)) walk(dir);
  return n;
}

function patchManifestsProvider(datasetDir, newProvider) {
  const walk = (d) => {
    let entries;
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const fp = path.join(d, e.name);
      if (e.isDirectory()) walk(fp);
      else if (e.name === 'manifest.json') {
        try {
          const man = JSON.parse(fs.readFileSync(fp, 'utf8'));
          const updated = {
            ...man,
            provider: newProvider,
            provenance: `${man.provenance ?? 'archive'}|sanitation:SAN-2026-004`,
          };
          if (!DRY) fs.writeFileSync(fp, `${JSON.stringify(updated, null, 2)}\n`, 'utf8');
          else console.log(`[dry-run] patch provider→${newProvider} ${fp}`);
        } catch (err) {
          console.warn(`manifest patch failed ${fp}:`, err instanceof Error ? err.message : err);
        }
      }
    }
  };
  walk(datasetDir);
}

function moveDir(src, destParent, destName) {
  ensureDir(destParent);
  const dest = path.join(destParent, destName);
  if (fs.existsSync(dest)) {
    throw new Error(`destination exists: ${dest}`);
  }
  if (DRY) {
    console.log(`[dry-run] MOVE\n  ${src}\n  → ${dest}`);
    return dest;
  }
  // Prefer rename; fall back to robocopy+/rd on cross-volume issues
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
  return dest;
}

/** @type {Array<{ id: string, reason: string, fromProvider: string, toProvider: string, toRoot: string, match: (name: string) => boolean, onConflict: 'quarantine' | 'skip' }>} */
function buildPlan() {
  const nv = path.join(DATA, 'Naturvardsverket');
  const sgu = path.join(DATA, 'SGU');
  const ops = path.join(DATA, 'Miljobeslut_Ops');

  /** @type {Array<{ id: string, reason: string, source: string, targetProvider: string, targetParent: string, destName: string, onConflict: 'quarantine' }>} */
  const moves = [];

  const addMatches = (fromDir, fromProvider, matcher, targetProvider, targetParent, onConflict = 'quarantine') => {
    for (const name of listDirs(fromDir)) {
      if (!matcher(name)) continue;
      moves.push({
        id: `SAN-2026-004-${String(moves.length + 1).padStart(3, '0')}`,
        reason: 'provider_mismatch',
        source: path.join(fromDir, name),
        sourceRel: path.relative(MASTER, path.join(fromDir, name)).replace(/\\/g, '/'),
        fromProvider,
        targetProvider,
        targetParent,
        destName: name,
        onConflict,
      });
    }
  };

  // NV → Trafikverket (noise / wildlife accidents)
  addMatches(
    nv,
    'Naturvardsverket',
    (n) => /^HH_NOISE_/i.test(n) || /^Viltolyckskartor/i.test(n),
    'Trafikverket',
    path.join(DATA, 'Trafikverket'),
  );

  // NV → MCF (duplicate likely)
  addMatches(
    nv,
    'Naturvardsverket',
    (n) => /^riksintresse_mcf$/i.test(n),
    'MCF',
    path.join(DATA, 'MCF'),
  );

  // NV → LST (Entryscape LST dumps)
  addMatches(
    nv,
    'Naturvardsverket',
    (n) => /entryscape/i.test(n) || /Lstn\.Lst_/i.test(n),
    'LST',
    path.join(DATA, 'LST'),
  );

  // NV → Documents/Kommun
  addMatches(
    nv,
    'Naturvardsverket',
    (n) => /^Karlskoga-/i.test(n),
    'Kommun',
    path.join(DOCS, 'Kommun'),
  );

  // SGU → Trafikverket
  addMatches(
    sgu,
    'SGU',
    (n) => /^Kronoberg-/i.test(n) || /^Cykel/i.test(n),
    'Trafikverket',
    path.join(DATA, 'Trafikverket'),
  );

  // SGU → Naturvardsverket
  addMatches(
    sgu,
    'SGU',
    (n) => /^Gron_Infrastruktur/i.test(n) || /^analys_boreal/i.test(n) || /^analys_boreonemoral/i.test(n),
    'Naturvardsverket',
    path.join(DATA, 'Naturvardsverket'),
  );

  // SGU kommun PDF dumps → Documents/Kommun
  addMatches(
    sgu,
    'SGU',
    (n) => /^(sundbyberg|varberg|norberg|falkenberg|lindesberg)-/i.test(n) || /^Lindesberg-/i.test(n),
    'Kommun',
    path.join(DOCS, 'Kommun'),
  );

  // Ops → SGU (geophysics); quarantine if SGU already has equivalent
  addMatches(
    ops,
    'Miljobeslut_Ops',
    (n) => /^geofysik-/i.test(n) || /^genomslapplighet$/i.test(n),
    'SGU',
    path.join(DATA, 'SGU'),
  );

  // Ops analys_boreal → Naturvardsverket (same family as SGU misfiles)
  addMatches(
    ops,
    'Miljobeslut_Ops',
    (n) => /^analys_boreal/i.test(n),
    'Naturvardsverket',
    path.join(DATA, 'Naturvardsverket'),
  );

  return moves;
}

function resolveTarget(move) {
  const dest = path.join(move.targetParent, move.destName);
  if (fs.existsSync(dest)) {
    return {
      mode: 'quarantine',
      destParent: path.join(QUAR, move.fromProvider),
      destName: move.destName,
      destRel: path.relative(MASTER, path.join(QUAR, move.fromProvider, move.destName)).replace(/\\/g, '/'),
      note: `target already exists at ${path.relative(MASTER, dest).replace(/\\/g, '/')}`,
    };
  }
  return {
    mode: 'move',
    destParent: move.targetParent,
    destName: move.destName,
    destRel: path.relative(MASTER, dest).replace(/\\/g, '/'),
    note: null,
  };
}

function main() {
  console.log(DRY ? 'DRY-RUN (pass --execute to apply)' : 'EXECUTE P1 provider moves');
  ensureDir(path.join(DATA, 'Trafikverket'));
  ensureDir(path.join(DOCS, 'Kommun'));
  ensureDir(QUAR);

  if (!DRY) {
    fs.mkdirSync(path.join(DATA, 'Trafikverket'), { recursive: true });
    fs.mkdirSync(path.join(DOCS, 'Kommun'), { recursive: true });
    fs.mkdirSync(QUAR, { recursive: true });
    // marker README for new provider
    const readme = path.join(DATA, 'Trafikverket', 'README_SANITATION.md');
    if (!fs.existsSync(readme)) {
      fs.writeFileSync(
        readme,
        '# Trafikverket\n\nCreated by SAN-2026-004 (provider_mismatch sanitation).\n'
          + 'Canonical home for NVDB/noise/wildlife-accident datasets previously misfiled under other providers.\n',
        'utf8',
      );
    }
  }

  const plan = buildPlan();
  console.log(`Planned moves: ${plan.length}`);

  const results = [];
  for (const move of plan) {
    if (!fs.existsSync(move.source)) {
      results.push({ ...move, status: 'skipped_missing' });
      continue;
    }
    const files = countFiles(move.source);
    const resolved = resolveTarget(move);
    const targetAbs = path.join(resolved.destParent, resolved.destName);

    try {
      if (resolved.mode === 'quarantine') ensureDir(resolved.destParent);
      const finalDest = moveDir(move.source, resolved.destParent, resolved.destName);
      if (resolved.mode === 'move' && move.targetProvider !== 'Kommun') {
        patchManifestsProvider(finalDest, move.targetProvider);
      }

      const artifact = {
        schema_version: '1.0',
        operation_id: move.id,
        action: resolved.mode === 'quarantine' ? 'MOVE' : 'MOVE',
        reason: 'provider_mismatch',
        source: move.sourceRel,
        target: resolved.destRel,
        provider: move.targetProvider,
        dataset: move.destName,
        files,
        old_hashes: [],
        new_hashes: [],
        approved_by: 'governance',
        created_at: new Date().toISOString(),
        closed_at: DRY ? undefined : new Date().toISOString(),
        status: DRY ? 'planned' : 'completed',
        notes: resolved.note
          ?? `Provider semantic fix: ${move.fromProvider} → ${move.targetProvider}`,
        evidence: {
          from_provider: move.fromProvider,
          to_provider: move.targetProvider,
          mode: resolved.mode,
          batch: 'SAN-2026-004',
        },
        related_operation_ids: ['SAN-2026-004'],
      };
      writeJson(path.join(OPS_DIR, `${move.id}.json`), artifact);
      writeJson(path.join(REPO_OPS, `${move.id}.json`), artifact);
      results.push({
        id: move.id,
        status: DRY ? 'planned' : 'completed',
        mode: resolved.mode,
        source: move.sourceRel,
        target: resolved.destRel,
        files,
        from: move.fromProvider,
        to: move.targetProvider,
      });
    } catch (err) {
      console.error(`FAIL ${move.id}:`, err instanceof Error ? err.message : err);
      results.push({
        id: move.id,
        status: 'failed',
        source: move.sourceRel,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const batch = {
    schema_version: '1.0',
    operation_id: 'SAN-2026-004',
    action: 'MOVE',
    reason: 'provider_mismatch',
    source: 'Data/* (misclassified providers)',
    target: 'Data/Trafikverket|Naturvardsverket|SGU|MCF|LST + Documents/Sources/Kommun + _quarantine',
    files: results.reduce((s, r) => s + (r.files ?? 0), 0),
    old_hashes: [],
    new_hashes: [],
    approved_by: 'governance',
    created_at: new Date().toISOString(),
    closed_at: DRY ? undefined : new Date().toISOString(),
    status: DRY ? 'planned' : results.some((r) => r.status === 'failed') ? 'in_progress' : 'completed',
    notes:
      'P1 provider sanitation. Provider = responsible source, not current folder owner. '
      + 'Conflicts (dest exists) moved to _quarantine/SAN-2026-004-provider-mismatch.',
    evidence: {
      principle: 'Provider ≠ file owner; Provider = responsible source',
      moves: results,
    },
  };
  writeJson(path.join(OPS_DIR, 'SAN-2026-004.json'), batch);
  writeJson(path.join(REPO_OPS, 'SAN-2026-004.json'), batch);

  const summary = {
    dry_run: DRY,
    total: results.length,
    completed: results.filter((r) => r.status === 'completed' || r.status === 'planned').length,
    quarantined: results.filter((r) => r.mode === 'quarantine').length,
    failed: results.filter((r) => r.status === 'failed').length,
    by_target: results.reduce((acc, r) => {
      const k = r.to ?? 'unknown';
      acc[k] = (acc[k] ?? 0) + 1;
      return acc;
    }, {}),
    results,
  };
  writeJson(path.join(REPO_OPS, 'SAN-2026-004-summary.json'), summary);
  console.log(JSON.stringify(summary, null, 2));
}

main();
