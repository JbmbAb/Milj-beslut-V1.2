/**
 * Read-only: plan what to copy from D: (Fury SSD) → H: GEO_Master_Archive.
 * Output: GEO_Master_Archive/_manifests/D_to_H_migration_plan.json
 *
 * Run: node scripts/db/migrate-d-to-h-plan.mjs
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

const H_ROOT = 'H:\\Delade enheter\\Miljöbeslut';
const MASTER = path.join(H_ROOT, 'GEO_Master_Archive');
const LOCAL_OUT = path.join(process.cwd(), 'storage', 'manifests', 'D_to_H_migration_plan.json');
const OUT = path.join(MASTER, '_manifests', 'D_to_H_migration_plan.json');

const SPATIAL_EXT = new Set([
  '.shp', '.gpkg', '.zip', '.tif', '.tiff', '.gdb', '.geojson', '.json',
]);
const DOC_EXT = new Set(['.pdf', '.docx', '.doc', '.xlsx', '.csv']);

/** @type {{ id: string, path: string, targetHint: string }[]} */
const D_SOURCES = [];

function resolveDPath(namePrefix) {
  if (!fs.existsSync('D:\\')) return null;
  const hit = fs.readdirSync('D:\\', { withFileTypes: true })
    .find((e) => e.isDirectory() && e.name.toLowerCase().startsWith(namePrefix.toLowerCase()));
  return hit ? path.join('D:\\', hit.name) : null;
}

function initSources() {
  const geodata = path.join('D:\\', 'GEodata');
  if (fs.existsSync(geodata)) {
    D_SOURCES.push({ id: 'D_GEodata', path: geodata, targetHint: 'Data/' });
  }
  const geoInl = resolveDPath('Geo inl');
  if (geoInl) D_SOURCES.push({ id: 'D_Geo_inlarning', path: geoInl, targetHint: 'Data/' });
  const ingest = path.join('D:\\', 'ingest-arkiv-2026-03-29');
  if (fs.existsSync(ingest)) {
    D_SOURCES.push({ id: 'D_ingest_arkiv', path: ingest, targetHint: 'Documents/Sources/' });
  }
  const desktop = path.join('D:\\', 'Users', 'jimmy', 'Desktop', 'MiljoBeslut_Produktdata');
  if (fs.existsSync(desktop)) {
    D_SOURCES.push({ id: 'D_Desktop_Produktdata', path: desktop, targetHint: 'Data/' });
  }
  const downloads = path.join('D:\\', 'Users', 'jimmy', 'Downloads');
  if (fs.existsSync(downloads)) {
    D_SOURCES.push({ id: 'D_Downloads', path: downloads, targetHint: 'Data/' });
  }
  const cGeoPdf = 'C:\\GEO PDF';
  if (fs.existsSync(cGeoPdf)) {
    D_SOURCES.push({ id: 'C_GEO_PDF', path: cGeoPdf, targetHint: 'Documents/Sources/' });
  }
}

/** @type {Map<string, { size: number, paths: string[] }>} */
const hIndexByName = new Map();

function indexH() {
  const roots = [
    MASTER,
    path.join(H_ROOT, 'Geo backup'),
    path.join(H_ROOT, 'GEO komplettering_importerat'),
  ];
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    walkIndex(root, root);
  }
}

function walkIndex(dir, root) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (['_quarantine'].includes(e.name)) continue;
      walkIndex(full, root);
    } else if (e.isFile()) {
      try {
        const stat = fs.statSync(full);
        const key = `${e.name.toLowerCase()}|${stat.size}`;
        if (!hIndexByName.has(key)) hIndexByName.set(key, { size: stat.size, paths: [] });
        hIndexByName.get(key).paths.push(full.replace(H_ROOT, 'H:').replace(/\\/g, '/'));
      } catch {
        // skip
      }
    }
  }
}

function partialHash(filePath) {
  try {
    const stat = fs.statSync(filePath);
    const fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(Math.min(65536, stat.size));
    fs.readSync(fd, buf, 0, buf.length, 0);
    fs.closeSync(fd);
    return crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16);
  } catch {
    return null;
  }
}

function classifyFile(relPath, fullPath, sourceId, targetHint) {
  const ext = path.extname(fullPath).toLowerCase();
  const name = path.basename(fullPath);
  let size = 0;
  try {
    size = fs.statSync(fullPath).size;
  } catch {
    return null;
  }
  if (size < 1024 * 1024 && !DOC_EXT.has(ext)) return null; // skip tiny non-docs

  const key = `${name.toLowerCase()}|${size}`;
  const hMatch = hIndexByName.get(key);

  let verdict = 'copy_required';
  let hPaths = [];
  if (hMatch) {
    verdict = 'duplicate_skip_size_name';
    hPaths = hMatch.paths.slice(0, 3);
  }

  return {
    sourceId,
    relativePath: relPath.replace(/\\/g, '/'),
    fileName: name,
    sizeBytes: size,
    sizeMB: Number((size / 1024 / 1024).toFixed(2)),
    ext,
    targetHint,
    suggestedTarget: `${targetHint}${sourceId}/${path.dirname(relPath).replace(/\\/g, '/')}`,
    verdict,
    hExistingPaths: hPaths,
  };
}

