/**
 * LU-PROJECTION-RECONCILIATION-AND-TOTAL-ORDER-V1 Phase B — web-private-key absence proof.
 *
 * Static, whole-tree proof that LOCALIZATION_GEOMETRY_SUPERSESSION_ISSUER_PRIVATE_KEY_PEM is never
 * referenced, and the module that holds it is never imported, outside the two files explicitly
 * allowed to: the signing-key module itself, and the worker-only execution module it's imported
 * from. This is the same authority-separation already proven for ViewerCapability
 * (VIEWER_CAPABILITY_ISSUER_PRIVATE_KEY_PEM) -- the web process must structurally be unable to
 * sign a currentness transition, not merely convention-bound not to.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const REPO_ROOT = join(__dirname, '..', '..');
const SERVER_DIR = join(REPO_ROOT, 'server');

const ALLOWED_FILES = new Set([
  join('server', 'security', 'localizationGeometrySupersessionSigningKey.ts'),
  join('server', 'modules', 'localization', 'luGeometrySupersessionProvisioning.ts'),
  join('server', 'services', 'luGeometrySupersessionProvisioningWorker.ts'),
]);
const ALLOWED_DIRS = [join('server', 'workers')];

/** Strips single-line and block comments before scanning -- a file documenting the boundary in
 *  prose (e.g. "this module must never reference X") must not itself be flagged as an offender. */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      if (entry === 'node_modules' || entry === '.git') continue;
      walk(full, out);
    } else if (entry.endsWith('.ts') && !entry.endsWith('.test.ts')) {
      out.push(full);
    }
  }
  return out;
}

describe('LU-PROJECTION-RECONCILIATION-AND-TOTAL-ORDER-V1 — geometry supersession issuer private key boundary', () => {
  it('LOCALIZATION_GEOMETRY_SUPERSESSION_ISSUER_PRIVATE_KEY_PEM is referenced nowhere in server/ except the signing-key module, the worker execution module, and server/workers/', () => {
    const files = walk(SERVER_DIR);
    const offenders: string[] = [];
    for (const file of files) {
      const rel = relative(REPO_ROOT, file);
      if (ALLOWED_FILES.has(rel)) continue;
      if (ALLOWED_DIRS.some((dir) => rel.startsWith(dir))) continue;
      const content = withoutComments(readFileSync(file, 'utf8'));
      if (content.includes('LOCALIZATION_GEOMETRY_SUPERSESSION_ISSUER_PRIVATE_KEY_PEM')) {
        offenders.push(rel);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the signing-key module (localizationGeometrySupersessionSigningKey.ts) is imported nowhere in server/ except the worker execution module and server/workers/', () => {
    const files = walk(SERVER_DIR);
    const offenders: string[] = [];
    for (const file of files) {
      const rel = relative(REPO_ROOT, file);
      if (ALLOWED_FILES.has(rel)) continue;
      if (ALLOWED_DIRS.some((dir) => rel.startsWith(dir))) continue;
      const content = withoutComments(readFileSync(file, 'utf8'));
      if (/from\s+['"][^'"]*localizationGeometrySupersessionSigningKey['"]/.test(content)) {
        offenders.push(rel);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('createApp.ts and every route file never import the worker execution module (the one place that can call the signing key)', () => {
    const targets = [
      join(SERVER_DIR, 'createApp.ts'),
      ...walk(join(SERVER_DIR, 'routes')),
    ];
    const offenders: string[] = [];
    for (const file of targets) {
      const rel = relative(REPO_ROOT, file);
      const content = readFileSync(file, 'utf8');
      if (/luGeometrySupersessionProvisioning(?!Worker)/.test(content)) {
        offenders.push(rel);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('localizationGeometryService.ts (the web save/read boundary) never imports the signing-key module or the worker execution module', () => {
    const content = readFileSync(join(SERVER_DIR, 'modules', 'localization', 'localizationGeometryService.ts'), 'utf8');
    expect(content).not.toMatch(/localizationGeometrySupersessionSigningKey/);
    expect(content).not.toMatch(/luGeometrySupersessionProvisioning(?!Worker)/);
  });
});
