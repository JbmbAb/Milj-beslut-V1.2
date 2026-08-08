/**
 * SAN-2026-007 — HITL inventory for remaining _migration_from_D unknowns.
 * Produces CLASSIFY artifact + decision matrix. No moves unless --execute
 * with explicit --approve=<bucket_id,...> or --approve-all-recommended.
 *
 *   node scripts/ops/sanitation-hitl-migration-unknowns.mjs
 *   node scripts/ops/sanitation-hitl-migration-unknowns.mjs --execute --approve-all-recommended
 *   node scripts/ops/sanitation-hitl-migration-unknowns.mjs --execute --approve=legal,c_geo_pdf
 */
import fs from 'fs';
import path from 'path';

const DRY = !process.argv.includes('--execute');
const APPROVE_ALL = process.argv.includes('--approve-all-recommended');
const approveArg = process.argv.find((a) => a.startsWith('--approve='));
const APPROVE = new Set(
  APPROVE_ALL
    ? []
    : approveArg
      ? approveArg
          .slice('--approve='.length)
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : [],
);

const MASTER =
  process.env.GEO_MASTER_ARCHIVE ??
  'H:\\Delade enheter\\Miljöbeslut\\GEO_Master_Archive';
const ROOT = path.join(MASTER, 'Documents', 'Sources', '_migration_from_D', '2026-06-19');
const DATA_MIG = path.join(MASTER, 'Data', '_migration_from_D', '2026-06-19');
const QROOT = path.join(MASTER, '_quarantine', 'SAN-2026-007-hitl');
const OPS_DIR = path.join(MASTER, '_ops', 'sanitation');
const REPO_OPS = path.join(process.cwd(), 'storage', 'manifests', 'sanitation');

/**
 * @typedef {{
 *   id: string,
 *   label: string,
 *   sources: string[],
 *   recommendation: 'promote_legal' | 'promote_documents' | 'promote_nv_docs' | 'quarantine_obsolete' | 'keep_review',
 *   target: string,
 *   confidence: 'high' | 'medium' | 'low',
 *   rationale: string,
 * }} Bucket
 */

/** @type {Bucket[]} */
const BUCKETS = [
  {
    id: 'legal',
    label: 'Legal corpora (legal/)',
    sources: ['legal'],
    recommendation: 'promote_legal',
    target: 'Documents/Sources/Legal/from_migration_2026-06-19',
    confidence: 'high',
    rationale:
      'Court/legal scrape corpora — belongs under Documents/Sources/Legal, not Data geodata.',
  },
  {
    id: 'rattspraxis',
    label: 'Rättspraxis corpora',
    sources: [
      'rattspraxis',
      'rattspraxis-miljo',
      'rattspraxis-mark-miljo-split',
      'D_ingest_arkiv/rattspraxis',
      'D_ingest_arkiv/rattspraxis-miljo',
      'D_ingest_arkiv/rattspraxis-mark-miljo-split',
    ],
    recommendation: 'promote_legal',
    target: 'Documents/Sources/Legal/rattspraxis_from_migration_2026-06-19',
    confidence: 'high',
    rationale: 'Rättspraxis / MMD corpora — Legal source tree.',
  },
  {
    id: 'c_geo_pdf',
    label: 'C_GEO_PDF',
    sources: ['C_GEO_PDF'],
    recommendation: 'promote_documents',
    target: 'Documents/Sources/PDF/C_GEO_PDF_from_migration_2026-06-19',
    confidence: 'medium',
    rationale:
      'Mixed geo-related PDFs — Documents/Sources/PDF pending further domain split; not PostGIS harvest.',
  },
  {
    id: 'naturvardsverket',
    label: 'NV broschyrer / pages under migration',
    sources: ['naturvardsverket', 'D_ingest_arkiv/naturvardsverket'],
    recommendation: 'promote_nv_docs',
    target: 'Documents/Sources/Naturvardsverket/from_migration_2026-06-19',
    confidence: 'high',
    rationale: 'Brochure/pages — documents, not Data/Naturvardsverket geodata.',
  },
  {
    id: 'd_ingest_leftover',
    label: 'Remaining D_ingest_arkiv (non-rattspraxis/NV)',
    sources: ['D_ingest_arkiv'],
    recommendation: 'keep_review',
    target: 'Documents/Sources/_migration_from_D/2026-06-19/D_ingest_arkiv',
    confidence: 'low',
    rationale:
      'Mixed ingest leftovers (domstol, boverket, corpora, pages). Split further before promote/quarantine.',
  },
];

