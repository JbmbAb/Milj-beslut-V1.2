// Image-smoke för Mimer-appens image. Körs i containern med cwd /app och utan
// nätverk (deploy/onprem/smoke-image.sh: docker run --network none).
//
// Smoken utvärderar ingen app-modul och ansluter inte till någon databas:
//   S1 layout: packages/, tsconfig.json, @miljobeslut-länkarna, Prisma-klienten,
//      dist/, inga .env-filer.
//   S2 statisk graf (esbuild, ingenting körs) från web och de fyra LU-arbetarna:
//      varje import löses, varje tredjepartspaket finns installerat.
//   S3 link-only genom tsx för samma fem entrypoints (link-only-hooks.mjs).
//   S4 statisk graf och link-only för alla filer i server/ och src/ som
//      importerar @miljobeslut/*.
//   N1 negativ kontroll per @miljobeslut-paket som bara löses via tsconfig-paths:
//      utan sin paths-rad ska importörerna inte gå att länka, med den ska de.
//   N2 negativ kontroll: utan packages/ ska en LU-arbetare inte gå att länka.
//
// Utfall PASS bara om S1-S4 är gröna och N1/N2 fallerar med väntad signatur.
// Ett fall som inte kunde avgöras räknas som INCONCLUSIVE, aldrig som PASS.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { builtinModules, createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const APP = process.cwd();
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REGISTER = path.join(HERE, 'link-only-register.mjs');
const TMP = fs.mkdtempSync('/tmp/image-smoke-');
const appRequire = createRequire(path.join(APP, 'package.json'));
const TSCONFIG = process.env.TSX_TSCONFIG_PATH || path.join(APP, 'tsconfig.json');

const ENTRYPOINTS = [
  'server/index.ts',
  'server/workers/lu-project-context-bootstrap-worker.ts',
  'server/workers/lu-execution-identity-v3-worker.ts',
  'server/workers/lu-viewer-capability-worker.ts',
  'server/workers/lu-geometry-supersession-worker.ts',
];

const results = [];
function record(id, verdict, detail = {}) {
  results.push({ id, verdict, ...detail });
  console.log(`${verdict} ${id}${detail.summary ? ` - ${detail.summary}` : ''}`);
}
const tail = (s, n = 3000) => (s && s.length > n ? `...${s.slice(-n)}` : s || '');
const rel = (p) => path.relative(APP, p).split(path.sep).join('/');

function walk(dir, accept, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, accept, out);
    else if (accept(p, e.name)) out.push(p);
  }
  return out;
}

// ---------------------------------------------------------------- facts
console.log('== facts');
console.log(`node=${process.version} uid=${process.getuid()} cwd=${APP}`);
console.log(`tsx=${appRequire('tsx/package.json').version} esbuild=${appRequire('esbuild/package.json').version}`);
console.log(`TSX_TSCONFIG_PATH=${process.env.TSX_TSCONFIG_PATH ?? '(unset)'} NODE_ENV=${process.env.NODE_ENV ?? '(unset)'}`);
console.log(`DATABASE_URL set=${Boolean(process.env.DATABASE_URL)}`);
let netIfs = [];
try {
  netIfs = fs.readdirSync('/sys/class/net');
} catch {
  netIfs = ['(unreadable)'];
}
console.log(`network interfaces=${netIfs.join(',')}`);

