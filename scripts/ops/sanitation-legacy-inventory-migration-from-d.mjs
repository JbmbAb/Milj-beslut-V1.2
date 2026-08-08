/**
 * Legacy Inventory Artifact for _migration_from_D (SAN-2026-005).
 *
 * Inventory + CLASSIFY only — no deletes, no uncontrolled moves.
 * Buckets → canonical | duplicate | obsolete | unknown
 *
 *   node scripts/ops/sanitation-legacy-inventory-migration-from-d.mjs
 *   node scripts/ops/sanitation-legacy-inventory-migration-from-d.mjs --execute
 */
import fs from 'fs';
import path from 'path';

const DRY = !process.argv.includes('--execute');
const MASTER = process.env.GEO_MASTER_ARCHIVE
  ?? 'H:\\Delade enheter\\Miljöbeslut\\GEO_Master_Archive';
const VERSION = '2026-06-19';
const OPS_DIR = path.join(MASTER, '_ops', 'sanitation');
const REPO_OPS = path.join(process.cwd(), 'storage', 'manifests', 'sanitation');

const ROOTS = [
  {
    id: 'data',
    abs: path.join(MASTER, 'Data', '_migration_from_D', VERSION),
    rel: `Data/_migration_from_D/${VERSION}`,
  },
  {
    id: 'documents',
    abs: path.join(MASTER, 'Documents', 'Sources', '_migration_from_D', VERSION),
    rel: `Documents/Sources/_migration_from_D/${VERSION}`,
  },
  {
    id: 'kommun_nested',
    abs: path.join(MASTER, 'Documents', 'Sources', 'Kommun', '_migration_from_D', VERSION),
    rel: `Documents/Sources/Kommun/_migration_from_D/${VERSION}`,
  },
];

/** @typedef {'canonical'|'duplicate'|'obsolete'|'unknown'} Class */

/**
 * Heuristic classifiers — first match wins (path relative to a ROOT abs).
 * @type {Array<{ id: string, classification: Class, recommended_next: string, test: (rel: string) => boolean, note: string }>}
 */
const RULES = [
  {
    id: 'desktop_produktdata_tree',
    classification: 'obsolete',
    recommended_next: 'quarantine_then_delete_after_retention',
    test: (rel) => /^D_Desktop_Produktdata(\/|$)/i.test(rel),
    note: 'Entire desktop produktdata tree (app source, Figma, Ops mirror) — not Master Archive geodata.',
  },
  {
    id: 'personal_downloads',
    classification: 'obsolete',
    recommended_next: 'export_personal_then_delete',
    test: (rel) => /^D_Downloads(\/|$)/i.test(rel),
    note: 'Personal/course/receipt downloads — out of geodata scope.',
  },
  {
    id: 'geodata_remnant_tree',
    classification: 'duplicate',
    recommended_next: 'quarantine_after_coverage_diff',
    test: (rel) => /^D_GEodata(\/|$)/i.test(rel),
    note: 'Near-empty D_GEodata remnant (Historiska crumbs + .qlr/.lyrx). Canonical: Data/LM/Historiska.',
  },
  {
    id: 'dataportal_scrape_blob',
    classification: 'obsolete',
    recommended_next: 'quarantine_scrape_keep_curated_sample',
    test: (rel) => /(^|\/)dataportal-env(\/|$)/i.test(rel) && !/\/curated\//i.test(rel),
    note: 'dataportal scrape junk (mostly .json / extensionless) — not Mimers Brunn datasets.',
  },
  {
    id: 'dataportal_v2_tooling',
    classification: 'obsolete',
    recommended_next: 'quarantine',
    test: (rel) => /dataportal-env-v2/i.test(rel),
    note: 'Inventory/smoke/tooling outputs from dataportal-env-v2.',
  },
  {
    id: 'legal_corpora',
    classification: 'unknown',
    recommended_next: 'review_promote_to_Documents_Sources_Legal',
    test: (rel) => /(^|\/)legal(\/|$)/i.test(rel) || /rattspraxis/i.test(rel),
    note: 'Court/legal corpora — candidate Documents/Sources/Legal_* after human review.',
  },
  {
    id: 'nv_brochure',
    classification: 'unknown',
    recommended_next: 'review_vs_Documents_Sources_Naturvardsverket',
    test: (rel) => /D_ingest_arkiv\/naturvardsverket/i.test(rel) || /(^|\/)naturvardsverket(\/|$)/i.test(rel),
    note: 'NV brochure remnant — check against Documents/Sources.',
  },
  {
    id: 'ingest_arkiv_mixed',
    classification: 'unknown',
    recommended_next: 'split_children_then_reclassify',
    test: (rel) => /^D_ingest_arkiv$/i.test(rel),
    note: 'Mixed parent: mostly obsolete scrape + unknown legal corpora — split before emptying.',
  },
  {
    id: 'geo_pdf_kommun',
    classification: 'unknown',
    recommended_next: 'review_promote_to_Documents_Sources_Kommun',
    test: (rel) => /C_GEO_PDF/i.test(rel),
    note: 'Legacy GEO PDF set — possible kommun/document corpus.',
  },
  {
    id: 'kommun_nested_migration',
    classification: 'unknown',
    recommended_next: 'merge_into_Documents_Sources_Kommun_or_quarantine',
    test: (rel) => true,
    note: 'Nested Kommun/_migration_from_D leftovers.',
  },
];

