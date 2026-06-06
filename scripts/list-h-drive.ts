import fs from 'fs';
import path from 'path';

const dirs = [
  'H:\\Delade enheter\\Miljöbeslut\\Geo inlärning',
  'H:\\Delade enheter\\Miljöbeslut\\GEodata'
];

const counts: Record<string, number> = {};

function scanDir(dir: string) {
  if (!fs.existsSync(dir)) return;
  const files = fs.readdirSync(dir);
  for (const f of files) {
    const fullPath = path.join(dir, f);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      scanDir(fullPath);
    } else if (f.endsWith('.zip')) {
      const match = f.match(/^([a-zA-ZÅÄÖåäö]+)[-_]/);
      let prefix = match ? match[1] : f;
      if (prefix.length > 20) prefix = prefix.substring(0, 20) + '...';
      counts[prefix] = (counts[prefix] || 0) + 1;
    }
  }
}

for (const d of dirs) {
  scanDir(d);
}

const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
console.table(sorted);
