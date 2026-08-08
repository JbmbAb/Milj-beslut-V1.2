/**
 * SAN-2026-013 — Move Trafikverket county packs out of Lantmateriet.
 *
 * Target layout:
 *   Data/Trafikverket/{Mätdata,Beläggning,Avvattning,Buller}/<pack>/
 *
 * Also normalizes existing Trafikverket root packs into the same categories.
 * Patches manifest.provider → Trafikverket. Never deletes.
 *
 *   node scripts/ops/sanitation-trafikverket-from-lantmateriet.mjs
 *   node scripts/ops/sanitation-trafikverket-from-lantmateriet.mjs --execute
 */
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const DRY = !process.argv.includes('--execute');
const MASTER =
  process.env.GEO_MASTER_ARCHIVE ??
  'H:\\Delade enheter\\Miljöbeslut\\GEO_Master_Archive';
const DATA = path.join(MASTER, 'Data');
const LANT = path.join(DATA, 'Lantmateriet');
const TV = path.join(DATA, 'Trafikverket');
const QUAR = path.join(MASTER, '_quarantine', 'SAN-2026-013-trafikverket-conflict');
const OPS_DIR = path.join(MASTER, '_ops', 'sanitation');
const REPO_OPS = path.join(process.cwd(), 'storage', 'manifests', 'sanitation');
const OP_BATCH = 'SAN-2026-013';

/** @typedef {'Mätdata' | 'Beläggning' | 'Avvattning' | 'Buller'} TvCategory */

const CATEGORIES = /** @type {const} */ (['Mätdata', 'Beläggning', 'Avvattning', 'Buller']);

/**
 * @param {string} name
 * @returns {TvCategory | null}
 */
function classifyPack(name) {
  if (/^HH_NOISE_/i.test(name)) return 'Buller';
  if (/avvattning/i.test(name)) return 'Avvattning';
  if (/beläggning|belaggning/i.test(name)) return 'Beläggning';
  if (/mätdata|matdata/i.test(name)) return 'Mätdata';
  return null;
}

function listDirs(dir) {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    return [];
  }
}

function ensureDir(dir) {
  if (!DRY) fs.mkdirSync(dir, { recursive: true });
}

function writeJson(fp, obj) {
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  fs.writeFileSync(fp, `${JSON.stringify(obj, null, 2)}\n`, 'utf8');
}

function writeDual(name, obj) {
  writeJson(path.join(OPS_DIR, name), obj);
  writeJson(path.join(REPO_OPS, name), obj);
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

function moveDir(src, dest) {
  ensureDir(path.dirname(dest));
  if (fs.existsSync(dest)) throw new Error(`destination exists: ${dest}`);
  if (DRY) {
    console.log(`[dry-run] MOVE\n  ${src}\n  → ${dest}`);
    return;
  }
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

/**
 * @param {string} datasetDir
 * @param {string} newProvider
 * @param {string} opId
 * @param {TvCategory} category
 */
function patchManifests(datasetDir, newProvider, opId, category) {
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
          const prev = man.provider;
          const updated = {
            ...man,
            provider: newProvider,
            dataset_family: `trafikverket.${category.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '')}`,
            provenance: `${man.provenance ?? 'archive'}|sanitation:${opId}`,
            sanitation: {
              ...(typeof man.sanitation === 'object' && man.sanitation ? man.sanitation : {}),
              last_provider_move: {
                operation_id: opId,
                from: prev,
                to: newProvider,
                category,
                at: new Date().toISOString(),
              },
            },
          };
          if (!DRY) fs.writeFileSync(fp, `${JSON.stringify(updated, null, 2)}\n`, 'utf8');
        } catch (err) {
          console.warn(`manifest patch failed ${fp}:`, err instanceof Error ? err.message : err);
        }
      }
    }
  };
  if (!DRY) walk(datasetDir);
}

/**
 * @returns {Array<{ source: string, sourceRel: string, fromProvider: string, category: TvCategory, destName: string, kind: 'lant_to_tv' | 'tv_normalize' }>}
 */
function buildPlan() {
  /** @type {ReturnType<typeof buildPlan>} */
  const moves = [];

  for (const name of listDirs(LANT)) {
    const category = classifyPack(name);
    if (!category) continue;
    moves.push({
      source: path.join(LANT, name),
      sourceRel: path.relative(MASTER, path.join(LANT, name)).replace(/\\/g, '/'),
      fromProvider: 'Lantmateriet',
      category,
      destName: name,
      kind: 'lant_to_tv',
    });
  }

  // Normalize already-correct provider packs sitting at Trafikverket root.
  for (const name of listDirs(TV)) {
    if (CATEGORIES.includes(/** @type {TvCategory} */ (name))) continue;
    if (name === 'README_SANITATION.md') continue;
    const category = classifyPack(name);
    if (!category) continue;
    moves.push({
      source: path.join(TV, name),
      sourceRel: path.relative(MASTER, path.join(TV, name)).replace(/\\/g, '/'),
      fromProvider: 'Trafikverket',
      category,
      destName: name,
      kind: 'tv_normalize',
    });
  }

  return moves;
}

