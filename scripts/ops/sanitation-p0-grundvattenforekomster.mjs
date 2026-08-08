/**
 * P0 repair/replay: SGU Grundvattenforekomster checksum mismatch (truncated artifact).
 *
 * Cycle: freeze corrupt → document → promote self-consistent canonical → verify → close.
 *
 *   node scripts/ops/sanitation-p0-grundvattenforekomster.mjs
 *   node scripts/ops/sanitation-p0-grundvattenforekomster.mjs --execute
 */
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const DRY = !process.argv.includes('--execute');
const MASTER = process.env.GEO_MASTER_ARCHIVE
  ?? 'H:\\Delade enheter\\Miljöbeslut\\GEO_Master_Archive';
const DATASET_ROOT = path.join(MASTER, 'Data', 'SGU', 'Grundvattenforekomster');
const OPS_DIR = path.join(MASTER, '_ops', 'sanitation');
const REPO_OPS = path.join(process.cwd(), 'storage', 'manifests', 'sanitation');

const INCIDENT_VERSION = '2026-06-28_111929';
const CANONICAL_VERSION = '2026-06-28_112145';
const INCOMPLETE_VERSION = '2026-06-28_111425';

const EXPECTED_BAD_MANIFEST_SHA = 'adc65bcdc46a8811730be859f4537d277e6458f2605633e8f423c7ef96912636';
const EXPECTED_BAD_ACTUAL_SHA = 'aa703abeb8a5599fadf4a2275ec98ab2e17b383f373342fe189d6aec4547406d';

function sha256File(filePath) {
  const psPath = filePath.replace(/'/g, "''");
  const out = execFileSync(
    'pwsh',
    ['-NoProfile', '-Command', `(Get-FileHash -Algorithm SHA256 -LiteralPath '${psPath}').Hash`],
    { encoding: 'utf8', maxBuffer: 1024 * 1024 },
  );
  const hash = out.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(hash)) throw new Error(`bad hash for ${filePath}: ${hash}`);
  return hash;
}

function readJson(fp) {
  return JSON.parse(fs.readFileSync(fp, 'utf8'));
}

function writeJson(fp, obj) {
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  fs.writeFileSync(fp, `${JSON.stringify(obj, null, 2)}\n`, 'utf8');
}

function versionPaths(version) {
  const versionDir = path.join(DATASET_ROOT, version);
  const rawDir = path.join(versionDir, 'raw');
  const gpkg = path.join(rawDir, 'grundvattenforekomster.gpkg');
  const manifest = path.join(rawDir, 'manifest.json');
  return { versionDir, rawDir, gpkg, manifest };
}

function buildSanitationArtifact(input) {
  return {
    schema_version: '1.0',
    operation_id: input.operation_id,
    action: input.action,
    reason: input.reason,
    source: input.source,
    target: input.target,
    provider: 'SGU',
    dataset: 'Grundvattenforekomster',
    files: input.files,
    old_hashes: input.old_hashes ?? [],
    new_hashes: input.new_hashes ?? [],
    file_refs: input.file_refs,
    related_operation_ids: input.related_operation_ids,
    approved_by: input.approved_by ?? 'governance',
    created_at: input.created_at ?? new Date().toISOString(),
    closed_at: input.closed_at,
    status: input.status ?? 'planned',
    notes: input.notes,
    evidence: input.evidence,
  };
}

function persistArtifact(artifact) {
  const name = `${artifact.operation_id}.json`;
  const archivePath = path.join(OPS_DIR, name);
  const repoPath = path.join(REPO_OPS, name);
  if (DRY) {
    console.log(`[dry-run] would write ${archivePath}`);
    console.log(`[dry-run] would write ${repoPath}`);
    writeJson(repoPath, artifact);
    return { archivePath, repoPath };
  }
  writeJson(archivePath, artifact);
  writeJson(repoPath, artifact);
  return { archivePath, repoPath };
}

