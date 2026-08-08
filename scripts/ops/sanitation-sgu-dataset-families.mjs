/**
 * SAN-2026-009 — SGU dataset family consolidation (CLASSIFY, do-not-merge).
 * Optionally quarantine only safe junk: Windows duplicate "Brunnar (1)", empty stubs.
 *
 *   node scripts/ops/sanitation-sgu-dataset-families.mjs
 *   node scripts/ops/sanitation-sgu-dataset-families.mjs --execute
 *   node scripts/ops/sanitation-sgu-dataset-families.mjs --execute --quarantine-safe-junk
 */
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const DRY = !process.argv.includes('--execute');
const QUARANTINE_JUNK = process.argv.includes('--quarantine-safe-junk');
const MASTER = process.env.GEO_MASTER_ARCHIVE
  ?? 'H:\\Delade enheter\\Miljöbeslut\\GEO_Master_Archive';
const SGU = path.join(MASTER, 'Data', 'SGU');
const QROOT = path.join(MASTER, '_quarantine', 'SAN-2026-009-sgu-safe-junk');
const OPS_DIR = path.join(MASTER, '_ops', 'sanitation');
const REPO_OPS = path.join(process.cwd(), 'storage', 'manifests', 'sanitation');

/** @typedef {{ folder: string, role: string, registry_key?: string, note?: string }} Member */
/** @typedef {{ family_id: string, provider: string, label: string, members: Member[], do_not_merge: true }} Family */

/** @type {Family[]} */
const FAMILIES = [
  {
    family_id: 'sgu.brunnar',
    provider: 'SGU',
    label: 'Brunnar',
    do_not_merge: true,
    members: [
      { folder: 'brunnar', role: 'canonical', registry_key: 'Brunnar', note: 'Current harvest path (alias of registry Brunnar)' },
      { folder: 'Brunnar (1)', role: 'windows_duplicate', note: 'Windows copy-collision name — safe junk if brunnar exists' },
      { folder: 'Legacy_Archive', role: 'legacy_path', note: 'May contain older Brunnar; inspect before purge' },
    ],
  },
  {
    family_id: 'sgu.jordarter',
    provider: 'SGU',
    label: 'Jordarter (multi-scale / multi-generation)',
    do_not_merge: true,
    members: [
      { folder: 'Jordarters25k100k', role: 'canonical', registry_key: 'Jordarters25k100k', note: 'Registry key' },
      { folder: 'Jordarter25k100k', role: 'alias', registry_key: 'Jordarters25k100k', note: 'Harvest id alias — keep until manifests rewritten' },
      { folder: 'jordarter25k-100k', role: 'sidecar_extract', note: 'extracted/ layout — scale product 25k-100k' },
      { folder: 'jordarter200k', role: 'scale_variant', note: '200k product — separate scale' },
      { folder: 'jordarter250k', role: 'scale_variant', note: '250k product — separate scale' },
      { folder: 'jordarter750k', role: 'scale_variant', note: '750k base extract — related to Blockighet/Landform' },
      { folder: 'Jordarter750kBlockighet', role: 'generation_variant', registry_key: 'Jordarter750kBlockighet' },
      { folder: 'Jordarter750kLandform', role: 'generation_variant', registry_key: 'Jordarter750kLandform' },
      { folder: 'jordarter1miljon', role: 'scale_variant', note: '1M overview' },
      { folder: 'jordartsanalyser', role: 'generation_variant', note: 'Analyses product — not soil map' },
    ],
  },
  {
    family_id: 'sgu.berg',
    provider: 'SGU',
    label: 'Berggrund / bergkvalitet',
    do_not_merge: true,
    members: [
      { folder: 'BERG', role: 'generation_variant', note: 'Large extracted berg package' },
      { folder: 'Berg-2025', role: 'generation_variant', note: '2025 generation — different product year' },
      { folder: 'berggrund1miljon', role: 'scale_variant' },
      { folder: 'berggrund50k-250k', role: 'scale_variant' },
      { folder: 'berggrundsobservationer', role: 'generation_variant' },
      { folder: 'bergartskemi', role: 'generation_variant' },
      { folder: 'bergets-alder', role: 'generation_variant' },
      { folder: 'bergkvalitet', role: 'generation_variant' },
      { folder: 'bergkvalitet-tekniska-analyser', role: 'generation_variant' },
    ],
  },
  {
    family_id: 'sgu.jordskred',
    provider: 'SGU',
    label: 'Jordskred / raviner',
    do_not_merge: true,
    members: [
      { folder: 'Jordskred', role: 'canonical', registry_key: 'Jordskred' },
      { folder: 'jordskred-raviner', role: 'empty_stub', note: 'Empty alias folder of registry zip name' },
      { folder: 'AktsamhetEfterarbetad', role: 'generation_variant', registry_key: 'AktsamhetEfterarbetad' },
    ],
  },
  {
    family_id: 'sgu.grundvatten',
    provider: 'SGU',
    label: 'Grundvatten',
    do_not_merge: true,
    members: [
      { folder: 'Grundvatten', role: 'canonical', registry_key: 'Grundvatten', note: 'Magasin / sårbarhet' },
      { folder: 'Grundvattenforekomster', role: 'generation_variant', registry_key: 'Grundvattenforekomster', note: 'WFD water bodies — different product' },
      { folder: 'grundvattenkvalitet_analysresultat_provplatser_v2', role: 'generation_variant' },
      { folder: 'grundvattenkvalitet-analysresultat-provplatser-v2-beskrivning', role: 'sidecar_extract' },
    ],
  },
  {
    family_id: 'sgu.jorddjup',
    provider: 'SGU',
    label: 'Jorddjup',
    do_not_merge: true,
    members: [
      { folder: 'jorddjupsmodell', role: 'canonical', registry_key: 'Jorddjup10m' },
      { folder: 'jorddjupsobservationer', role: 'generation_variant' },
      { folder: 'jordlagerfoljder', role: 'generation_variant' },
    ],
  },
  {
    family_id: 'sgu.geofysik_gamma',
    provider: 'SGU',
    label: 'Flyg-gamma / geofysik',
    do_not_merge: true,
    members: [
      { folder: 'FlygGammaOversiktlig', role: 'canonical', note: 'Primary harvest with sizeable payload' },
      { folder: 'geofysik-flyg-gammastralning-oversiktlig', role: 'alias', note: 'Ops-moved name; tiny — candidate supersede' },
      { folder: 'geofysik-flyg-gammastralning-detaljerad', role: 'generation_variant' },
      { folder: 'geofysik-flyg-em-slingram-detaljerad', role: 'generation_variant' },
      { folder: 'geofysik-mark-markradar', role: 'generation_variant' },
      { folder: 'geofysik-mark-seismik', role: 'generation_variant' },
    ],
  },
];

