/**
 * Read-only dedupe analysis: compare leaf folder names between
 * GEO_Master_Archive/Data and _review/<unknown>/.
 *
 * Output: _manifests/dedupe-report.json (no files moved)
 *
 * Run: node scripts/db/archive-dedupe-review.mjs
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

const MASTER = 'H:\\Delade enheter\\Miljöbeslut\\GEO_Master_Archive';
const DATA_ROOT = path.join(MASTER, 'Data');
const MANIFESTS = path.join(MASTER, '_manifests');
const REPORT_PATH = path.join(MANIFESTS, 'dedupe-report.json');

const SAMPLE_HASH_COUNT = 3;
const SAMPLE_HASH_MAX_BYTES = 64 * 1024 * 1024;

function resolveReviewRoot() {
  const reviewBase = path.join(MASTER, '_review');
  const entries = fs.readdirSync(reviewBase, { withFileTypes: true });
  const dir = entries.find((e) => e.isDirectory());
  if (!dir) throw new Error(`No subdirectory under ${reviewBase}`);
  return path.join(reviewBase, dir.name);
}

function walkFiles(rootDir) {
  const files = [];
  const stack = [rootDir];
  while (stack.length) {
    const current = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.isFile()) {
        try {
          const stat = fs.statSync(full);
          files.push({ rel: path.relative(rootDir, full), full, size: stat.size, mtime: stat.mtime.toISOString() });
        } catch {
          // skip unreadable
        }
      }
    }
  }
  return files;
}

function folderStats(rootDir) {
  const files = walkFiles(rootDir);
  const totalBytes = files.reduce((sum, f) => sum + f.size, 0);
  return { fileCount: files.length, totalBytes, files };
}

function hashFilePartial(filePath, maxBytes) {
  return new Promise((resolve) => {
    const hash = crypto.createHash('sha256');
    let stream;
    try {
      stream = fs.createReadStream(filePath, { highWaterMark: 1024 * 1024 });
    } catch {
      resolve(null);
      return;
    }
    let bytes = 0;
    stream.on('data', (chunk) => {
      bytes += chunk.length;
      hash.update(chunk);
      if (bytes >= maxBytes) stream.destroy();
    });
    stream.on('close', () => resolve(bytes > 0 ? hash.digest('hex') : null));
    stream.on('error', (err) => {
      if (err.code === 'ERR_STREAM_PREMATURE_CLOSE' && bytes > 0) resolve(hash.digest('hex'));
      else resolve(null);
    });
  });
}

async function sampleHashes(files) {
  const sorted = [...files].sort((a, b) => b.size - a.size).slice(0, SAMPLE_HASH_COUNT);
  const samples = [];
  for (const f of sorted) {
    const hash = await hashFilePartial(f.full, SAMPLE_HASH_MAX_BYTES);
    samples.push({
      relativePath: f.rel,
      sizeBytes: f.size,
      sha256_partial: hash,
      hashScope: f.size <= SAMPLE_HASH_MAX_BYTES ? 'full_or_partial' : `first_${SAMPLE_HASH_MAX_BYTES}_bytes`,
    });
  }
  return samples;
}

function buildDataIndex() {
  /** @type {Map<string, { providerPath: string, absPath: string }[]>} */
  const index = new Map();
  const providers = fs.readdirSync(DATA_ROOT, { withFileTypes: true }).filter((e) => e.isDirectory());
  for (const provider of providers) {
    const providerPath = path.join(DATA_ROOT, provider.name);
    const stack = [{ abs: providerPath, rel: provider.name }];
    while (stack.length) {
      const { abs, rel } = stack.pop();
      const entries = fs.readdirSync(abs, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const childAbs = path.join(abs, entry.name);
        const childRel = `${rel}/${entry.name}`;
        const key = entry.name.toLowerCase();
        if (!index.has(key)) index.set(key, []);
        index.get(key).push({ providerPath: childRel, absPath: childAbs });
        stack.push({ abs: childAbs, rel: childRel });
      }
    }
  }
  return index;
}

function classifyReviewFolder(name) {
  const n = name.toLowerCase();
  if (/^(byggnad|belagenhetsadress|fastighets|diken|objekt_|topo)/.test(n)) {
    return { suggestedProvider: 'Lantmateriet', suggestedDataset: name, tier: 2 };
  }
  if (/^nmd|tradslag|basskikt|skikt|preciserad_kskog/.test(n)) {
    return { suggestedProvider: 'Naturvardsverket', suggestedDataset: name, tier: 2 };
  }
  if (/^inspiremsb|svaro|varo|pfra|olyckor|stabilitet/.test(n)) {
    return { suggestedProvider: 'MSB', suggestedDataset: name, tier: 2 };
  }
  if (/^(berg|jord|grund|brunn)/.test(n)) {
    return { suggestedProvider: 'SGU', suggestedDataset: name, tier: 2 };
  }
  if (/historik|malung|habo|krokom|are-|^\d{4}/.test(n)) {
    return { suggestedProvider: 'Lantmateriet', suggestedDataset: name, tier: 3 };
  }
  return { suggestedProvider: null, suggestedDataset: name, tier: null };
}

