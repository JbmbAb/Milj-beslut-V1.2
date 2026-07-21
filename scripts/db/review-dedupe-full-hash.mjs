/**
 * Full SHA-256 verification for _review vs Data/ folder pairs flagged as
 * likely_duplicate_needs_full_hash in dedupe-report.json (via rclone on Drive).
 *
 * Run: node scripts/db/review-dedupe-full-hash.mjs
 * Output: storage/manifests/review-dedupe-full-hash.json
 */
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const ROOT = process.cwd();
const DEDUPE = path.join(ROOT, 'storage', 'manifests', 'dedupe-report.json');
const OUT = path.join(ROOT, 'storage', 'manifests', 'review-dedupe-full-hash.json');
const RCLONE_CONFIG = path.join(ROOT, 'storage', 'rclone');
const REVIEW_PROVIDER = 'OkÃ¤nd_Provider';

function rcloneHashsum(remotePath) {
  const args = [
    'run', '--rm',
    '-v', `${RCLONE_CONFIG}:/config/rclone:ro`,
    'rclone/rclone',
    'hashsum', 'SHA256', remotePath,
    '--fast-list',
    '--download',
    '--config', '/config/rclone/rclone.conf',
  ];
  const out = execFileSync('docker', args, {
    encoding: 'utf8',
    maxBuffer: 512 * 1024 * 1024,
  });
  /** @type {{ hash: string, size: number, relPath: string }[]} */
  const rows = [];
  for (const line of out.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const parts = line.trim().split(/\s+/);
    if (parts.length < 2) continue;
    const hash = parts[0].toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(hash)) continue;
    let size = 0;
    let relPath;
    if (parts.length >= 3 && /^\d+$/.test(parts[1])) {
      size = Number(parts[1]);
      relPath = parts.slice(2).join(' ');
    } else {
      relPath = parts.slice(1).join(' ');
    }
    rows.push({ hash, size, relPath: relPath.replace(/\\/g, '/') });
  }
  return rows;
}

