import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';

const repoRoot = process.cwd();
const routeFile = path.join(repoRoot, 'server', 'routes', 'governance.routes.ts');
const matrixFile = path.join(repoRoot, 'docs', 'architecture', 'governance-route-exposure-matrix.jsonc');

interface MatrixRoute {
  readonly method: string;
  readonly path: string;
  readonly exposure_class: string;
  readonly auth_policy: string;
  readonly authority_boundary: string;
  readonly status: 'PROVEN' | 'NEEDS_REVIEW' | 'DEPRECATED';
}

function readMatrix(): { routes: MatrixRoute[] } {
  return JSON.parse(fs.readFileSync(matrixFile, 'utf8'));
}

function declaredGovernanceRoutes(): Array<{ method: string; path: string }> {
  const source = fs.readFileSync(routeFile, 'utf8');
  const routes: Array<{ method: string; path: string }> = [];
  const pattern = /governanceRouter\.(get|post|put|patch|delete)\(\s*["']([^"']+)["']/g;
  for (const match of source.matchAll(pattern)) {
    routes.push({ method: match[1]!.toUpperCase(), path: match[2]! });
  }
  return routes;
}

function routeKey(route: { method: string; path: string }): string {
  return `${route.method} ${route.path}`;
}

describe('governance route exposure matrix', () => {
  it('classifies every live governance route and no phantom routes', () => {
    const declared = declaredGovernanceRoutes().map(routeKey).sort();
    const classified = readMatrix().routes.map(routeKey).sort();

    expect(classified).toEqual(declared);
  });

  it('keeps mutating permanent governance writes behind authenticated ADMIN policy', () => {
    const source = fs.readFileSync(routeFile, 'utf8');
    const routes = readMatrix().routes;
    const promote = routes.find((route) => route.path === '/quarantine/:id/promote');
    const reject = routes.find((route) => route.path === '/quarantine/:id/reject');

    expect(promote).toMatchObject({
      method: 'POST',
      exposure_class: 'permanent_governance_write',
      auth_policy: 'AUTHENTICATED_ADMIN_REQUIRED',
      status: 'PROVEN',
    });
    expect(reject).toMatchObject({
      method: 'POST',
      exposure_class: 'quarantine_status_write',
      auth_policy: 'AUTHENTICATED_ADMIN_REQUIRED',
      status: 'PROVEN',
    });

    expect(source).toContain('governanceRouter.post("/quarantine/:id/promote", requireAuth');
    expect(source).toContain('governanceRouter.post("/quarantine/:id/reject", requireAuth');
    expect(source).toContain('function requireAdmin');
  });

  it('keeps every governance route behind authenticated ADMIN policy', () => {
    const source = fs.readFileSync(routeFile, 'utf8');

    for (const route of readMatrix().routes) {
      expect(route.auth_policy).toBe('AUTHENTICATED_ADMIN_REQUIRED');
      expect(route.status).toBe('PROVEN');
      expect(route.authority_boundary.length).toBeGreaterThan(20);
    }

    expect(source).not.toContain('UNAUTHENTICATED_CURRENT');
    expect(source).toContain('requireAdminMiddleware');
  });
});