function main() {
  console.log(`${DRY ? 'DRY-RUN' : 'EXECUTE'} ${OP_BATCH}`);
  const plan = buildPlan();

  const byCat = Object.fromEntries(CATEGORIES.map((c) => [c, 0]));
  for (const m of plan) byCat[m.category] += 1;

  for (const c of CATEGORIES) ensureDir(path.join(TV, c));

  /** @type {object[]} */
  const results = [];
  let opSeq = 0;
  let moved = 0;
  let quarantined = 0;
  let errors = 0;

  for (const item of plan) {
    opSeq += 1;
    const opId = `${OP_BATCH}-${String(opSeq).padStart(3, '0')}`;
    const destParent = path.join(TV, item.category);
    const dest = path.join(destParent, item.destName);
    const destRel = path.relative(MASTER, dest).replace(/\\/g, '/');
    const files = countFiles(item.source);

    if (fs.existsSync(dest)) {
      const qDest = path.join(QUAR, item.category, item.destName);
      try {
        if (!DRY) ensureDir(path.dirname(qDest));
        moveDir(item.source, qDest);
        if (!DRY) patchManifests(qDest, 'Trafikverket', opId, item.category);
        quarantined += 1;
        const artifact = {
          schema_version: '1.0',
          operation_id: opId,
          action: 'MOVE',
          reason: 'provider_mismatch',
          source: item.sourceRel,
          target: path.relative(MASTER, qDest).replace(/\\/g, '/'),
          provider: 'Trafikverket',
          dataset: item.destName,
          files,
          old_hashes: [],
          new_hashes: [],
          approved_by: 'JbmbAb',
          created_at: new Date().toISOString(),
          closed_at: DRY ? undefined : new Date().toISOString(),
          status: DRY ? 'planned' : 'completed',
          notes: `Conflict at ${destRel}; moved to quarantine. kind=${item.kind}`,
          evidence: { category: item.category, kind: item.kind, fromProvider: item.fromProvider },
        };
        writeDual(`${opId}.json`, artifact);
        results.push({ ...artifact, status: DRY ? 'planned_quarantine' : 'quarantined' });
      } catch (err) {
        errors += 1;
        results.push({
          operation_id: opId,
          status: 'error',
          source: item.sourceRel,
          note: err instanceof Error ? err.message : String(err),
        });
      }
      continue;
    }

    try {
      moveDir(item.source, dest);
      if (!DRY) patchManifests(dest, 'Trafikverket', opId, item.category);
      moved += 1;
      const artifact = {
        schema_version: '1.0',
        operation_id: opId,
        action: 'MOVE',
        reason: 'provider_mismatch',
        source: item.sourceRel,
        target: destRel,
        provider: 'Trafikverket',
        dataset: item.destName,
        files,
        old_hashes: [],
        new_hashes: [],
        approved_by: 'JbmbAb',
        created_at: new Date().toISOString(),
        closed_at: DRY ? undefined : new Date().toISOString(),
        status: DRY ? 'planned' : 'completed',
        notes: `Provider integrity: ${item.fromProvider} → Trafikverket/${item.category}. kind=${item.kind}`,
        evidence: {
          category: item.category,
          kind: item.kind,
          fromProvider: item.fromProvider,
          invariant: 'provider_change_requires_SAN',
        },
      };
      writeDual(`${opId}.json`, artifact);
      results.push({
        operation_id: opId,
        status: DRY ? 'planned' : 'moved',
        source: item.sourceRel,
        target: destRel,
        category: item.category,
        kind: item.kind,
        files,
      });
    } catch (err) {
      errors += 1;
      results.push({
        operation_id: opId,
        status: 'error',
        source: item.sourceRel,
        note: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const readme = `# Trafikverket — Master Archive provider tree

Invariant: a file must never change provider without an explicit SAN-/Migration-event.

Layout (frozen):
- \`Mätdata/\` — county road measurement packs
- \`Beläggning/\` — pavement condition packs
- \`Avvattning/\` — drainage packs
- \`Buller/\` — HH_NOISE_* and related noise products

Last sanitation: ${OP_BATCH} (${new Date().toISOString()})
`;
  if (!DRY) {
    fs.writeFileSync(path.join(TV, 'README_SANITATION.md'), readme, 'utf8');
  }

  const batch = {
    schema_version: '1.0',
    operation_id: OP_BATCH,
    action: 'MOVE',
    reason: 'provider_mismatch',
    source: 'Data/Lantmateriet/{*-Mätdata,*-Beläggning,*-Avvattning}',
    target: 'Data/Trafikverket/{Mätdata,Beläggning,Avvattning,Buller}',
    provider: 'Trafikverket',
    files: plan.length,
    old_hashes: [],
    new_hashes: [],
    approved_by: 'JbmbAb',
    created_at: new Date().toISOString(),
    closed_at: DRY ? undefined : new Date().toISOString(),
    status: DRY ? 'planned' : errors ? 'in_progress' : 'completed',
    notes:
      'P1 provider integrity: county Trafikverket packs must not live under Lantmateriet. Category layout frozen. Provider changes require SAN event.',
    evidence: {
      dry_run: DRY,
      planned: plan.length,
      by_category: byCat,
      moved,
      quarantined,
      errors,
      lant_to_tv: plan.filter((p) => p.kind === 'lant_to_tv').length,
      tv_normalize: plan.filter((p) => p.kind === 'tv_normalize').length,
      results_sample: results.slice(0, 10),
    },
  };
  writeDual(`${OP_BATCH}.json`, batch);
  writeDual(`${OP_BATCH}-summary.json`, { batch, results });

  console.log(
    JSON.stringify(
      {
        dry_run: DRY,
        planned: plan.length,
        by_category: byCat,
        moved,
        quarantined,
        errors,
        lant_to_tv: plan.filter((p) => p.kind === 'lant_to_tv').length,
        tv_normalize: plan.filter((p) => p.kind === 'tv_normalize').length,
      },
      null,
      2,
    ),
  );

  if (errors > 0) process.exit(1);
}

main();
