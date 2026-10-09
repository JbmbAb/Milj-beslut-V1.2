/**
 * Configurable Cesium mapfront browser harness.
 * Default: local static proof page (no CesiumMapView mock).
 * Future governed PostGIS/presentation products: set CESIUM_PROOF_BASE_URL.
 */
import { expect, test } from '@playwright/test';
import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';

const external = String(process.env.CESIUM_PROOF_BASE_URL || '').trim();
const root = process.cwd();

test.describe('Cesium mapfront foundation WebGL', () => {
  test('boots local Cesium with WebGL without mocking CesiumMapView', async ({ browser }) => {
    test.setTimeout(120_000);

    let base = external;
    let server: ReturnType<typeof createServer> | null = null;
    if (!base) {
      const cesiumJs =
        [
          join(root, 'public/cesium/Cesium.js'),
          join(root, 'node_modules/cesium/Build/Cesium/Cesium.js'),
        ].find((p) => existsSync(p)) || null;
      test.skip(!cesiumJs, 'Requires Cesium.js (npm install + copy-cesium-assets)');

      server = createServer((req, res) => {
        const url = new URL(req.url || '/', 'http://127.0.0.1');
        let rel = decodeURIComponent(url.pathname);
        if (rel === '/') rel = '/cesium-proof/index.html';
        if (rel === '/cesium/Cesium.js' && cesiumJs && cesiumJs.includes('node_modules')) {
          res.writeHead(200, { 'content-type': 'application/javascript' });
          res.end(readFileSync(cesiumJs));
          return;
        }
        const filePath = normalize(join(root, 'public', rel.replace(/^\//, '')));
        if (!filePath.startsWith(join(root, 'public')) || !existsSync(filePath) || !statSync(filePath).isFile()) {
          res.writeHead(404).end('missing');
          return;
        }
        const mime =
          ({ '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' } as Record<
            string,
            string
          >)[extname(filePath)] || 'application/octet-stream';
        res.writeHead(200, { 'content-type': mime });
        res.end(readFileSync(filePath));
      });
      await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
      const addr = server.address();
      if (!addr || typeof addr === 'string') throw new Error('no port');
      base = `http://127.0.0.1:${addr.port}`;
    }

    const context = await browser.newContext();
    await context.route('**/*', async (route) => {
      const u = route.request().url();
      if (u.startsWith(base!)) {
        await route.continue();
        return;
      }
      await route.abort();
    });
    const page = await context.newPage();
    await page.goto(`${base}/cesium-proof/index.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(
      () => (window as any).__CESIUM_PROOF__?.status === 'ready' || (window as any).__CESIUM_PROOF__?.status === 'error',
      null,
      { timeout: 90_000 },
    );
    const proof = await page.evaluate(() => (window as any).__CESIUM_PROOF__);
    expect(proof.status, JSON.stringify(proof)).toBe('ready');
    expect(proof.checks.webgl).toBeTruthy();
    expect(proof.checks.viewer_boot).toBeTruthy();
    expect(proof.checks.local_workers).toBeTruthy();

    await context.close();
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
  });
});
