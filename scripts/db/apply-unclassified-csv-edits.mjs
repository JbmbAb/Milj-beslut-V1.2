/**
 * Bulk-edit mapping_proposal_unclassified.csv before merge/execute.
 * Run: node scripts/db/apply-unclassified-csv-edits.mjs
 */
import fs from 'fs';
import path from 'path';

const ROOT = process.cwd();
const CSV_PATH = path.join(ROOT, 'storage', 'manifests', 'mapping_proposal_unclassified.csv');
const BACKUP = path.join(ROOT, 'storage', 'manifests', 'mapping_proposal_unclassified.csv.bak');

function parseCsvRow(line) {
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') inQuotes = false;
      else cur += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

function csvEscape(value) {
  const s = String(value ?? '');
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function writeCsv(filePath, headers, rows) {
  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(headers.map((h) => csvEscape(row[h])).join(','));
  }
  fs.writeFileSync(filePath, `${lines.join('\n')}\n`, 'utf8');
}

function inferIngestProvider(rel) {
  const lower = rel.toLowerCase();
  if (lower.includes('catalog-raa-se') || lower.includes('arkeolog')) {
    return { provider: 'Riksantikvarieambetet', dataset: path.basename(rel).replace(/\.[^.]+$/, '') };
  }
  if (lower.includes('dataportal-env') && /\.(pdf|docx?)$/i.test(rel)) {
    const base = path.basename(rel).replace(/\.[^.]+$/, '');
    if (/buller|no2|krontackning|sammanlagt|vagbuller|tag/i.test(base)) {
      return { provider: 'Naturvardsverket', dataset: base };
    }
    if (/stadsdel|dp |detaljplan|heby|morgong/i.test(lower)) {
      return { provider: 'Kommun', dataset: base.slice(0, 80) };
    }
    return { provider: 'Naturvardsverket', dataset: base.slice(0, 80) };
  }
  if (/rapport|skoglig|landskap|värdekärn|boreonemoral/i.test(lower)) {
    return { provider: 'Naturvardsverket', dataset: path.basename(rel).replace(/\.[^.]+$/, '').slice(0, 80) };
  }
  if (/kommun|c_geo_pdf/i.test(lower)) {
    return { provider: 'Kommun', dataset: path.basename(rel).replace(/\.[^.]+$/, '').slice(0, 80) };
  }
  return { provider: 'Okand_Provider', dataset: '_needs_review' };
}

function shouldSkipDesktop(rel) {
  const lower = rel.toLowerCase();
  if (/\.gdb\//i.test(rel)) return true;
  if (/miljöbeslut\.se\/scratch/i.test(rel)) return true;
  if (/figma_modulunderlag/i.test(rel)) return true;
  if (/\.(exe|msi|html|htm|tsx?|jsx?|py|ps1|bat|cmd|log|md|yaml|yml|toml|lock|map|svg|ico|woff2?|ttf|eot)$/i.test(rel)) return true;
  if (/node_modules|dist\/|\.next|__pycache__|\.venv/i.test(rel)) return true;
  if (/storage\/extracted\//i.test(rel)) return false;
  if (/miljölut\.se/i.test(rel) && /\.(zip|gpkg|shp|tif|pdf)$/i.test(rel)) return false;
  if (/miljobeslut_ops_pipeline/i.test(rel) && /\.(gpkg|shp|tif|zip|pdf|geojson)$/i.test(rel) && !/\.gdb\//i.test(rel)) {
    return false;
  }
  return true;
}

function inferDesktopPromote(rel) {
  const exMatch = rel.match(/\/extracted\/([^/]+)/i);
  if (exMatch) {
    const folder = exMatch[1];
    const f = folder.toLowerCase();
    let provider = 'Miljobeslut_Ops';
    if (/berg|brunn|grund/.test(f)) provider = 'SGU';
    else if (/sci|spa|natura|nmd/.test(f)) provider = 'Naturvardsverket';
    else if (/avrinn|vatten/.test(f)) provider = 'SMHI';
    return { provider, dataset: folder, approved: true, action: 'promote' };
  }
  if (/miljölut\.se/i.test(rel)) {
    const base = path.basename(rel).replace(/\.[^.]+$/, '');
    return { provider: 'Miljolut', dataset: base, approved: true, action: 'promote' };
  }
  return null;
}

const text = fs.readFileSync(CSV_PATH, 'utf8');
const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
const headers = parseCsvRow(lines[0]);
const idx = Object.fromEntries(headers.map((h, i) => [h, i]));

/** @type {Record<string, string>[]} */
const rows = lines.slice(1).map((line) => {
  const vals = parseCsvRow(line);
  /** @type {Record<string, string>} */
  const row = {};
  headers.forEach((h, i) => {
    row[h] = vals[i] ?? '';
  });
  return row;
});

const stats = { downloadsSkip: 0, desktopSkip: 0, desktopPromote: 0, ingestSkip: 0, ingestPromote: 0, ingestReview: 0 };

for (const row of rows) {
  const rel = row.sourceRel;

  if (rel.startsWith('D_Downloads/')) {
    row.action = 'skip';
    row.approved = 'false';
    row.heuristicNote = `${row.heuristicNote} | bulk: downloads skip`.trim();
    stats.downloadsSkip++;
    continue;
  }

  if (rel.startsWith('D_Desktop_Produktdata/')) {
    if (shouldSkipDesktop(rel)) {
      row.action = 'skip';
      row.approved = 'false';
      row.provider = '';
      row.dataset = '';
      row.heuristicNote = `${row.heuristicNote} | bulk: desktop dev/temp skip`.trim();
      stats.desktopSkip++;
    } else {
      const p = inferDesktopPromote(rel);
      if (p) {
        row.provider = p.provider;
        row.dataset = p.dataset;
        row.approved = 'true';
        row.action = 'promote';
        row.status = 'CLASSIFIED_MEDIUM';
        row.heuristicNote = `${row.heuristicNote} | bulk: desktop geodata promote`.trim();
        stats.desktopPromote++;
      } else {
        row.action = 'skip';
        row.approved = 'false';
        stats.desktopSkip++;
      }
    }
    continue;
  }

  if (rel.startsWith('D_ingest_arkiv/')) {
    const ext = path.extname(rel).toLowerCase();
    if (!['.pdf', '.docx', '.doc', '.geojson', '.gpkg', '.xlsx', '.csv'].includes(ext)) {
      row.action = 'skip';
      row.approved = 'false';
      stats.ingestSkip++;
      continue;
    }
    const inf = inferIngestProvider(rel);
    row.provider = inf.provider;
    row.dataset = inf.dataset;
    if (inf.provider === 'Okand_Provider') {
      row.action = 'skip';
      row.approved = 'false';
      row.heuristicNote = `${row.heuristicNote} | bulk: ingest unmapped skip`.trim();
      stats.ingestReview++;
    } else {
      row.approved = 'true';
      row.action = 'promote';
      row.status = 'CLASSIFIED_MEDIUM';
      row.heuristicNote = `${row.heuristicNote} | bulk: ingest RAG/doc promote`.trim();
      stats.ingestPromote++;
    }
  }
}

fs.copyFileSync(CSV_PATH, BACKUP);
writeCsv(CSV_PATH, headers, rows);
console.log('Updated:', CSV_PATH);
console.log('Backup:', BACKUP);
console.log(JSON.stringify(stats, null, 2));
