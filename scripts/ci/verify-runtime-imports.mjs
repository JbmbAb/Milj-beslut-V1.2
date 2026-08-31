#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { builtinModules } from 'node:module';

const args = process.argv.slice(2);
const rootFlag = args.indexOf('--root');
const root = path.resolve(rootFlag >= 0 ? args[rootFlag + 1] : process.cwd());

const scanRoots = ['server', 'services'].map((item) => path.join(root, item));
const packageJsonPath = path.join(root, 'package.json');
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
const nodeModulesDir = path.join(root, 'node_modules');
const shouldCheckThirdPartyPackages = fs.existsSync(nodeModulesDir);
const workspaceDeps = new Map(
  Object.entries(packageJson.dependencies ?? {})
    .filter(([, value]) => typeof value === 'string' && value.startsWith('file:packages/'))
    .map(([name, value]) => [name, value.slice('file:'.length)]),
);
const builtins = new Set([...builtinModules, ...builtinModules.map((name) => `node:${name}`)]);
const failures = [];

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '__tests__') return [];
      return walk(full);
    }
    if (!/\.(mjs|cjs|js|ts|tsx)$/.test(entry.name)) return [];
    if (/\.(test|spec)\.(mjs|cjs|js|ts|tsx)$/.test(entry.name)) return [];
    return [full];
  });
}

function stripQuery(specifier) {
  return specifier.split('?')[0].split('#')[0];
}

function candidateFiles(resolved) {
  const ext = path.extname(resolved);
  if (['.js', '.mjs', '.cjs'].includes(ext)) {
    const withoutExt = resolved.slice(0, -ext.length);
    return [resolved, `${withoutExt}.ts`, `${withoutExt}.tsx`, path.join(resolved, 'index.ts')];
  }
  if (['.ts', '.tsx', '.json', '.node'].includes(ext)) return [resolved];
  return [
    resolved,
    `${resolved}.js`,
    `${resolved}.mjs`,
    `${resolved}.cjs`,
    `${resolved}.ts`,
    `${resolved}.tsx`,
    path.join(resolved, 'index.js'),
    path.join(resolved, 'index.mjs'),
    path.join(resolved, 'index.ts'),
    path.join(resolved, 'index.tsx'),
  ];
}

function resolveRelative(fromFile, specifier) {
  const resolved = path.resolve(path.dirname(fromFile), stripQuery(specifier));
  return candidateFiles(resolved).some((candidate) => fs.existsSync(candidate));
}

function packageName(specifier) {
  if (specifier.startsWith('@')) {
    const [scope, name] = specifier.split('/');
    return `${scope}/${name}`;
  }
  return specifier.split('/')[0];
}

function resolvePackage(specifier) {
  const name = packageName(specifier);
  if (builtins.has(name) || builtins.has(specifier)) return true;
  if (workspaceDeps.has(name)) {
    return fs.existsSync(path.join(root, workspaceDeps.get(name)));
  }
  if (!shouldCheckThirdPartyPackages) return true;
  return fs.existsSync(path.join(nodeModulesDir, name));
}

function importSpecifiers(source) {
  const specs = [];
  const patterns = [
    /\bimport\s+(?:[^'"()]+?\s+from\s*)?['"]([^'"]+)['"]/g,
    /\bexport\s+[^'"()]+?\s+from\s*['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) specs.push(match[1]);
  }
  return specs;
}

for (const file of scanRoots.flatMap(walk)) {
  const source = fs.readFileSync(file, 'utf8');
  for (const specifier of importSpecifiers(source)) {
    const ok = specifier.startsWith('.') ? resolveRelative(file, specifier) : resolvePackage(specifier);
    if (!ok) {
      failures.push(`${path.relative(root, file)} -> ${specifier}`);
    }
  }
}

if (failures.length > 0) {
  console.error('Runtime import verification failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(
  `Runtime import verification passed for ${scanRoots.map((dir) => path.relative(root, dir)).join(', ')}`,
);
