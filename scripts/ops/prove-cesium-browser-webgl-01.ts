/**
 * CESIUM-BROWSER-WEBGL-PROOF + OFFLINE-ASSETS (Chromium / Playwright).
 * Does NOT mock CesiumMapView — boots real Cesium from local /cesium assets.
 *
 * Usage:
 *   npx tsx scripts/ops/prove-cesium-browser-webgl-01.ts
 * Optional: CESIUM_PROOF_PORT=8799
 */
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
const root = process.cwd();
const port = Number(process.env.CESIUM_PROOF_PORT || 8799);

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
};

function contentType(filePath: string): string {
  return MIME[extname(filePath)] || 'application/octet-stream';
}

async function main(): Promise<void> {
  const cesiumJsCandidates = [
    join(root, 'public/cesium/Cesium.js'),
    join(root, 'node_modules/cesium/Build/Cesium/Cesium.js'),
  ];
  const cesiumJs = cesiumJsCandidates.find((p) => existsSync(p));
  if (!cesiumJs) {
    throw new Error('Cesium.js missing — run npm install && node scripts/copy-cesium-assets.cjs');
  }

  const server = createServer((req, res) => {
    try {
      const url = new URL(req.url || '/', `http://127.0.0.1:${port}`);
      let rel = decodeURIComponent(url.pathname);
      if (rel === '/') rel = '/cesium-proof/index.html';
      // Offline proof: block obvious remote imagery hosts if somehow requested.
      if (/ion\.cesium|googleapis|bing|openstreetmap|mapbox/i.test(rel)) {
        res.writeHead(451, { 'content-type': 'text/plain' });
        res.end('blocked remote provider');
        return;
      }
      if (rel === '/cesium/Cesium.js' && cesiumJs.endsWith('node_modules/cesium/Build/Cesium/Cesium.js')) {
        const body = readFileSync(cesiumJs);
        res.writeHead(200, { 'content-type': 'application/javascript; charset=utf-8' });
        res.end(body);
        return;
      }
      const filePath = normalize(join(root, 'public', rel.replace(/^\//, '')));
      if (!filePath.startsWith(join(root, 'public')) || !existsSync(filePath) || !statSync(filePath).isFile()) {
        res.writeHead(404).end('not found');
        return;
      }
      res.writeHead(200, { 'content-type': contentType(filePath) });
      res.end(readFileSync(filePath));
    } catch (err) {
      res.writeHead(500).end(String(err));
    }
  });

  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve));
  console.log(`Cesium proof server http://127.0.0.1:${port}/cesium-proof/`);

  const { chromium } = await import('@playwright/test');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  // Offline-ish: abort non-local requests.
  await context.route('**/*', async (route) => {
    const u = route.request().url();
    if (u.startsWith(`http://127.0.0.1:${port}/`) || u.startsWith(`http://localhost:${port}/`)) {
      await route.continue();
      return;
    }
    await route.abort();
  });
  const page = await context.newPage();
  const consoleErrors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => consoleErrors.push(String(err)));

  await page.goto(`http://127.0.0.1:${port}/cesium-proof/index.html`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => (window as any).__CESIUM_PROOF__?.status === 'ready' || (window as any).__CESIUM_PROOF__?.status === 'error', null, {
    timeout: 60_000,
  });
  const proof = await page.evaluate(() => (window as any).__CESIUM_PROOF__);
  console.log(JSON.stringify(proof, null, 2));

  await browser.close();
  server.close();

  if (proof.status !== 'ready') {
    throw new Error(`Cesium browser proof failed: ${proof.error || 'unknown'}`);
  }
  if (!proof.checks?.webgl) throw new Error('WebGL check failed');
  if (!proof.checks?.viewer_boot) throw new Error('viewer boot failed');
  if (!proof.checks?.local_workers) throw new Error('local workers missing');
  if (!proof.checks?.imagery_fixture) throw new Error('imagery fixture failed');
  // Allow tileset soft-pass when empty content; client path must still run.
  if (!proof.checks?.tileset_client) throw new Error('tileset client failed');

  const severe = consoleErrors.filter((e) => !/ImageryProvider|tile/i.test(e));
  console.log(`console_errors=${consoleErrors.length} severe=${severe.length}`);
  console.log('CESIUM-BROWSER-WEBGL-PROOF PASS (offline local assets)');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