function writeJson(fp, obj) {
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  fs.writeFileSync(fp, `${JSON.stringify(obj, null, 2)}\n`, 'utf8');
}

function walkBuckets(rootAbs, maxDepth = 3) {
  /** @type {Array<{ rel: string, files: number, bytes: number, sample_ext?: Record<string, number> }>} */
  const buckets = [];

  function stats(dir, depth, rel, collectExt) {
    let ents;
    try {
      ents = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return { files: 0, bytes: 0, ext: {} };
    }
    let files = 0;
    let bytes = 0;
    /** @type {Record<string, number>} */
    const ext = {};
    for (const e of ents) {
      const fp = path.join(dir, e.name);
      const childRel = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (['node_modules', '.git', 'dist', '.next'].includes(e.name)) {
          // treat as opaque obsolete mass — estimate by shallow file count only
          let shallow = 0;
          try {
            shallow = fs.readdirSync(fp).length;
          } catch {
            shallow = 0;
          }
          if (depth < maxDepth) {
            buckets.push({
              rel: childRel,
              files: shallow,
              bytes: 0,
              opaque: true,
              tag: 'app_junk_dir',
            });
          }
          continue;
        }
        const sub = stats(fp, depth + 1, childRel, depth < 2);
        files += sub.files;
        bytes += sub.bytes;
        if (depth < maxDepth) {
          buckets.push({
            rel: childRel,
            files: sub.files,
            bytes: sub.bytes,
            sample_ext: depth < 2 ? sub.ext : undefined,
          });
        }
      } else {
        let sz = 0;
        try {
          sz = fs.statSync(fp).size;
        } catch {
          sz = 0;
        }
        files += 1;
        bytes += sz;
        if (collectExt) {
          const x = path.extname(e.name).toLowerCase() || '(none)';
          ext[x] = (ext[x] ?? 0) + 1;
        }
      }
    }
    return { files, bytes, ext };
  }

  const total = stats(rootAbs, 0, '', true);
  return { total, buckets };
}

function classifyBucket(rootId, rel) {
  const rules = rootId === 'kommun_nested'
    ? RULES.filter((r) => r.id === 'kommun_nested_migration' || r.id === 'geo_pdf_kommun')
    : RULES.filter((r) => r.id !== 'kommun_nested_migration');

  for (const rule of rules) {
    if (rule.test(rel)) {
      return {
        classification: rule.classification,
        rule_id: rule.id,
        recommended_next: rule.recommended_next,
        note: rule.note,
      };
    }
  }
  return {
    classification: /** @type {Class} */ ('unknown'),
    rule_id: 'default',
    recommended_next: 'manual_review',
    note: 'No heuristic matched.',
  };
}

function classifyRoot(root) {
  if (!fs.existsSync(root.abs)) {
    return {
      root: root.rel,
      present: false,
      total_files: 0,
      total_bytes: 0,
      entries: [],
    };
  }

  const { total, buckets } = walkBuckets(root.abs, 3);
  // Prefer depth-1 / meaningful buckets: take unique paths at depth 1-2
  const depth1 = buckets.filter((b) => !b.rel.includes('/') || b.rel.split('/').length <= 2);
  // Deduplicate: keep deepest classified meaningful set — use all buckets depth<=2
  const selected = buckets
    .filter((b) => b.rel.split('/').length <= 2)
    .sort((a, b) => b.bytes - a.bytes);

  const entries = selected.map((b) => {
    const c = classifyBucket(root.id, b.rel);
    return {
      path: `${root.rel}/${b.rel}`.replace(/\\/g, '/'),
      files: b.files,
      bytes: b.bytes,
      opaque: b.opaque ?? false,
      sample_ext: b.sample_ext,
      classification: c.classification,
      rule_id: c.rule_id,
      recommended_next: c.recommended_next,
      note: c.note,
    };
  });

  return {
    root: root.rel,
    present: true,
    total_files: total.files,
    total_bytes: total.bytes,
    entries,
  };
}

