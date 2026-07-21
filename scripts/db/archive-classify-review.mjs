/**
 * Classify _review leaf folders by name heuristics (tolerant of Okänd_Provider wrapper).
 *
 * Run: node scripts/db/archive-classify-review.mjs
 * Output: _manifests/review-classification.json
 */
import fs from 'fs';
import path from 'path';

const MASTER = 'H:\\Delade enheter\\Miljöbeslut\\GEO_Master_Archive';
const OUT = path.join(MASTER, '_manifests', 'review-classification.json');

function resolveReviewRoot() {
  const reviewBase = path.join(MASTER, '_review');
  const dir = fs.readdirSync(reviewBase, { withFileTypes: true }).find((e) => e.isDirectory());
  if (!dir) throw new Error('No _review subdirectory');
  return path.join(reviewBase, dir.name);
}

function folderBytes(absPath) {
  let total = 0;
  let count = 0;
  const stack = [absPath];
  while (stack.length) {
    const cur = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(cur, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = path.join(cur, e.name);
      if (e.isDirectory()) stack.push(full);
      else {
        try {
          total += fs.statSync(full).size;
          count++;
        } catch {
          // skip
        }
      }
    }
  }
  return { totalBytes: total, fileCount: count };
}

function classify(name) {
  const n = name.toLowerCase();
  if (/^(byggnad|belagenhetsadress|fastighets|diken|objekt_|topo|registerenhet)/.test(n)) {
    return { provider: 'Lantmateriet', action: 'promote', target: `Data/Lantmateriet/${name}` };
  }
  if (/^nmd|tradslag|basskikt|skikt|preciserad_kskog|potentiella_betesmarker/.test(n)) {
    return { provider: 'Naturvardsverket', action: 'promote', target: `Data/Naturvardsverket/${name}` };
  }
  if (/^inspiremsb|svaro|varo|pfra|olyckor|stabilitet/.test(n)) {
    return { provider: 'MSB', action: 'promote', target: `Data/MSB/${name}` };
  }
  if (/^(berg|jord|grund|brunn)/.test(n)) {
    return { provider: 'SGU', action: 'promote', target: `Data/SGU/${name}` };
  }
  if (/historik|malung|habo|krokom|are-|^\d{4}(-|\b)/.test(n)) {
    return { provider: 'Lantmateriet', action: 'promote_kommun_historik', target: `Data/Lantmateriet/KommunHistorik/${name}` };
  }
  if (/^geofysik|analys_/.test(n)) {
    return { provider: 'SGU', action: 'manual_review', target: null };
  }
  return { provider: null, action: 'manual_review', target: null };
}

function main() {
  const reviewRoot = resolveReviewRoot();
  const folders = fs.readdirSync(reviewRoot, { withFileTypes: true }).filter((e) => e.isDirectory());
  const byProvider = {};
  let unclassifiedBytes = 0;
  const entries = [];

  for (const f of folders) {
    const abs = path.join(reviewRoot, f.name);
    const { totalBytes, fileCount } = folderBytes(abs);
    const c = classify(f.name);
    const row = {
      folder: f.name,
      bytes: totalBytes,
      sizeGB: Number((totalBytes / 1024 ** 3).toFixed(2)),
      fileCount,
      ...c,
    };
    entries.push(row);
    const key = c.provider ?? 'UNCLASSIFIED';
    if (!byProvider[key]) byProvider[key] = { folders: 0, bytes: 0, sizeGB: 0 };
    byProvider[key].folders++;
    byProvider[key].bytes += totalBytes;
    byProvider[key].sizeGB = Number((byProvider[key].bytes / 1024 ** 3).toFixed(2));
    if (!c.provider) unclassifiedBytes += totalBytes;
  }

  entries.sort((a, b) => b.bytes - a.bytes);

  const report = {
    generatedAt: new Date().toISOString(),
    reviewRoot,
    folderCount: folders.length,
    totalGB: Number((entries.reduce((s, e) => s + e.bytes, 0) / 1024 ** 3).toFixed(2)),
    byProvider,
    unclassifiedGB: Number((unclassifiedBytes / 1024 ** 3).toFixed(2)),
    top20BySize: entries.slice(0, 20),
    allFolders: entries,
  };

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log(`Written ${OUT}`);
  console.log('byProvider:', JSON.stringify(byProvider, null, 2));
}

main();
