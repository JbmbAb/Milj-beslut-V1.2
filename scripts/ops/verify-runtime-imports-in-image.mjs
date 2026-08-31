#!/usr/bin/env node
/**
 * PNRC I2: verify every server/services runtime import under packages/ exists
 * in a built production image (or on disk for --root).
 *
 * Usage:
 *   node scripts/ops/verify-runtime-imports-in-image.mjs --root .
 *   node scripts/ops/verify-runtime-imports-in-image.mjs --image miljobeslut-staging-web:latest
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const scanRoots = ['server', 'services'];
const importPattern =
  /from\s+['"]((?:\.\.\/)+packages\/[^'"]+)['"]|import\s*\(\s*['"]((?:\.\.\/)+packages\/[^'"]+)['"]\s*\)/g;

function walkDir(dir, files = []) {
  if (!fs.existsSync(dir)) return files;
  for (const name of fs.readdirSync(dir)) {
    const abs = path.join(dir, name);
    const stat = fs.statSync(abs);
    if (stat.isDirectory()) {
      walkDir(abs, files);
    } else if (name.endsWith('.ts') || name.endsWith('.tsx')) {
      files.push(abs);
    }
  }
  return files;
}

function normalizePackageImport(specifier) {
  return specifier.replace(/^(\.\.\/)+/, '').replace(/\.js$/, '');
}

function resolveCandidates(relativePath) {
  const base = relativePath.replace(/\.js$/, '');
  return [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    path.join(base, 'index.ts'),
    path.join(base, 'index.js'),
  ];
}

function existsOnDisk(candidate) {
  return fs.existsSync(path.join(repoRoot, candidate));
}

function existsInImage(image, candidate) {
  const containerPath = `/app/${candidate.replace(/\\/g, '/')}`;
  try {
    execSync(`docker run --rm --entrypoint sh ${image} -c "test -e '${containerPath}'"`, {
      stdio: 'pipe',
    });
    return true;
  } catch {
    return false;
  }
}

function collectImports() {
  const imports = new Set();
  for (const root of scanRoots) {
    for (const absFile of walkDir(path.join(repoRoot, root))) {
      const text = fs.readFileSync(absFile, 'utf8');
      for (const match of text.matchAll(importPattern)) {
        imports.add(normalizePackageImport(match[1] || match[2]));
      }
    }
  }
  return [...imports].sort();
}

function parseArgs(argv) {
  const imageIdx = argv.indexOf('--image');
  if (imageIdx !== -1) {
    return { mode: 'image', image: argv[imageIdx + 1] };
  }
  return { mode: 'root' };
}

const args = parseArgs(process.argv.slice(2));
const imports = collectImports();

if (imports.length === 0) {
  console.error('No packages/ runtime imports found under server/ or services/.');
  process.exit(1);
}

console.log(`Runtime packages/ imports (${imports.length}):`);
for (const imp of imports) {
  console.log(`  - ${imp}`);
}

const missing = [];

for (const imp of imports) {
  const candidates = resolveCandidates(imp);
  const found = candidates.some((candidate) =>
    args.mode === 'image' ? existsInImage(args.image, candidate) : existsOnDisk(candidate),
  );
  if (!found) {
    missing.push(imp);
  }
}

if (missing.length > 0) {
  console.error(`\nMissing ${missing.length} runtime import path(s):`);
  for (const item of missing) {
    console.error(`  - ${item}`);
  }
  process.exit(1);
}

console.log(`\nOK: all runtime packages/ imports resolve (${args.mode}).`);
