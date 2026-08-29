/**
 * PROJECT-CONTEXT-BOOTSTRAP-WORKER-OPS-01 — web-private-key absence proof.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const REPO_ROOT = join(__dirname, '..', '..');
const SERVER_DIR = join(REPO_ROOT, 'server');

const ALLOWED_FILES = new Set([
  join('server', 'security', 'projectContextBindingIssuerKey.ts'),
  join('server', 'modules', 'localization', 'luProjectContextBootstrap.ts'),
  join('server', 'modules', 'localization', 'luProjectContextBootstrapVerifyCli.ts'),
  join('server', 'modules', 'localization', 'projectContextBootstrapDiagnostics.ts'),
  join('server', 'services', 'luProjectContextBootstrapWorker.ts'),
  join('server', 'workers', 'luProvisioningWorkers.ts'),
]);
const ALLOWED_DIRS = [join('server', 'workers')];

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

describe('PROJECT-CONTEXT-BOOTSTRAP-WORKER-OPS-01 — project-context issuer private key boundary', () => {
  it('PROJECT_CONTEXT_BINDING_ISSUER_PRIVATE_KEY_PEM is referenced only in worker-safe server files', () => {
    const offenders: string[] = [];
    for (const file of walk(SERVER_DIR)) {
      const rel = relative(REPO_ROOT, file);
      if (ALLOWED_FILES.has(rel)) continue;
      if (ALLOWED_DIRS.some((dir) => rel.startsWith(dir))) continue;
      const content = withoutComments(readFileSync(file, 'utf8'));
      if (content.includes('PROJECT_CONTEXT_BINDING_ISSUER_PRIVATE_KEY_PEM')) {
        offenders.push(rel);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('getProjectContextBindingIssuerSigner is imported only by worker execution modules', () => {
    const offenders: string[] = [];
    for (const file of walk(SERVER_DIR)) {
      const rel = relative(REPO_ROOT, file);
      if (ALLOWED_FILES.has(rel)) continue;
      if (ALLOWED_DIRS.some((dir) => rel.startsWith(dir))) continue;
      const content = withoutComments(readFileSync(file, 'utf8'));
      if (/getProjectContextBindingIssuerSigner/.test(content)) {
        offenders.push(rel);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('createApp.ts and route files never import luProjectContextBootstrap execution module', () => {
    const targets = [join(SERVER_DIR, 'createApp.ts'), ...walk(join(SERVER_DIR, 'routes'))];
    const offenders: string[] = [];
    for (const file of targets) {
      const rel = relative(REPO_ROOT, file);
      const content = readFileSync(file, 'utf8');
      if (/luProjectContextBootstrap(?!Worker|VerifyCli|RequestQueue|Diagnostics)/.test(content)) {
        offenders.push(rel);
      }
    }
    expect(offenders).toEqual([]);
  });
});
