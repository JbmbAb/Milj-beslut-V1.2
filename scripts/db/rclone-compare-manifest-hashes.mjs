/**
 * Compare rclone hashsum SHA256 output against downloaded manifest files_detail.
 *
 *   node scripts/db/rclone-compare-manifest-hashes.mjs \
 *     --hashsum=storage/manifests/rclone-hashsum-sgu.txt \
 *     --manifests=storage/manifests/rclone-manifests-sgu \
 *     --out=storage/manifests/rclone-sgu-hash-compare.json
 */
import fs from 'fs';
import path from 'path';

function arg(name, fallback) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

const hashFile = arg('hashsum', 'storage/manifests/rclone-hashsum-sgu.txt');
const manifestRoot = arg('manifests', 'storage/manifests/rclone-manifests-sgu');
const outJson = arg('out', 'storage/manifests/rclone-sgu-hash-compare.json');

/** @type {Map<string, string>} */
const hashMap = new Map();
for (const line of fs.readFileSync(hashFile, 'utf8').split(/\r?\n/)) {
  if (!line.trim()) continue;
  const m = line.match(/^([0-9a-f]{64})\s+(.*)$/i);
  if (!m) continue;
  const rel = m[2].replace(/\\/g, '/');
  hashMap.set(rel.toLowerCase(), m[1].toLowerCase());
}

function walkManifests(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const fp = path.join(dir, e.name);
    if (e.isDirectory()) walkManifests(fp, out);
    else if (e.name === 'manifest.json') out.push(fp);
  }
  return out;
}

function lookupHash(versionBase, manRelDir, rel) {
  const base = path.posix.basename(rel);
  const candidates = [
    `${versionBase}/${rel}`,
    `${versionBase}/raw/${rel}`,
    `${manRelDir}/${rel}`,
    `${versionBase}/${base}`,
    `${versionBase}/raw/${base}`,
    rel,
  ].map((c) => c.replace(/\\/g, '/').toLowerCase());

  for (const c of candidates) {
    if (hashMap.has(c)) return hashMap.get(c);
  }

  const dataset = versionBase.split('/')[0]?.toLowerCase() ?? '';
  const needle = `/${base.toLowerCase()}`;
  for (const [k, v] of hashMap) {
    if ((k.endsWith(needle) || k === base.toLowerCase()) && (!dataset || k.includes(dataset))) {
      return v;
    }
  }
  return null;
}

const manifests = walkManifests(manifestRoot);
const mismatch = [];
const missingFile = [];
const checksumMissing = [];
let ok = 0;
let noFilesDetail = 0;
let invalid = 0;

for (const mp of manifests) {
  let man;
  try {
    man = JSON.parse(fs.readFileSync(mp, 'utf8'));
  } catch {
    invalid += 1;
    continue;
  }

  const details = Array.isArray(man.files_detail) ? man.files_detail : [];
  if (!details.length) {
    noFilesDetail += 1;
    continue;
  }

  const manRelDir = path.relative(manifestRoot, path.dirname(mp)).replace(/\\/g, '/');
  const versionBase = manRelDir.replace(/\/raw$/i, '');
  let localOk = true;

  for (const fd of details) {
    const sha = String(fd.sha256 || '').toLowerCase();
    const rel = String(fd.rel_path || fd.name || fd.filename || '').replace(/\\/g, '/');
    if (!rel) {
      missingFile.push({
        manifest: path.relative(manifestRoot, mp),
        file: '(empty name/rel_path/filename)',
        versionBase,
      });
      localOk = false;
      break;
    }
    if (!/^[0-9a-f]{64}$/.test(sha)) {
      checksumMissing.push({ manifest: path.relative(manifestRoot, mp), file: rel });
      localOk = false;
      break;
    }

    const actual = lookupHash(versionBase, manRelDir, rel);
    if (!actual) {
      missingFile.push({
        manifest: path.relative(manifestRoot, mp),
        file: rel,
        versionBase,
      });
      localOk = false;
      break;
    }

    if (actual !== sha) {
      mismatch.push({
        manifest: path.relative(manifestRoot, mp),
        file: rel,
        expected: sha,
        actual,
      });
      localOk = false;
      break;
    }
  }

  if (localOk) ok += 1;
}

const summary = {
  generatedAt: new Date().toISOString(),
  hashFile,
  manifestRoot,
  manifests: manifests.length,
  hashEntries: hashMap.size,
  ok,
  no_files_detail: noFilesDetail,
  checksum_missing: checksumMissing.length,
  missing_file: missingFile.length,
  mismatch: mismatch.length,
  invalid,
  mismatch_samples: mismatch.slice(0, 30),
  missing_file_samples: missingFile.slice(0, 30),
  checksum_missing_samples: checksumMissing.slice(0, 20),
};

fs.mkdirSync(path.dirname(outJson), { recursive: true });
fs.writeFileSync(outJson, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(summary, null, 2));