function summarize(inventoryRoots) {
  /** @type {Record<Class, { buckets: number, files: number, bytes: number }>} */
  const byClass = {
    canonical: { buckets: 0, files: 0, bytes: 0 },
    duplicate: { buckets: 0, files: 0, bytes: 0 },
    obsolete: { buckets: 0, files: 0, bytes: 0 },
    unknown: { buckets: 0, files: 0, bytes: 0 },
  };

  // Count only depth-1 buckets to avoid double-counting nested
  for (const root of inventoryRoots) {
    const depth1 = (root.entries ?? []).filter((e) => {
      const rel = e.path.slice(root.root.length + 1);
      return !rel.includes('/');
    });
    for (const e of depth1) {
      const c = e.classification;
      byClass[c].buckets += 1;
      byClass[c].files += e.files ?? 0;
      byClass[c].bytes += e.bytes ?? 0;
    }
  }

  return byClass;
}

function main() {
  console.log(DRY ? 'DRY-RUN inventory (pass --execute to persist artifacts)' : 'EXECUTE — write Legacy Inventory Artifact');

  const roots = ROOTS.map(classifyRoot);
  const byClass = summarize(roots);

  const inventory = {
    schema_version: '1.0',
    artifact_type: 'legacy_inventory',
    operation_id: 'SAN-2026-005',
    action: 'CLASSIFY',
    reason: 'legacy_migration',
    source: 'Data/_migration_from_D + Documents/Sources/_migration_from_D (+ Kommun nested)',
    version: VERSION,
    approved_by: 'governance',
    created_at: new Date().toISOString(),
    closed_at: DRY ? undefined : new Date().toISOString(),
    status: DRY ? 'planned' : 'completed',
    principle: [
      '_migration_from_D → Legacy Inventory Artifact → Classification',
      'canonical | duplicate | obsolete | unknown',
      'No uncontrolled delete in this step',
    ],
    notes:
      'Classification is heuristic at bucket level. Emptying requires a follow-up SAN MOVE/INVALIDATE '
      + 'per class after governance approval. No canonical geodata promoted in this operation.',
    summary: {
      by_class: byClass,
      roots: roots.map((r) => ({
        root: r.root,
        present: r.present,
        total_files: r.total_files,
        total_bytes: r.total_bytes,
        total_gb: Number(((r.total_bytes ?? 0) / 1e9).toFixed(3)),
      })),
    },
    roots,
    next_operations_suggested: [
      {
        id: 'SAN-2026-006',
        action: 'MOVE',
        scope: 'obsolete buckets → _quarantine/legacy_migration_obsolete_2026-06-19',
        requires: 'governance approval',
      },
      {
        id: 'SAN-2026-007',
        action: 'CLASSIFY',
        scope: 'unknown legal/PDF corpora — human review → Documents/Sources/Legal_*',
        requires: 'human_in_the_loop',
      },
      {
        id: 'SAN-2026-008',
        action: 'MOVE',
        scope: 'duplicate LM Historiska remnant → quarantine after coverage diff',
        requires: 'coverage_diff vs Data/LM/Historiska',
      },
    ],
  };

  const sanitation = {
    schema_version: '1.0',
    operation_id: 'SAN-2026-005',
    action: 'CLASSIFY',
    reason: 'legacy_migration',
    source: inventory.source,
    target: '_ops/sanitation/SAN-2026-005 + legacy inventory JSON',
    provider: '_migration_from_D',
    dataset: VERSION,
    files: roots.reduce((s, r) => s + (r.total_files ?? 0), 0),
    old_hashes: [],
    new_hashes: [],
    approved_by: 'governance',
    created_at: inventory.created_at,
    closed_at: inventory.closed_at,
    status: inventory.status,
    notes: inventory.notes,
    evidence: {
      summary: inventory.summary,
      inventory_rel: 'storage/manifests/sanitation/LEGACY-INV-2026-005.json',
    },
  };

  // Always write repo copy; archive copy on --execute
  writeJson(path.join(REPO_OPS, 'SAN-2026-005.json'), sanitation);
  writeJson(path.join(REPO_OPS, 'LEGACY-INV-2026-005.json'), inventory);

  if (!DRY) {
    writeJson(path.join(OPS_DIR, 'SAN-2026-005.json'), sanitation);
    writeJson(path.join(OPS_DIR, 'LEGACY-INV-2026-005.json'), inventory);
  } else {
    console.log(`[dry-run] would also write ${path.join(OPS_DIR, 'SAN-2026-005.json')}`);
  }

  console.log(JSON.stringify({
    dry_run: DRY,
    operation_id: 'SAN-2026-005',
    files: sanitation.files,
    by_class: Object.fromEntries(
      Object.entries(byClass).map(([k, v]) => [
        k,
        { ...v, gb: Number((v.bytes / 1e9).toFixed(3)) },
      ]),
    ),
    roots: inventory.summary.roots,
    next: inventory.next_operations_suggested.map((n) => n.id),
  }, null, 2));
}

main();