function scanSource(source) {
  const items = [];
  const stack = [{ dir: source.path, rel: '' }];
  while (stack.length) {
    const { dir, rel } = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      const relPath = rel ? path.join(rel, e.name) : e.name;
      if (e.isDirectory()) {
        if (['Windows', 'Program Files', 'Program Files (x86)', 'node_modules', '.git'].includes(e.name)) {
          continue;
        }
        stack.push({ dir: full, rel: relPath });
      } else if (e.isFile()) {
        const ext = path.extname(e.name).toLowerCase();
        if (SPATIAL_EXT.has(ext) || DOC_EXT.has(ext) || sizeOf(full) > 50 * 1024 * 1024) {
          const row = classifyFile(relPath, full, source.id, source.targetHint);
          if (row) items.push(row);
        }
      }
    }
  }
  return items;
}

function sizeOf(p) {
  try {
    return fs.statSync(p).size;
  } catch {
    return 0;
  }
}

function summarizeByFolder(items) {
  /** @type {Map<string, { count: number, bytes: number, copy: number, skip: number }>} */
  const m = new Map();
  for (const it of items) {
    const top = it.relativePath.split('/')[0] || '(root)';
    if (!m.has(top)) m.set(top, { count: 0, bytes: 0, copy: 0, skip: 0 });
    const s = m.get(top);
    s.count++;
    s.bytes += it.sizeBytes;
    if (it.verdict === 'copy_required') s.copy++;
    else s.skip++;
  }
  return Object.fromEntries(
    [...m.entries()]
      .map(([k, v]) => [k, { ...v, sizeGB: Number((v.bytes / 1024 ** 3).toFixed(2)) }])
      .sort((a, b) => b[1].bytes - a[1].bytes),
  );
}

function hashSampleDuplicates(items) {
  const dupCandidates = items
    .filter((i) => i.verdict === 'duplicate_skip_size_name' && i.sizeBytes > 10 * 1024 * 1024)
    .slice(0, 15);
  for (const item of dupCandidates) {
    const src = D_SOURCES.find((s) => s.id === item.sourceId);
    if (!src || !item.hExistingPaths?.[0]) continue;
    const dPath = path.join(src.path, item.relativePath.replace(/\//g, path.sep));
    const hRel = item.hExistingPaths[0].replace(/^H:\/?/i, '').replace(/\//g, path.sep);
    const hPath = path.join(H_ROOT, hRel);
    if (!fs.existsSync(dPath) || !fs.existsSync(hPath)) continue;
    const dh = partialHash(dPath);
    const hh = partialHash(hPath);
    if (!dh || !hh) continue;
    item.partialHashD = dh;
    item.partialHashH = hh;
    if (dh === hh) item.verdict = 'verified_duplicate_skip';
  }
}

function main() {
  console.log('Indexing H: (this may take a few minutes)...');
  initSources();
  indexH();
  console.log(`H: index entries: ${hIndexByName.size}`);
  console.log(`D:/C: sources: ${D_SOURCES.map((s) => s.path).join(', ')}`);

  const allItems = [];
  for (const src of D_SOURCES) {
    console.log(`Scanning ${src.id}...`);
    allItems.push(...scanSource(src));
  }

  hashSampleDuplicates(allItems);

  const copyItems = allItems.filter((i) => i.verdict === 'copy_required');
  const skipItems = allItems.filter((i) => i.verdict !== 'copy_required');

  const copyBytes = copyItems.reduce((s, i) => s + i.sizeBytes, 0);
  const skipBytes = skipItems.reduce((s, i) => s + i.sizeBytes, 0);

  const report = {
    generatedAt: new Date().toISOString(),
    mode: 'read_only',
    purpose: 'Plan migration from Fury SSD (D:) and C:\\GEO PDF to H: before SSD return',
    hRoot: H_ROOT,
    masterArchive: MASTER,
    sources: D_SOURCES,
    summary: {
      totalCandidates: allItems.length,
      copyRequiredCount: copyItems.length,
      copyRequiredGB: Number((copyBytes / 1024 ** 3).toFixed(2)),
      duplicateSkipCount: skipItems.length,
      duplicateSkipGB: Number((skipBytes / 1024 ** 3).toFixed(2)),
    },
    bySource: Object.fromEntries(
      D_SOURCES.map((s) => {
        const subset = allItems.filter((i) => i.sourceId === s.id);
        const copy = subset.filter((i) => i.verdict === 'copy_required');
        return [
          s.id,
          {
            path: s.path,
            targetHint: s.targetHint,
            candidates: subset.length,
            copyRequired: copy.length,
            copyRequiredGB: Number((copy.reduce((a, b) => a + b.sizeBytes, 0) / 1024 ** 3).toFixed(2)),
            topFolders: summarizeByFolder(subset),
          },
        ];
      }),
    ),
    copyRequired: copyItems.sort((a, b) => b.sizeBytes - a.sizeBytes),
    copyRequiredTop200: copyItems.sort((a, b) => b.sizeBytes - a.sizeBytes).slice(0, 200),
    duplicateSkipSample: skipItems.sort((a, b) => b.sizeBytes - a.sizeBytes).slice(0, 50),
  };

  fs.mkdirSync(path.dirname(LOCAL_OUT), { recursive: true });
  fs.writeFileSync(LOCAL_OUT, JSON.stringify(report, null, 2));
  console.log(`\nWritten: ${LOCAL_OUT}`);
  try {
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
    console.log(`Copied to: ${OUT}`);
  } catch (err) {
    console.warn(`Could not write to H: (${err.message}) — local copy kept at ${LOCAL_OUT}`);
  }
  console.log(JSON.stringify(report.summary, null, 2));
}

main();