async function comparePair(reviewName, reviewAbs, dataMatch) {
  const reviewStats = folderStats(reviewAbs);
  const dataCandidates = [];
  for (const match of dataMatch) {
    if (!fs.existsSync(match.absPath)) continue;
    const stats = folderStats(match.absPath);
    dataCandidates.push({
      dataPath: match.providerPath,
      dataAbsPath: match.absPath,
      ...stats,
    });
  }

  let best = null;
  for (const candidate of dataCandidates) {
    const sizeMatch = candidate.totalBytes === reviewStats.totalBytes;
    const countMatch = candidate.fileCount === reviewStats.fileCount;
    let sampleMatch = false;
    let reviewSamples = [];
    let dataSamples = [];

    if (sizeMatch && countMatch && reviewStats.fileCount > 0) {
      reviewSamples = await sampleHashes(reviewStats.files);
      dataSamples = await sampleHashes(candidate.files);
      sampleMatch =
        reviewSamples.length === dataSamples.length &&
        reviewSamples.length > 0 &&
        reviewSamples.every((rs, i) => {
          const ds = dataSamples[i];
          return (
            rs.relativePath === ds.relativePath &&
            rs.sha256_partial != null &&
            rs.sha256_partial === ds.sha256_partial
          );
        });
    }

    const verdict =
      sampleMatch ? 'verified_duplicate'
      : sizeMatch && countMatch ? 'likely_duplicate_needs_full_hash'
      : sizeMatch ? 'same_size_different_files'
      : 'overlap_name_only';

    const entry = {
      dataPath: candidate.dataPath,
      dataAbsPath: candidate.dataAbsPath,
      dataFileCount: candidate.fileCount,
      dataBytes: candidate.totalBytes,
      sizeMatch,
      countMatch,
      sampleMatch,
      verdict,
      reviewSamples,
      dataSamples,
    };
    if (!best || rankVerdict(entry.verdict) > rankVerdict(best.verdict)) best = entry;
  }

  const classification = classifyReviewFolder(reviewName);
  return {
    reviewFolder: reviewName,
    reviewAbsPath: reviewAbs,
    reviewFileCount: reviewStats.fileCount,
    reviewBytes: reviewStats.totalBytes,
    reviewSizeGB: Number((reviewStats.totalBytes / 1024 ** 3).toFixed(2)),
    dataCandidates: dataCandidates.map(({ files, ...rest }) => rest),
    bestMatch: best,
    recommendedAction:
      best?.verdict === 'verified_duplicate' ? 'move_to_quarantine_after_approval'
      : best?.verdict === 'likely_duplicate_needs_full_hash' ? 'full_hash_then_quarantine'
      : classification.tier === 2 ? 'promote_to_data_after_manifest'
      : 'manual_review',
    ...classification,
  };
}

function rankVerdict(v) {
  switch (v) {
    case 'verified_duplicate': return 4;
    case 'likely_duplicate_needs_full_hash': return 3;
    case 'same_size_different_files': return 2;
    case 'overlap_name_only': return 1;
    default: return 0;
  }
}

async function main() {
  const startedAt = new Date().toISOString();
  const reviewRoot = resolveReviewRoot();
  const dataIndex = buildDataIndex();

  const reviewFolders = fs
    .readdirSync(reviewRoot, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);

  const overlapping = reviewFolders.filter((name) => dataIndex.has(name.toLowerCase()));
  const comparisons = [];

  for (const name of overlapping.sort()) {
    const reviewAbs = path.join(reviewRoot, name);
    const matches = dataIndex.get(name.toLowerCase()) ?? [];
    process.stdout.write(`Analyzing ${name}...\n`);
    comparisons.push(await comparePair(name, reviewAbs, matches));
  }

  const verified = comparisons.filter((c) => c.bestMatch?.verdict === 'verified_duplicate');
  const likely = comparisons.filter((c) => c.bestMatch?.verdict === 'likely_duplicate_needs_full_hash');
  const promote = comparisons.filter((c) => c.recommendedAction === 'promote_to_data_after_manifest');

  const report = {
    generatedAt: startedAt,
    mode: 'read_only',
    masterArchiveRoot: MASTER,
    reviewRoot,
    dataRoot: DATA_ROOT,
    overlapFolderCount: overlapping.length,
    summary: {
      verifiedDuplicates: verified.length,
      verifiedDuplicateBytes: verified.reduce((s, c) => s + c.reviewBytes, 0),
      verifiedDuplicateGB: Number((verified.reduce((s, c) => s + c.reviewBytes, 0) / 1024 ** 3).toFixed(2)),
      likelyDuplicates: likely.length,
      likelyDuplicateGB: Number((likely.reduce((s, c) => s + c.reviewBytes, 0) / 1024 ** 3).toFixed(2)),
      promoteCandidates: promote.length,
      promoteCandidateGB: Number((promote.reduce((s, c) => s + c.reviewBytes, 0) / 1024 ** 3).toFixed(2)),
    },
    quarantineAlready: [
      {
        folder: 'BERG',
        note: 'Moved manually before this report run',
        quarantinePath: path.join(MASTER, '_quarantine', 'duplicate_verified_2026-06-19', 'SGU_BERG_from_review'),
      },
    ],
    comparisons,
  };

  const localCopy = path.join(process.cwd(), 'storage', 'manifests', 'dedupe-report.json');
  fs.mkdirSync(path.dirname(localCopy), { recursive: true });
  fs.writeFileSync(localCopy, JSON.stringify(report, null, 2), 'utf8');

  try {
    fs.mkdirSync(MANIFESTS, { recursive: true });
    fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), 'utf8');
  } catch (err) {
    console.warn(`Could not write to ${REPORT_PATH}: ${err.message}`);
  }

  console.log(`\nReport written: ${localCopy}`);
  if (fs.existsSync(REPORT_PATH)) console.log(`Drive mirror: ${REPORT_PATH}`);
  console.log(JSON.stringify(report.summary, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
