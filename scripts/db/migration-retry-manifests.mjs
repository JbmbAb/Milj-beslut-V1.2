/**
 * Retry failed manifest.json uploads after promote/quarantine execute.
 *
 * Usage:
 *   node scripts/db/migration-retry-manifests.mjs
 *   node scripts/db/migration-retry-manifests.mjs --failures=storage/manifests/migration_promote_quarantine_failures.json
 * Resolved failures are archived under storage/manifests/archive/*.RESOLVED.json (not retried by default).
 */
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const ROOT = process.cwd();
const MANIFESTS = path.join(ROOT, 'storage', 'manifests');
const RCLONE_CONFIG = path.join(ROOT, 'storage', 'rclone');
const VERSION = '2026-06-19';

const FAILURES_ARG = process.argv.find((a) => a.startsWith('--failures='));
const MAPPING_ARG = process.argv.find((a) => a.startsWith('--mapping='));
const FAILURES_FILE = FAILURES_ARG
  ? path.resolve(FAILURES_ARG.slice('--failures='.length))
  : path.join(MANIFESTS, 'migration_promote_quarantine_failures.json');
const MAPPING_FILE = MAPPING_ARG
  ? path.resolve(MAPPING_ARG.slice('--mapping='.length))
  : path.join(MANIFESTS, 'mapping_proposal.merged.json');

function buildTargetRemote(kind, provider, dataset, subpath) {
  const base = kind === 'documents'
    ? `drive:GEO_Master_Archive/Documents/Sources/${provider}/${dataset}/${VERSION}/raw`
    : `drive:GEO_Master_Archive/Data/${provider}/${dataset}/${VERSION}/raw`;
  return `${base}/${subpath}`.replace(/\\/g, '/');
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

function manifestRemoteForEntry(entry) {
  const target = resolveTarget(entry);
  const manifestKey = target.includes('/raw/')
    ? target.replace(/\/raw\/.*$/, '')
    : target.replace(/\/[^/]+$/, '');
  return `${manifestKey}/manifest.json`;
}

function writeDatasetManifest(manifestRemote, files, { retries = 3 } = {}) {
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

  let lastErr;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      execFileSync('docker', [
        'run', '--rm',
        '-v', `${RCLONE_CONFIG}:/config/rclone:ro`,
        '-v', `${localTmp}:/tmp/manifest.json:ro`,
        'rclone/rclone',
        'copyto', '/tmp/manifest.json', manifestRemote,
        '--log-level', 'INFO',
      ], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
      return;
    } catch (err) {
      lastErr = err;
      if (attempt < retries) {
        const waitSec = attempt * 10;
        console.warn(`  retry ${attempt}/${retries} in ${waitSec}s: ${manifestRemote}`);
        execFileSync('powershell', ['-Command', `Start-Sleep -Seconds ${waitSec}`], { stdio: 'ignore' });
      }
    }
  }
  throw lastErr;
}

function parseFailedManifestRemotes(failures) {
  return failures
    .map((line) => {
      const m = /^manifest (drive:[^:]+):/.exec(line);
      return m ? m[1] : null;
    })
    .filter(Boolean);
}

function buildManifestGroups(entries) {
  const promote = entries.filter(
    (e) => e.action === 'promote'
      && e.approved
      && (e.status !== 'UNCLASSIFIED' || (e.provider && e.dataset)),
  );
  const groups = new Map();
  for (const e of promote) {
    const manifestRemote = manifestRemoteForEntry(e);
    if (!groups.has(manifestRemote)) groups.set(manifestRemote, []);
    groups.get(manifestRemote).push(e);
  }
  return groups;
}

function main() {
  if (!fs.existsSync(FAILURES_FILE)) {
    throw new Error(`Failures file missing: ${FAILURES_FILE}`);
  }
  if (!fs.existsSync(MAPPING_FILE)) {
    throw new Error(`Mapping file missing: ${MAPPING_FILE}`);
  }

  const { failures = [] } = JSON.parse(fs.readFileSync(FAILURES_FILE, 'utf8'));
  const failedRemotes = [...new Set(parseFailedManifestRemotes(failures))];
  const proposal = JSON.parse(fs.readFileSync(MAPPING_FILE, 'utf8'));
  const groups = buildManifestGroups(proposal.entries ?? []);

  console.log(`Retrying ${failedRemotes.length} manifest uploads...`);
  const stats = { ok: 0, failed: 0, missing: 0 };
  const stillFailed = [];

  for (const manifestRemote of failedRemotes) {
    const files = groups.get(manifestRemote);
    if (!files?.length) {
      stats.missing++;
      stillFailed.push(`${manifestRemote}: no promote entries in mapping`);
      console.warn(`  MISSING mapping: ${manifestRemote}`);
      continue;
    }
    console.log(`  ${files[0].provider}/${files[0].dataset} (${files.length} files)`);
    try {
      writeDatasetManifest(manifestRemote, files);
      stats.ok++;
    } catch (err) {
      stats.failed++;
      stillFailed.push(`${manifestRemote}: ${err.message ?? err}`);
      console.error(`  FAILED: ${manifestRemote}`);
    }
  }

  const outPath = path.join(MANIFESTS, 'migration_manifest_retry_result.json');
  fs.writeFileSync(outPath, JSON.stringify({
    retriedAt: new Date().toISOString(),
    stats,
    stillFailed,
  }, null, 2), 'utf8');

  console.log('Done.', JSON.stringify(stats));
  console.log(`Result: ${outPath}`);
  if (stillFailed.length > 0) process.exitCode = 1;
}

main();