function normalizeRel(rel) {
  return rel.replace(/^extracted\//i, '').replace(/\\/g, '/').toLowerCase();
}

function fingerprint(rows) {
  const byNorm = new Map();
  for (const row of rows) {
    const key = normalizeRel(row.relPath);
    if (!byNorm.has(key)) byNorm.set(key, []);
    byNorm.get(key).push(row);
  }
  const hashMultiset = rows.map((r) => r.hash).sort();
  const totalBytes = rows.reduce((s, r) => s + r.size, 0);
  return { fileCount: rows.length, totalBytes, hashMultiset, byNorm };
}

function compareFingerprints(reviewFp, dataFp) {
  const hashMatch =
    reviewFp.hashMultiset.length === dataFp.hashMultiset.length &&
    reviewFp.hashMultiset.every((h, i) => h === dataFp.hashMultiset[i]);

  let pathHashMatch = 0;
  let pathHashMismatch = 0;
  let reviewOnlyPaths = 0;
  let dataOnlyPaths = 0;

  for (const [key, reviewRows] of reviewFp.byNorm) {
    const dataRows = dataFp.byNorm.get(key);
    if (!dataRows) {
      reviewOnlyPaths++;
      continue;
    }
    const reviewHashes = reviewRows.map((r) => r.hash).sort().join(',');
    const dataHashes = dataRows.map((r) => r.hash).sort().join(',');
    if (reviewHashes === dataHashes) pathHashMatch++;
    else pathHashMismatch++;
  }
  for (const key of dataFp.byNorm.keys()) {
    if (!reviewFp.byNorm.has(key)) dataOnlyPaths++;
  }

  let verdict;
  if (hashMatch && reviewFp.fileCount === dataFp.fileCount) {
    verdict = 'verified_duplicate';
  } else if (
    reviewFp.fileCount === dataFp.fileCount &&
    reviewFp.totalBytes === dataFp.totalBytes &&
    pathHashMismatch === 0 &&
    reviewOnlyPaths === 0 &&
    dataOnlyPaths === 0
  ) {
    verdict = 'verified_duplicate_paths_normalized';
  } else if (reviewFp.totalBytes === dataFp.totalBytes && reviewFp.fileCount === dataFp.fileCount) {
    verdict = 'same_size_count_hash_mismatch';
  } else {
    verdict = 'not_duplicate';
  }

  return {
    verdict,
    hashMatch,
    reviewFileCount: reviewFp.fileCount,
    dataFileCount: dataFp.fileCount,
    reviewBytes: reviewFp.totalBytes,
    dataBytes: dataFp.totalBytes,
    pathHashMatch,
    pathHashMismatch,
    reviewOnlyPaths,
    dataOnlyPaths,
  };
}

function main() {
  const dedupe = JSON.parse(fs.readFileSync(DEDUPE, 'utf8'));
  const pairs = dedupe.comparisons.filter(
    (c) => c.bestMatch?.verdict === 'likely_duplicate_needs_full_hash',
  );

  console.log(`Full hash verification for ${pairs.length} likely-duplicate pairs...\n`);

  const results = [];
  let verified = 0;
  let verifiedBytes = 0;

  for (const pair of pairs) {
    const folder = pair.reviewFolder;
    const dataRel = pair.bestMatch.dataPath.replace(/\\/g, '/');
    const reviewRemote = `drive:GEO_Master_Archive/_review/${REVIEW_PROVIDER}/${folder}`;
    const dataRemote = `drive:GEO_Master_Archive/Data/${dataRel}`;

    console.log(`→ ${folder}`);
    console.log(`  review: ${reviewRemote}`);
    console.log(`  data:   ${dataRemote}`);

    let reviewRows;
    let dataRows;
    try {
      console.log('  hashing review...');
      reviewRows = rcloneHashsum(reviewRemote);
      console.log(`  review: ${reviewRows.length} files`);
      console.log('  hashing data...');
      dataRows = rcloneHashsum(dataRemote);
      console.log(`  data: ${dataRows.length} files`);
    } catch (err) {
      console.warn(`  ERROR: ${err.message}`);
      results.push({
        reviewFolder: folder,
        dataPath: dataRel,
        reviewRemote,
        dataRemote,
        error: err.message,
        verdict: 'hash_failed',
      });
      continue;
    }

    const comparison = compareFingerprints(fingerprint(reviewRows), fingerprint(dataRows));
    console.log(`  verdict: ${comparison.verdict}\n`);

    if (
      comparison.verdict === 'verified_duplicate' ||
      comparison.verdict === 'verified_duplicate_paths_normalized'
    ) {
      verified++;
      verifiedBytes += pair.reviewBytes ?? comparison.reviewBytes;
    }

    results.push({
      reviewFolder: folder,
      dataPath: dataRel,
      reviewRemote,
      dataRemote,
      recommendedAction:
        comparison.verdict === 'verified_duplicate' ||
        comparison.verdict === 'verified_duplicate_paths_normalized'
          ? 'move_to_quarantine_after_approval'
          : comparison.verdict === 'same_size_count_hash_mismatch'
            ? 'manual_review_content_differs'
            : 'keep_in_review_or_promote',
      ...comparison,
    });
  }

  const report = {
    generatedAt: new Date().toISOString(),
    mode: 'read_only_rclone_sha256',
    sourceDedupeReport: DEDUPE,
    pairCount: pairs.length,
    summary: {
      verifiedDuplicates: verified,
      verifiedDuplicateBytes: verifiedBytes,
      verifiedDuplicateGB: Number((verifiedBytes / 1024 ** 3).toFixed(2)),
      hashFailed: results.filter((r) => r.verdict === 'hash_failed').length,
      notDuplicate: results.filter((r) => r.verdict === 'not_duplicate').length,
      contentDiffers: results.filter((r) => r.verdict === 'same_size_count_hash_mismatch').length,
    },
    results,
  };

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2), 'utf8');
  console.log(`Report: ${OUT}`);
  console.log(JSON.stringify(report.summary, null, 2));
}

main();