function walkFiles(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const fp = path.join(dir, e.name);
    if (e.isDirectory()) walkFiles(fp, out);
    else out.push(fp);
  }
  return out;
}

function dirStats(abs) {
  if (!fs.existsSync(abs)) return { exists: false, files: 0, bytes: 0, top: [] };
  const files = walkFiles(abs);
  let bytes = 0;
  for (const f of files) {
    try {
      bytes += fs.statSync(f).size;
    } catch {
      // ignore
    }
  }
  const top = fs
    .readdirSync(abs, { withFileTypes: true })
    .map((e) => e.name)
    .slice(0, 30);
  return { exists: true, files: files.length, bytes, top };
}

function writeJson(filePath, obj) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(obj, null, 2)}\n`, 'utf8');
}

function writeDual(name, obj) {
  writeJson(path.join(OPS_DIR, name), obj);
  writeJson(path.join(REPO_OPS, name), obj);
}

function moveDir(srcAbs, destAbs) {
  fs.mkdirSync(path.dirname(destAbs), { recursive: true });
  if (fs.existsSync(destAbs)) {
    throw new Error(`destination exists: ${destAbs}`);
  }
  fs.renameSync(srcAbs, destAbs);
}

function main() {
  const dataMig = dirStats(DATA_MIG);
  const docsRoot = dirStats(ROOT);
  const topLevel = fs.existsSync(ROOT)
    ? fs.readdirSync(ROOT, { withFileTypes: true }).map((e) => ({
        name: e.name,
        type: e.isDirectory() ? 'dir' : 'file',
        ...dirStats(path.join(ROOT, e.name)),
      }))
    : [];

  /** @type {object[]} */
  const decisions = [];

  for (const bucket of BUCKETS) {
    /** @type {object[]} */
    const members = [];
    let files = 0;
    let bytes = 0;
    for (const rel of bucket.sources) {
      const abs = path.join(ROOT, rel);
      const st = dirStats(abs);
      if (!st.exists) continue;
      // For D_ingest_arkiv aggregate bucket, skip subpaths already covered by other buckets
      if (bucket.id === 'd_ingest_leftover') {
        // count only children not claimed elsewhere
        const children = fs.readdirSync(abs, { withFileTypes: true });
        const claimed = new Set(
          BUCKETS.filter((b) => b.id !== 'd_ingest_leftover')
            .flatMap((b) => b.sources)
            .filter((s) => s.startsWith('D_ingest_arkiv/'))
            .map((s) => s.slice('D_ingest_arkiv/'.length)),
        );
        for (const ch of children) {
          if (claimed.has(ch.name)) continue;
          const cst = dirStats(path.join(abs, ch.name));
          members.push({
            rel: `Documents/Sources/_migration_from_D/2026-06-19/D_ingest_arkiv/${ch.name}`,
            ...cst,
          });
          files += cst.files;
          bytes += cst.bytes;
        }
        continue;
      }
      members.push({
        rel: `Documents/Sources/_migration_from_D/2026-06-19/${rel}`,
        ...st,
      });
      files += st.files;
      bytes += st.bytes;
    }

    const recommended = bucket.recommendation !== 'keep_review';
    const approved =
      APPROVE_ALL && recommended
        ? true
        : APPROVE.has(bucket.id);

    decisions.push({
      ...bucket,
      files,
      bytes,
      mb: Math.round(bytes / 1e6),
      members,
      approved_for_execute: approved,
      status: files === 0 ? 'absent' : DRY ? (approved ? 'planned' : 'awaiting_hitl') : approved ? 'ready' : 'awaiting_hitl',
    });
  }

  /** @type {object[]} */
  const moveResults = [];
  let opSeq = 0;

  if (!DRY) {
    for (const d of decisions) {
      if (!d.approved_for_execute || d.files === 0 || d.recommendation === 'keep_review') continue;

      for (const member of d.members) {
        if (!member.exists || member.files === 0) continue;
        const srcAbs = path.join(MASTER, member.rel.replace(/\//g, path.sep));
        if (!fs.existsSync(srcAbs)) continue;

        const leaf = path.basename(srcAbs);
        const destRel = `${d.target}/${leaf}`;
        const destAbs = path.join(MASTER, destRel.replace(/\//g, path.sep));

        opSeq += 1;
        const opId = `SAN-2026-007-${String(opSeq).padStart(3, '0')}`;
        try {
          moveDir(srcAbs, destAbs);
          const artifact = {
            schema_version: '1.0',
            operation_id: opId,
            action: 'MOVE',
            reason: 'legacy_migration',
            source: member.rel,
            target: destRel,
            provider: '_migration_from_D',
            dataset: d.id,
            files: member.files,
            old_hashes: [],
            new_hashes: [],
            classification: d.recommendation.startsWith('promote') ? 'canonical' : 'obsolete',
            approved_by: 'JbmbAb',
            created_at: new Date().toISOString(),
            closed_at: new Date().toISOString(),
            status: 'completed',
            notes: d.rationale,
            evidence: { bucket: d.id, recommendation: d.recommendation, confidence: d.confidence },
          };
          writeDual(`${opId}.json`, artifact);
          moveResults.push({ operation_id: opId, status: 'completed', ...artifact });
        } catch (err) {
          moveResults.push({
            operation_id: opId,
            status: 'error',
            source: member.rel,
            target: destRel,
            note: err.message,
          });
        }
      }
    }
  }

  const batch = {
    schema_version: '1.0',
    operation_id: 'SAN-2026-007',
    action: 'CLASSIFY',
    reason: 'legacy_migration',
    source: 'Documents/Sources/_migration_from_D/2026-06-19 (unknown leftovers)',
    provider: '_migration_from_D',
    approved_by: 'JbmbAb',
    created_at: new Date().toISOString(),
    closed_at: DRY || moveResults.length === 0 ? undefined : new Date().toISOString(),
    status: DRY
      ? 'planned'
      : moveResults.some((r) => r.status === 'error')
        ? 'in_progress'
        : decisions.some((d) => d.status === 'awaiting_hitl' && d.files > 0)
          ? 'in_progress'
          : 'completed',
    notes:
      'HITL package for remaining migration unknowns. Recommended promotes: legal/rattspraxis → Documents/Sources/Legal; NV docs → Documents/Sources/Naturvardsverket; C_GEO_PDF → Documents/Sources/PDF. D_ingest leftovers stay until further split.',
    evidence: {
      dry_run: DRY,
      approve_all_recommended: APPROVE_ALL,
      approve: [...APPROVE],
      data_migration_empty: dataMig.files === 0,
      data_migration: dataMig,
      docs_root: { files: docsRoot.files, bytes: docsRoot.bytes, mb: Math.round(docsRoot.bytes / 1e6) },
      top_level: topLevel.map((t) => ({
        name: t.name,
        type: t.type,
        files: t.files,
        mb: Math.round((t.bytes || 0) / 1e6),
      })),
      decisions,
      move_results: moveResults,
    },
  };

  writeDual('SAN-2026-007.json', batch);
  writeDual('SAN-2026-007-hitl-matrix.json', {
    generated_at: new Date().toISOString(),
    how_to_approve:
      'node scripts/ops/sanitation-hitl-migration-unknowns.mjs --execute --approve-all-recommended',
    or: 'node scripts/ops/sanitation-hitl-migration-unknowns.mjs --execute --approve=legal,rattspraxis,naturvardsverket,c_geo_pdf',
    decisions: decisions.map((d) => ({
      id: d.id,
      label: d.label,
      mb: d.mb,
      files: d.files,
      recommendation: d.recommendation,
      target: d.target,
      confidence: d.confidence,
      rationale: d.rationale,
      status: d.status,
    })),
  });

  console.log(
    JSON.stringify(
      {
        dry_run: DRY,
        docs_mb: Math.round(docsRoot.bytes / 1e6),
        docs_files: docsRoot.files,
        data_migration_empty: dataMig.files === 0,
        decisions: decisions.map((d) => ({
          id: d.id,
          files: d.files,
          mb: d.mb,
          recommendation: d.recommendation,
          confidence: d.confidence,
          status: d.status,
          target: d.target,
        })),
        moved: moveResults.length,
      },
      null,
      2,
    ),
  );
}

main();