// ---------------------------------------------------------------- S1 layout
console.log('== S1 layout');
const tsconfig = JSON.parse(fs.readFileSync(TSCONFIG, 'utf8'));
const paths = tsconfig.compilerOptions?.paths ?? {};
const pathKeys = Object.keys(paths);
{
  const packageDirs = fs
    .readdirSync(path.join(APP, 'packages'), { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
  const lock = JSON.parse(fs.readFileSync(path.join(APP, 'package-lock.json'), 'utf8'));
  const lockLinks = Object.entries(lock.packages)
    .filter(([k, v]) => v.link && k.startsWith('node_modules/@miljobeslut/'))
    .map(([k]) => k.slice('node_modules/@miljobeslut/'.length));
  const badLinks = lockLinks.filter((name) => {
    const p = path.join(APP, 'node_modules/@miljobeslut', name);
    try {
      return (
        !fs.lstatSync(p).isSymbolicLink() ||
        fs.realpathSync(p) !== path.join(APP, 'packages', name) ||
        !fs.existsSync(path.join(p, 'package.json'))
      );
    } catch {
      return true;
    }
  });
  const missingPathTargets = pathKeys
    .flatMap((k) => paths[k].map((t) => [k, t]))
    .filter(([, t]) => !t.includes('*'))
    .filter(([, t]) => !fs.existsSync(path.join(APP, t)));
  const envFiles = walk(APP, (_p, name) => name === '.env' || name.startsWith('.env.')).map(rel);
  const prismaGenerated = fs.existsSync(path.join(APP, 'node_modules/.prisma/client/default.js'));
  let prismaClient = 'not loaded';
  try {
    prismaClient = typeof appRequire('@prisma/client').PrismaClient;
  } catch (e) {
    prismaClient = `error: ${e.message}`;
  }
  const distIndex = fs.existsSync(path.join(APP, 'dist/index.html'));
  const tsconfigAtApp = TSCONFIG === path.join(APP, 'tsconfig.json') && fs.existsSync(TSCONFIG);

  console.log(`packages/ directories=${packageDirs.length}`);
  console.log(`lockfile @miljobeslut links=${lockLinks.length} broken in image=${badLinks.length}`);
  console.log(`tsconfig paths=${pathKeys.length} non-wildcard targets missing=${missingPathTargets.length}`);
  for (const [k, t] of missingPathTargets) console.log(`  INFO path target missing in the commit itself: ${k} -> ${t}`);
  console.log(`node_modules/.prisma/client/default.js=${prismaGenerated} require('@prisma/client').PrismaClient=${prismaClient}`);
  console.log(`dist/index.html=${distIndex} .env files under /app (outside node_modules)=${envFiles.length}`);

  const ok =
    packageDirs.length > 0 &&
    lockLinks.length > 0 &&
    badLinks.length === 0 &&
    tsconfigAtApp &&
    prismaGenerated &&
    prismaClient === 'function' &&
    distIndex &&
    envFiles.length === 0;
  record('S1-layout', ok ? 'PASS' : 'FAIL', {
    summary: `packages=${packageDirs.length} links=${lockLinks.length - badLinks.length}/${lockLinks.length} tsconfig=${tsconfigAtApp} prisma=${prismaGenerated && prismaClient === 'function'} dist=${distIndex} envFiles=${envFiles.length}`,
    packages: packageDirs.length,
    badLinks,
    envFiles,
    missingPathTargets,
  });
}

// ---------------------------------------------------------------- static graph (esbuild)
const esbuild = appRequire('esbuild');
const builtins = new Set(builtinModules);
const aliased = (s) => pathKeys.some((k) => (k.endsWith('/*') ? s.startsWith(k.slice(0, -1)) : s === k));
const packageName = (s) => (s.startsWith('@') ? s.split('/').slice(0, 2).join('/') : s.split('/')[0]);
function installed(name, fromDir) {
  for (let d = fromDir; ; d = path.dirname(d)) {
    if (fs.existsSync(path.join(d, 'node_modules', name, 'package.json'))) return true;
    if (path.dirname(d) === d) return false;
  }
}

async function staticGraph(entryAbs) {
  const missing = [];
  const plugin = {
    name: 'third-party-presence',
    setup(build) {
      build.onResolve({ filter: /^[^./]/ }, (args) => {
        const s = args.path;
        if (s.startsWith('node:') || builtins.has(s) || builtins.has(s.split('/')[0])) {
          return { path: s, external: true };
        }
        // @miljobeslut/* och tsconfig-alias löses av esbuild som tsx gör: paths först, sedan node_modules.
        if (s.startsWith('@miljobeslut/') || aliased(s)) return undefined;
        if (!installed(packageName(s), args.resolveDir || APP)) {
          missing.push({ spec: s, importer: rel(args.importer), kind: args.kind });
        }
        return { path: s, external: true };
      });
    },
  };
  try {
    const r = await esbuild.build({
      entryPoints: [entryAbs],
      absWorkingDir: APP,
      bundle: true,
      write: false,
      platform: 'node',
      format: 'esm',
      metafile: true,
      logLevel: 'silent',
      tsconfig: TSCONFIG,
      plugins: [plugin],
    });
    return { errors: [], metafile: r.metafile, missing };
  } catch (e) {
    const errors = (e.errors ?? [{ text: String(e) }]).map(
      (x) => `${x.location ? `${x.location.file}:${x.location.line} ` : ''}${x.text}`,
    );
    return { errors, metafile: null, missing };
  }
}

// Alla @miljobeslut-importer i en esbuild-graf, med specifieraren som den står i källan.
function miljobeslutImports(metafile) {
  const out = [];
  for (const [file, input] of Object.entries(metafile?.inputs ?? {})) {
    for (const imp of input.imports ?? []) {
      const spec = imp.original ?? imp.path;
      if (spec.startsWith('@miljobeslut/')) out.push({ importer: file, spec, resolved: imp.path });
    }
  }
  return out;
}

function summarizeGraph(id, g) {
  const inputs = Object.keys(g.metafile?.inputs ?? {});
  const top = [...new Set(inputs.map((p) => (p.includes('/') ? `${p.split('/')[0]}/` : p)))].sort();
  const pkgs = [...new Set(inputs.filter((p) => p.startsWith('packages/')).map((p) => p.split('/')[1]))].sort();
  const staticMissing = g.missing.filter((m) => m.kind === 'import-statement');
  const softMissing = g.missing.filter((m) => m.kind !== 'import-statement');
  const ok = g.errors.length === 0 && staticMissing.length === 0;
  for (const e of g.errors.slice(0, 20)) console.log(`  error: ${e}`);
  for (const m of staticMissing) console.log(`  missing package (static import): ${m.spec} <- ${m.importer}`);
  for (const m of softMissing) console.log(`  WARN not installed (${m.kind}, guarded or optional?): ${m.spec} <- ${m.importer}`);
  record(id, ok ? 'PASS' : 'FAIL', {
    summary: `files=${inputs.length} packages=${pkgs.length} errors=${g.errors.length} missingStatic=${staticMissing.length} missingDynamic=${softMissing.length}`,
    files: inputs.length,
    topLevel: top,
    packages: pkgs,
    errors: g.errors,
    missing: g.missing,
  });
  console.log(`  top-level: ${top.join(' ')}`);
  console.log(`  packages: ${pkgs.join(' ')}`);
  return ok;
}

// ---------------------------------------------------------------- link-only (tsx)
function linkOnly(entryAbs, extraEnv = {}) {
  const r = spawnSync(process.execPath, ['--import', 'tsx', '--import', REGISTER, entryAbs], {
    cwd: APP,
    env: { ...process.env, ...extraEnv, LINK_ONLY_ENTRY: entryAbs },
    encoding: 'utf8',
    timeout: 600000,
    maxBuffer: 64 * 1024 * 1024,
  });
  return {
    linked: r.status === 0 && /LINK_ONLY_OK/.test(r.stdout || ''),
    status: r.status,
    signal: r.signal,
    stdout: r.stdout || '',
    stderr: r.stderr || '',
    spawnError: r.error ? r.error.message : null,
  };
}
function firstErrorLine(s) {
  return (s.split('\n').find((l) => /Error|ERR_|Cannot find/.test(l)) || s.split('\n')[0] || '').trim();
}

function writeAggregate(name, files) {
  const file = path.join(TMP, `${name}.mjs`);
  fs.writeFileSync(file, files.map((f) => `import ${JSON.stringify(pathToFileURL(f).href)};`).join('\n') + '\n');
  return file;
}

const allGraphImports = [];

// ---------------------------------------------------------------- S2 + S3 per entrypoint
for (const entry of ENTRYPOINTS) {
  const entryAbs = path.join(APP, entry);
  console.log(`== S2 static graph: ${entry}`);
  const g = await staticGraph(entryAbs);
  summarizeGraph(`S2-static:${entry}`, g);
  allGraphImports.push(...miljobeslutImports(g.metafile));

  console.log(`== S3 link-only (tsx): ${entry}`);
  const t0 = Date.now();
  const l = linkOnly(entryAbs);
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  if (!l.linked) console.log(tail(l.stderr));
  record(`S3-link:${entry}`, l.linked ? 'PASS' : 'FAIL', {
    summary: l.linked ? `linked in ${secs}s, no app module evaluated` : `exit=${l.status} ${firstErrorLine(l.stderr)}`,
    seconds: Number(secs),
    stderr: l.linked ? tail(l.stderr, 500) : tail(l.stderr),
  });
}

// ---------------------------------------------------------------- S4 every @miljobeslut importer in server/ and src/
console.log('== S4 every @miljobeslut importer in server/ and src/');
const importerFiles = [...walk(path.join(APP, 'server'), () => true), ...walk(path.join(APP, 'src'), () => true)]
  .filter((p) => /\.(ts|mts|js|mjs)$/.test(p) && !/\.(test|spec)\.[cm]?[jt]s$/.test(p) && !p.includes(`${path.sep}__tests__${path.sep}`))
  .filter((p) => /['"]@miljobeslut\//.test(fs.readFileSync(p, 'utf8')));
const specsInSource = new Set();
for (const p of importerFiles) {
  for (const m of fs.readFileSync(p, 'utf8').matchAll(/['"](@miljobeslut\/[^'"]+)['"]/g)) specsInSource.add(m[1]);
}
console.log(`importer files=${importerFiles.length} distinct specifiers=${specsInSource.size}`);
for (const s of [...specsInSource].sort()) console.log(`  ${s}`);
{
  const agg = writeAggregate('s4-all-importers', importerFiles);
  const g = await staticGraph(agg);
  summarizeGraph('S4-static:all-importers', g);
  allGraphImports.push(...miljobeslutImports(g.metafile));
  const t0 = Date.now();
  const l = linkOnly(agg);
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  if (!l.linked) console.log(tail(l.stderr));
  record('S4-link:all-importers', l.linked ? 'PASS' : 'FAIL', {
    summary: l.linked
      ? `${importerFiles.length} files linked in ${secs}s, no app module evaluated`
      : `exit=${l.status} ${firstErrorLine(l.stderr)}`,
    seconds: Number(secs),
    stderr: l.linked ? tail(l.stderr, 500) : tail(l.stderr),
  });
}

// ---------------------------------------------------------------- N1 tsconfig-paths are load-bearing
console.log('== N1 per tsconfig-paths-only @miljobeslut package');
const linkedNames = new Set(fs.readdirSync(path.join(APP, 'node_modules/@miljobeslut')));
const byPackage = new Map();
for (const { importer, spec } of allGraphImports) {
  const name = spec.split('/')[1];
  if (linkedNames.has(name)) continue;
  if (!byPackage.has(name)) byPackage.set(name, { specs: new Set(), importers: new Set() });
  byPackage.get(name).specs.add(spec);
  byPackage.get(name).importers.add(path.join(APP, importer));
}
console.log(`tsconfig-paths-only packages in the runtime graphs: ${[...byPackage.keys()].sort().join(', ') || '(none)'}`);
for (const [name, { specs, importers }] of [...byPackage].sort()) {
  const files = [...importers].sort();
  const agg = writeAggregate(`n1-${name}`, files);
  const mutated = JSON.parse(JSON.stringify(tsconfig));
  for (const k of Object.keys(mutated.compilerOptions.paths)) {
    if (k === `@miljobeslut/${name}` || k === `@miljobeslut/${name}/*`) delete mutated.compilerOptions.paths[k];
  }
  // paths löses relativt tsconfig-filens katalog, så kopian ska ligga bredvid
  // originalet: då är den borttagna raden den enda skillnaden.
  const mutatedPath = path.join(path.dirname(TSCONFIG), `.tsconfig.smoke-without-${name}.json`);
  fs.writeFileSync(mutatedPath, JSON.stringify(mutated, null, 2));
  let red;
  try {
    red = linkOnly(agg, { TSX_TSCONFIG_PATH: mutatedPath });
  } finally {
    fs.unlinkSync(mutatedPath);
  }
  const green = linkOnly(agg);
  const redSignature = !red.linked && red.stderr.includes(`@miljobeslut/${name}`) && /ERR_MODULE_NOT_FOUND|Cannot find/.test(red.stderr);
  const verdict = redSignature && green.linked ? 'PASS' : 'INCONCLUSIVE';
  record(`N1-tsconfig-paths:${name}`, verdict, {
    summary: `importers=${files.length} specs=${[...specs].join(',')} without-paths: ${red.linked ? 'LINKED (unexpected)' : firstErrorLine(red.stderr)} | with-paths: ${green.linked ? 'linked' : firstErrorLine(green.stderr)}`,
    importers: files.map(rel),
    red: { linked: red.linked, status: red.status, stderr: tail(red.stderr, 1500) },
    green: { linked: green.linked, status: green.status },
  });
}

// ---------------------------------------------------------------- N2 packages/ is load-bearing
console.log('== N2 without packages/');
{
  const entryAbs = path.join(APP, 'server/workers/lu-project-context-bootstrap-worker.ts');
  const hidden = path.join(APP, 'packages.smoke-hidden');
  let red;
  fs.renameSync(path.join(APP, 'packages'), hidden);
  try {
    red = linkOnly(entryAbs);
  } finally {
    fs.renameSync(hidden, path.join(APP, 'packages'));
  }
  const redSignature = !red.linked && /ERR_MODULE_NOT_FOUND|Cannot find/.test(red.stderr) && /@miljobeslut\/|\/app\/packages\//.test(red.stderr);
  const restored = fs.existsSync(path.join(APP, 'packages'));
  record('N2-packages-hidden', redSignature && restored ? 'PASS' : 'INCONCLUSIVE', {
    summary: `without packages/: ${red.linked ? 'LINKED (unexpected)' : firstErrorLine(red.stderr)}; restored=${restored}`,
    red: { linked: red.linked, status: red.status, stderr: tail(red.stderr, 1500) },
  });
}

// ---------------------------------------------------------------- verdict
const counts = results.reduce((a, r) => ({ ...a, [r.verdict]: (a[r.verdict] || 0) + 1 }), {});
const pass = results.every((r) => r.verdict === 'PASS');
console.log('== verdict');
console.log(`checks=${results.length} ${Object.entries(counts).map(([k, v]) => `${k}=${v}`).join(' ')}`);
console.log(`IMAGE_SMOKE=${pass ? 'PASS' : 'NOT_PASS'}`);
console.log('== json');
console.log(JSON.stringify({ pass, counts, results }, null, 1));
process.exit(pass ? 0 : 1);
