// DEMO-01 start script (K-88). Run in your own terminal, not from the app's preview pane:
//
//   node C:/wt-demo-01/scripts/demo01/start-demo.mjs [--case <demo case id>]
//
// Order: port check → API (8797) → wait until it answers → web (3000, strictPort) → wait until it
// answers → warm-up (the same read-only queries a proposal runs) → print the demo URL.
// Ctrl+C stops both servers. Logs: .data/demo-01/logs/{api,web}.log (gitignored).
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const API_PORT = 8797;
const WEB_PORT = 3000;
const TSX = pathToFileURL(path.join(ROOT, 'node_modules/tsx/dist/loader.mjs')).href;
const LOG_DIR = path.join(ROOT, '.data', 'demo-01', 'logs');
const caseArg = process.argv.indexOf('--case') >= 0 ? process.argv[process.argv.indexOf('--case') + 1] : undefined;

const t0 = Date.now();
const stamp = () => `[${((Date.now() - t0) / 1000).toFixed(1).padStart(5)} s]`;
const say = (msg) => console.log(`${stamp()} ${msg}`);
const children = [];

function stopAll(code) {
  for (const c of children) {
    if (c.exitCode === null) {
      if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(c.pid), '/t', '/f'], { stdio: 'ignore' });
      else c.kill('SIGTERM');
    }
  }
  process.exit(code);
}
process.on('SIGINT', () => {
  say('Stoppar servrarna …');
  stopAll(0);
});

function fail(msg, logFile) {
  console.error(`${stamp()} FEL: ${msg}`);
  if (logFile && fs.existsSync(logFile)) {
    const tail = fs.readFileSync(logFile, 'utf8').split(/\r?\n/).slice(-15).join('\n');
    console.error(`--- sista raderna i ${path.relative(ROOT, logFile)} ---\n${tail}`);
  }
  stopAll(1);
}

// A port counts as busy if anything accepts a connection on it (IPv4 or IPv6 localhost).
const accepts = (port, host) =>
  new Promise((resolve) => {
    const sock = net.connect({ port, host });
    sock.setTimeout(1500);
    sock.once('connect', () => {
      sock.destroy();
      resolve(true);
    });
    sock.once('timeout', () => {
      sock.destroy();
      resolve(false);
    });
    sock.once('error', () => resolve(false));
  });
const portFree = async (port) => !((await accepts(port, '127.0.0.1')) || (await accepts(port, '::1')));

async function waitFor(url, { timeoutMs, child, logFile, what }) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (child.exitCode !== null) fail(`${what} avslutades under start (exit ${child.exitCode}).`, logFile);
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
      if (res.status < 500) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  fail(`${what} svarade inte på ${url} inom ${timeoutMs / 1000} s.`, logFile);
}

function start(what, args, env, logName) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  const logFile = path.join(LOG_DIR, logName);
  const out = fs.openSync(logFile, 'w');
  const child = spawn(process.execPath, args, { cwd: ROOT, env: { ...process.env, ...env }, stdio: ['ignore', out, out], windowsHide: true });
  children.push(child);
  return { child, logFile };
}

const release = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).stdout.trim();
const dirty = spawnSync('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: ROOT, encoding: 'utf8' }).stdout.trim();
say(`DEMO-01 start · release ${release}${dirty ? '-dirty (OBS: ocommittade ändringar)' : ''}`);

for (const port of [API_PORT, WEB_PORT]) {
  if (!(await portFree(port))) fail(`port ${port} är upptagen. Stäng det som kör där (t.ex. appens förhandsvisning) och försök igen.`);
}

say(`Startar API på ${API_PORT} …`);
const api = start('API', ['--import', TSX, path.join(ROOT, 'scripts/demo01/dev-api.mjs')], { PORT: String(API_PORT) }, 'api.log');
await waitFor(`http://localhost:${API_PORT}/api/csrf-token`, { timeoutMs: 120_000, child: api.child, logFile: api.logFile, what: 'API:t' });
say('API:t svarar.');

say(`Startar webben på ${WEB_PORT} …`);
const web = start(
  'webben',
  [path.join(ROOT, 'node_modules/vite/bin/vite.js'), '--port', String(WEB_PORT), '--strictPort'],
  { VITE_API_BASE_URL: `http://localhost:${API_PORT}` },
  'web.log',
);
await waitFor(`http://localhost:${WEB_PORT}/`, { timeoutMs: 120_000, child: web.child, logFile: web.logFile, what: 'Webben' });
await waitFor(`http://localhost:${WEB_PORT}/api/csrf-token`, { timeoutMs: 30_000, child: web.child, logFile: web.logFile, what: 'Webbens API-proxy' });
say('Webben svarar och når API:t.');

say('Värmer databasen (samma läsfrågor som ett förslag, inget skrivs) …');
const warm = spawnSync(process.execPath, ['--import', TSX, path.join(ROOT, 'scripts/demo01/warm.ts'), ...(caseArg ? ['--case', caseArg] : [])], {
  cwd: ROOT,
  encoding: 'utf8',
  env: process.env,
});
const warmLine = (warm.stdout || '').split(/\r?\n/).find((l) => l.startsWith('{"warmed"'));
if (warm.status === 0 && warmLine) say(`Värmning klar: ${warmLine}`);
else say(`VARNING: värmningen misslyckades (demon fungerar, men första förslaget blir långsammare): ${(warm.stderr || warm.stdout || '').trim().split(/\r?\n/).pop()}`);

const url = `http://localhost:${WEB_PORT}/#/demo/c-anmalan${caseArg ? `?case=${caseArg}` : ''}`;
say(`KLART. Öppna ${url}`);
say('Visas inloggningssidan: välj "Dev-inloggning" och öppna länken igen. Ctrl+C stoppar demon.');