function writeJson(fp, obj) {
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  fs.writeFileSync(fp, `${JSON.stringify(obj, null, 2)}\n`, 'utf8');
}

function listSguFolders() {
  return fs.readdirSync(SGU, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
}

function folderMeta(name) {
  const abs = path.join(SGU, name);
  if (!fs.existsSync(abs)) return { present: false, versions: [], bytes: 0, files: 0 };
  const versions = fs.readdirSync(abs, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  let bytes = 0;
  let files = 0;
  const walk = (d) => {
    let ents;
    try {
      ents = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of ents) {
      const fp = path.join(d, e.name);
      if (e.isDirectory()) walk(fp);
      else {
        files += 1;
        try {
          bytes += fs.statSync(fp).size;
        } catch {
          /* ignore */
        }
      }
    }
  };
  walk(abs);
  return { present: true, versions, bytes, files };
}

function moveDir(src, dest) {
  if (DRY) {
    console.log(`[dry-run] MOVE\n  ${src}\n  → ${dest}`);
    return;
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (fs.existsSync(dest)) throw new Error(`dest exists ${dest}`);
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

function enrichFamilies(allFolders) {
  const assigned = new Set();
  const enriched = FAMILIES.map((fam) => {
    const members = fam.members.map((m) => {
      const meta = folderMeta(m.folder);
      if (meta.present) assigned.add(m.folder);
      return { ...m, ...meta };
    });
    return { ...fam, members };
  });

  const unassigned = allFolders.filter((f) => !assigned.has(f)).map((f) => ({
    folder: f,
    role: 'unassigned',
    ...folderMeta(f),
    note: 'Not yet mapped to a family — keep as standalone dataset',
  }));

  return { enriched, unassigned };
}

function quarantineSafeJunk() {
  const ops = [];
  const candidates = [
    {
      id: 'SAN-2026-009-001',
      folder: 'Brunnar (1)',
      reason: 'windows_duplicate',
      requireSibling: 'brunnar',
    },
    {
      id: 'SAN-2026-009-002',
      folder: 'jordskred-raviner',
      reason: 'empty_stub',
      requireSibling: 'Jordskred',
      requireEmptyish: true,
    },
  ];

  if (!DRY && QUARANTINE_JUNK) fs.mkdirSync(QROOT, { recursive: true });

  for (const c of candidates) {
    const src = path.join(SGU, c.folder);
    const sibling = path.join(SGU, c.requireSibling);
    if (!fs.existsSync(src)) {
      ops.push({ id: c.id, status: 'skipped_missing', folder: c.folder });
      continue;
    }
    if (!fs.existsSync(sibling)) {
      ops.push({ id: c.id, status: 'skipped_no_sibling', folder: c.folder });
      continue;
    }
    const meta = folderMeta(c.folder);
    if (c.requireEmptyish && meta.bytes > 1024 * 1024) {
      ops.push({ id: c.id, status: 'skipped_not_empty', folder: c.folder, bytes: meta.bytes });
      continue;
    }
    if (!QUARANTINE_JUNK) {
      ops.push({
        id: c.id,
        status: DRY ? 'planned_needs_flag' : 'skipped_flag',
        folder: c.folder,
        note: 'Pass --quarantine-safe-junk to move',
        bytes: meta.bytes,
        files: meta.files,
      });
      continue;
    }

    const dest = path.join(QROOT, c.folder);
    const destRel = path.relative(MASTER, dest).replace(/\\/g, '/');
    try {
      moveDir(src, dest);
      const artifact = {
        schema_version: '1.0',
        operation_id: c.id,
        action: 'MOVE',
        reason: 'dataset_family_normalize',
        source: `Data/SGU/${c.folder}`,
        target: destRel,
        provider: 'SGU',
        dataset: c.folder,
        files: meta.files,
        old_hashes: [],
        new_hashes: [],
        classification: c.reason === 'windows_duplicate' ? 'duplicate' : 'obsolete',
        approved_by: 'governance',
        created_at: new Date().toISOString(),
        closed_at: DRY ? undefined : new Date().toISOString(),
        status: DRY ? 'planned' : 'completed',
        notes: `Safe junk within family normalize (${c.reason}). Sibling kept: ${c.requireSibling}`,
        related_operation_ids: ['SAN-2026-009'],
      };
      writeJson(path.join(REPO_OPS, `${c.id}.json`), artifact);
      if (!DRY) writeJson(path.join(OPS_DIR, `${c.id}.json`), artifact);
      ops.push({
        id: c.id,
        status: DRY ? 'planned' : 'completed',
        folder: c.folder,
        target: destRel,
        files: meta.files,
        bytes: meta.bytes,
      });
    } catch (err) {
      ops.push({
        id: c.id,
        status: 'failed',
        folder: c.folder,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return ops;
}

function main() {
  console.log(
    DRY
      ? 'DRY-RUN SAN-2026-009 SGU families'
      : `EXECUTE SAN-2026-009 (quarantine_safe_junk=${QUARANTINE_JUNK})`,
  );

  const allFolders = listSguFolders();
  const { enriched, unassigned } = enrichFamilies(allFolders);
  const junkOps = quarantineSafeJunk();

  const catalog = {
    schema_version: '1.0',
    artifact_type: 'dataset_family_catalog',
    operation_id: 'SAN-2026-009',
    action: 'CLASSIFY',
    reason: 'dataset_family_normalize',
    provider: 'SGU',
    source: 'Data/SGU',
    approved_by: 'governance',
    created_at: new Date().toISOString(),
    closed_at: DRY ? undefined : new Date().toISOString(),
    status: DRY ? 'planned' : 'completed',
    principle: [
      'Family, not deletion',
      'Scale/generation variants are products, not duplicates',
      'Registry key is identity; folder names are aliases',
      'do_not_merge: true',
    ],
    notes:
      'Maps SGU folders into families. Does not merge jordarter scales or berg generations. '
      + 'Safe junk quarantine is explicit opt-in (--quarantine-safe-junk).',
    families: enriched,
    unassigned,
    safe_junk_ops: junkOps,
  };

  const sanitation = {
    schema_version: '1.0',
    operation_id: 'SAN-2026-009',
    action: 'CLASSIFY',
    reason: 'dataset_family_normalize',
    source: 'Data/SGU',
    target: '_ops/sanitation + dataset family catalog',
    provider: 'SGU',
    files: allFolders.length,
    old_hashes: [],
    new_hashes: [],
    approved_by: 'governance',
    created_at: catalog.created_at,
    closed_at: catalog.closed_at,
    status: catalog.status,
    notes: catalog.notes,
    evidence: {
      family_count: enriched.length,
      unassigned_count: unassigned.length,
      catalog: 'SGU-DATASET-FAMILIES-2026-009.json',
      junk_ops: junkOps,
    },
  };

  writeJson(path.join(REPO_OPS, 'SAN-2026-009.json'), sanitation);
  writeJson(path.join(REPO_OPS, 'SGU-DATASET-FAMILIES-2026-009.json'), catalog);
  if (!DRY) {
    writeJson(path.join(OPS_DIR, 'SAN-2026-009.json'), sanitation);
    writeJson(path.join(OPS_DIR, 'SGU-DATASET-FAMILIES-2026-009.json'), catalog);
  }

  console.log(JSON.stringify({
    dry_run: DRY,
    quarantine_safe_junk: QUARANTINE_JUNK,
    families: enriched.map((f) => ({
      id: f.family_id,
      members: f.members.filter((m) => m.present).map((m) => `${m.folder}[${m.role}]`),
    })),
    unassigned: unassigned.map((u) => u.folder),
    junk_ops: junkOps,
  }, null, 2));
}

main();