function freezeCorrupt() {
  const p = versionPaths(INCIDENT_VERSION);
  if (!fs.existsSync(p.manifest)) throw new Error(`missing incident manifest: ${p.manifest}`);
  const actual = fs.existsSync(p.gpkg) ? sha256File(p.gpkg) : null;
  const size = fs.existsSync(p.gpkg) ? fs.statSync(p.gpkg).size : 0;
  const man = readJson(p.manifest);
  const claimed = String(man.files_detail?.[0]?.sha256 ?? '').toLowerCase();

  if (actual !== EXPECTED_BAD_ACTUAL_SHA) {
    console.warn(`WARN: actual hash changed since audit: ${actual}`);
  }
  if (claimed !== EXPECTED_BAD_MANIFEST_SHA) {
    console.warn(`WARN: manifest claimed hash changed since audit: ${claimed}`);
  }

  const frozen = {
    ...man,
    qa_status: 'failed',
    qa_at: new Date().toISOString(),
    qa_error:
      `SAN-2026-001: checksum_mismatch + truncated_artifact; `
      + `claimed_sha256=${claimed || 'missing'} actual_sha256=${actual || 'missing'} `
      + `size_bytes=${size} (expected ~78299136)`,
    invalidated_by: `Data/SGU/Grundvattenforekomster/${CANONICAL_VERSION}`,
  };

  const op = buildSanitationArtifact({
    operation_id: 'SAN-2026-001',
    action: 'FREEZE',
    reason: 'checksum_mismatch',
    source: `Data/SGU/Grundvattenforekomster/${INCIDENT_VERSION}`,
    target: `Data/SGU/Grundvattenforekomster/${INCIDENT_VERSION} (frozen in place)`,
    files: 1,
    old_hashes: [claimed, actual].filter(Boolean),
    new_hashes: [],
    file_refs: [
      {
        path: `Data/SGU/Grundvattenforekomster/${INCIDENT_VERSION}/raw/grundvattenforekomster.gpkg`,
        sha256: actual ?? undefined,
        size_bytes: size || undefined,
      },
    ],
    status: DRY ? 'planned' : 'completed',
    closed_at: DRY ? undefined : new Date().toISOString(),
    notes:
      'Incident from rclone hash audit 2026-08-06. Artifact truncated (~27MB vs ~78MB). '
      + 'Frozen; not deleted. Canonical promotion in SAN-2026-002.',
    evidence: {
      audit_report: 'storage/manifests/rclone-sgu-hash-compare.json',
      claimed_sha256: claimed,
      actual_sha256: actual,
      claimed_size_bytes: man.files_detail?.[0]?.size_bytes ?? man.total_bytes,
      actual_size_bytes: size,
    },
    related_operation_ids: ['SAN-2026-002', 'SAN-2026-003'],
  });

  if (!DRY) writeJson(p.manifest, frozen);
  else console.log('[dry-run] would freeze manifest', p.manifest);

  return { op, actual, claimed, size };
}

function freezeIncomplete() {
  const p = versionPaths(INCOMPLETE_VERSION);
  if (!fs.existsSync(p.versionDir)) {
    console.log(`skip incomplete freeze — missing ${INCOMPLETE_VERSION}`);
    return null;
  }
  const manPath = p.manifest;
  const man = fs.existsSync(manPath)
    ? readJson(manPath)
    : {
        schema_version: '2.0',
        provider: 'SGU',
        dataset: 'Grundvattenforekomster',
        version: '2026-06-28',
        total_bytes: 0,
        files: [],
        content_bundle_sha256: '',
        provenance: 'incomplete_harvest',
        qa_status: 'pending',
      };

  const frozen = {
    ...man,
    qa_status: 'failed',
    qa_at: new Date().toISOString(),
    qa_error: 'SAN-2026-003: incomplete_harvest — gpkg missing on disk',
    invalidated_by: `Data/SGU/Grundvattenforekomster/${CANONICAL_VERSION}`,
  };

  const op = buildSanitationArtifact({
    operation_id: 'SAN-2026-003',
    action: 'FREEZE',
    reason: 'incomplete_harvest',
    source: `Data/SGU/Grundvattenforekomster/${INCOMPLETE_VERSION}`,
    files: 0,
    status: DRY ? 'planned' : 'completed',
    closed_at: DRY ? undefined : new Date().toISOString(),
    notes: 'Harvest folder without gpkg. Frozen; canonical is 2026-06-28_112145.',
    related_operation_ids: ['SAN-2026-001', 'SAN-2026-002'],
  });

  if (!DRY) {
    fs.mkdirSync(p.rawDir, { recursive: true });
    writeJson(manPath, frozen);
  } else {
    console.log('[dry-run] would freeze incomplete', manPath);
  }
  return op;
}

