/**
 * Report paused (approved=false) rows in review-manual-review-proposal.csv
 *
 * Run: node scripts/db/review-manual-paused-report.mjs [--json]
 */
import fs from 'fs';
import path from 'path';

const ROOT = process.cwd();
const CSV_PATH = path.join(ROOT, 'storage/manifests/review-manual-review-proposal.csv');
const JSON_OUT = path.join(ROOT, 'storage/manifests/review-manual-paused-report.json');

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

function main() {
  const text = fs.readFileSync(CSV_PATH, 'utf8');
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  const headers = parseCsvRow(lines[0]);
  const idx = Object.fromEntries(headers.map((h, i) => [h, i]));

  const paused = [];
  for (let i = 1; i < lines.length; i++) {
    const vals = parseCsvRow(lines[i]);
    if (vals[idx.approved] !== 'false') continue;
    paused.push(Object.fromEntries(headers.map((h) => [h, vals[idx[h]] ?? ''])));
  }

  paused.sort((a, b) => Number(b.size_gb) - Number(a.size_gb));

  const byAction = {};
  const byProvider = {};
  for (const row of paused) {
    byAction[row.suggested_action] = (byAction[row.suggested_action] ?? 0) + 1;
    byProvider[row.suggested_provider || '(empty)'] = (byProvider[row.suggested_provider || '(empty)'] ?? 0) + 1;
  }

  const report = {
    generatedAt: new Date().toISOString(),
    pausedCount: paused.length,
    totalGB: Number(paused.reduce((s, r) => s + Number(r.size_gb), 0).toFixed(2)),
    byAction,
    byProvider,
    rows: paused,
  };

  fs.writeFileSync(JSON_OUT, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log(`Paused: ${report.pausedCount} folders, ${report.totalGB} GB`);
  console.log('By action:', byAction);
  console.log('By provider:', byProvider);
  console.log(`\nReport: ${JSON_OUT}`);
  console.log('\nfolder\tsize_gb\tsuggested_provider\tsuggested_dataset\tsuggested_action');
  for (const r of paused) {
    console.log(
      `${r.folder}\t${r.size_gb}\t${r.suggested_provider}\t${r.suggested_dataset}\t${r.suggested_action}`,
    );
  }
}

main();
