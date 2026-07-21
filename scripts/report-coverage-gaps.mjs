#!/usr/bin/env node
/**
 * List lowest line-coverage files under server/ and src/ from coverage/lcov.info.
 * Usage: node scripts/report-coverage-gaps.mjs [--top=25]
 */
import fs from 'node:fs';
import path from 'node:path';

const topN = Number(process.argv.find((a) => a.startsWith('--top='))?.split('=')[1] ?? 25);
const lcovPath = path.join(process.cwd(), 'coverage', 'lcov.info');

if (!fs.existsSync(lcovPath)) {
  console.error('Missing coverage/lcov.info — run: npm run test:unit:coverage');
  process.exit(1);
}

const raw = fs.readFileSync(lcovPath, 'utf8');
const records = raw.split('end_of_record\n').filter(Boolean);

/** @type {{ file: string; linesFound: number; linesHit: number; pct: number }[]} */
const files = [];

for (const block of records) {
  const sf = block.match(/^SF:(.+)$/m)?.[1];
  if (!sf) continue;
  const normalized = sf.replace(/\\/g, '/');
  // `SF:` can be absolute (C:/.../src/foo.ts) or relative (src/foo.ts)
  const isServer = normalized.includes('/server/') || normalized.startsWith('server/');
  const isSrc = normalized.includes('/src/') || normalized.startsWith('src/');
  if (!isServer && !isSrc) continue;

  const daLines = [...block.matchAll(/^DA:(\d+),(\d+)$/gm)];
  if (daLines.length === 0) continue;

  const linesFound = daLines.length;
  const linesHit = daLines.filter((m) => Number(m[2]) > 0).length;
  const pct = Math.round((100 * linesHit) / linesFound);

  files.push({
    file: normalized.split('/').slice(-3).join('/'),
    linesFound,
    linesHit,
    pct,
  });
}

files.sort((a, b) => a.pct - b.pct || a.linesFound - b.linesFound);

console.log(`\nLowest line coverage (server/ + src/) — top ${topN}:\n`);
for (const row of files.slice(0, topN)) {
  const miss = row.linesFound - row.linesHit;
  console.log(`${String(row.pct).padStart(3)}%  ${String(miss).padStart(4)} miss  ${row.file}`);
}

const outPath = path.join(process.cwd(), 'docs', 'qa', 'coverage-baseline-generated.md');
const md = [
  '# Coverage gaps (auto-generated)',
  '',
  `Generated from \`coverage/lcov.info\`. Lowest ${topN} files under \`server/\` and \`src/\`:`,
  '',
  '| Line % | Miss | File |',
  '| ------:| ----:| ---- |',
  ...files.slice(0, topN).map((r) => `| ${r.pct}% | ${r.linesFound - r.linesHit} | \`${r.file}\` |`),
  '',
].join('\n');

try {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, md);
  console.log(`\nWrote ${outPath}\n`);
} catch {
  // docs may be read-only in some environments
}