function promoteCanonical() {
  const p = versionPaths(CANONICAL_VERSION);
  if (!fs.existsSync(p.gpkg) || !fs.existsSync(p.manifest)) {
    throw new Error(`canonical version missing files under ${p.rawDir}`);
  }
  const actual = sha256File(p.gpkg);
  const man = readJson(p.manifest);
  const claimed = String(man.files_detail?.[0]?.sha256 ?? '').toLowerCase();
  if (actual !== claimed) {
    throw new Error(
      `canonical self-check failed: actual=${actual} claimed=${claimed}. Abort promote; run REHARVEST.`,
    );
  }

  const promoted = {
    ...man,
    qa_status: 'passed',
    qa_at: new Date().toISOString(),
    qa_error: undefined,
    supersedes: `Data/SGU/Grundvattenforekomster/${INCIDENT_VERSION}`,
  };
  delete promoted.qa_error;

  const op = buildSanitationArtifact({
    operation_id: 'SAN-2026-002',
    action: 'PROMOTE',
    reason: 'governance',
    source: `Data/SGU/Grundvattenforekomster/${CANONICAL_VERSION}`,
    target: 'canonical',
    files: 1,
    old_hashes: [],
    new_hashes: [actual],
    file_refs: [
      {
        path: `Data/SGU/Grundvattenforekomster/${CANONICAL_VERSION}/raw/grundvattenforekomster.gpkg`,
        sha256: actual,
        size_bytes: fs.statSync(p.gpkg).size,
      },
    ],
    status: DRY ? 'planned' : 'completed',
    closed_at: DRY ? undefined : new Date().toISOString(),
    notes:
      'Self-consistent newest full-size artifact (~78MB). files_detail SHA-256 verified. '
      + 'Marked qa_status=passed. PostGIS re-import not required unless table empty/corrupt.',
    evidence: {
      verified_sha256: actual,
      size_bytes: fs.statSync(p.gpkg).size,
      principle: 'Source Artifact → Hash Verification → Canonical Dataset',
    },
    related_operation_ids: ['SAN-2026-001', 'SAN-2026-003'],
  });

  if (!DRY) writeJson(p.manifest, promoted);
  else console.log('[dry-run] would promote', p.manifest);

  return { op, actual };
}

function writeIncidentBundle(parts) {
  const bundle = {
    incident_id: 'INC-SGU-GVF-2026-08-06',
    title: 'Grundvattenforekomster checksum mismatch (truncated)',
    principle: ['Source Artifact', 'Hash Verification', 'Canonical Dataset'],
    status: DRY ? 'planned' : 'closed',
    created_at: new Date().toISOString(),
    closed_at: DRY ? null : new Date().toISOString(),
    operations: parts.map((p) => p.operation_id),
    summary:
      'Version 2026-06-28_111929 truncated (~27MB) while manifest claimed ~78MB/adc65bcd…; '
      + 'actual aa703abe…. Frozen. Canonical promoted: 2026-06-28_112145 (self-verified).',
  };
  const archivePath = path.join(OPS_DIR, `${bundle.incident_id}.json`);
  const repoPath = path.join(REPO_OPS, `${bundle.incident_id}.json`);
  if (DRY) {
    writeJson(repoPath, bundle);
    console.log(`[dry-run] incident bundle → ${repoPath}`);
  } else {
    writeJson(archivePath, bundle);
    writeJson(repoPath, bundle);
  }
  return bundle;
}

function main() {
  console.log(DRY ? 'DRY-RUN (pass --execute to apply)' : 'EXECUTE');
  console.log(`Dataset root: ${DATASET_ROOT}`);

  const freeze = freezeCorrupt();
  persistArtifact(freeze.op);
  const incomplete = freezeIncomplete();
  if (incomplete) persistArtifact(incomplete);
  const promote = promoteCanonical();
  persistArtifact(promote.op);

  const bundle = writeIncidentBundle([
    freeze.op,
    promote.op,
    ...(incomplete ? [incomplete] : []),
  ]);

  console.log(JSON.stringify({
    dry_run: DRY,
    incident: bundle.incident_id,
    freeze: {
      version: INCIDENT_VERSION,
      claimed: freeze.claimed,
      actual: freeze.actual,
      size: freeze.size,
    },
    canonical: {
      version: CANONICAL_VERSION,
      sha256: promote.actual,
      qa_status: 'passed',
    },
    artifacts: ['SAN-2026-001', 'SAN-2026-002', 'SAN-2026-003'],
  }, null, 2));
}

main();
