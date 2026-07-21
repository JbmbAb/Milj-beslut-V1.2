/**
 * Set approved=true on auto/bulk rows in review-manual-review-proposal.csv.
 *
 * Run: node scripts/db/review-approve-manual-csv.mjs
 */
import fs from 'fs';
import path from 'path';

const ROOT = process.cwd();
const CSV_PATH = path.join(ROOT, 'storage/manifests/review-manual-review-proposal.csv');
const BACKUP = `${CSV_PATH}.bak`;

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

function main() {
  const text = fs.readFileSync(CSV_PATH, 'utf8');
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  const headers = parseCsvRow(lines[0]);
  const approvedIdx = headers.indexOf('approved');
  const actionIdx = headers.indexOf('suggested_action');
  const confIdx = headers.indexOf('confidence');
  if (approvedIdx < 0 || actionIdx < 0 || confIdx < 0) {
    throw new Error('CSV missing required columns');
  }

  if (!fs.existsSync(BACKUP)) fs.copyFileSync(CSV_PATH, BACKUP);

  let approvedPromote = 0;
  let approvedQuarantine = 0;
  let paused = 0;

  const outLines = [headers.map(csvEscape).join(',')];
  for (let i = 1; i < lines.length; i++) {
    const vals = parseCsvRow(lines[i]);
    const action = vals[actionIdx];
    const confidence = vals[confIdx];
    let approved = '';

    if (action === 'promote' || action === 'promote_kommun') {
      approved = 'true';
      approvedPromote++;
    } else if (action === 'quarantine') {
      approved = 'true';
      approvedQuarantine++;
    } else if (action === 'manual_review' && confidence === 'low') {
      approved = 'false';
      paused++;
    }

    vals[approvedIdx] = approved;
    outLines.push(vals.map(csvEscape).join(','));
  }

  fs.writeFileSync(CSV_PATH, `${outLines.join('\n')}\n`, 'utf8');
  console.log(JSON.stringify({ approvedPromote, approvedQuarantine, paused, total: lines.length - 1 }, null, 2));
  console.log(`Updated: ${CSV_PATH}`);
  console.log(`Backup: ${BACKUP}`);
}

main();
