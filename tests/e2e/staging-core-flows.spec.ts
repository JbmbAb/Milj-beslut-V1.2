/**
 * P3 — Staging (eller lokal fullstack) kärnflöden utan BankID.
 * Kör mot staging: sätt PLAYWRIGHT_BASE_URL / STAGING_URL till frontend-URL.
 *
 * Bevis: resultat + kommando dokumenteras i docs/qa/production-readiness-checklist.md (P3-rad).
 */

import { expect, test } from '@playwright/test';
import {
  adminAuthHeaders,
  createApiContext,
  getE2EApiBaseUrl,
  isExternalE2E,
  loginAsAdmin,
  loginAsAdminWithRefresh,
  parseJson,
} from './support';

function envString(name: string, fallback: string): string {
  const value = String(process.env[name] || '').trim();
  return value || fallback;
}

function envNumber(name: string, fallback: number): number {
  const parsed = Number(String(process.env[name] || '').trim());
  return Number.isFinite(parsed) ? parsed : fallback;
}

function envFlag(name: string): boolean {
  return ['1', 'true', 'yes'].includes(
    String(process.env[name] || '')
      .trim()
      .toLowerCase(),
  );
}

const p3PropertyDesignation = envString('E2E_PROPERTY_DESIGNATION', 'NACKA BOO 1:1');
const p3Latitude = envNumber('E2E_PROPERTY_LATITUDE', 59.3293);
const p3Longitude = envNumber('E2E_PROPERTY_LONGITUDE', 18.0686);
const skipVertex = envFlag('E2E_SKIP_VERTEX_FLOWS');
const resolvedApiBaseUrl = getE2EApiBaseUrl();
const isLocalTarget = /127\.0\.0\.1|localhost/i.test(resolvedApiBaseUrl);
const isExternalTarget = isExternalE2E() && !isLocalTarget;

test.describe('P3 staging core flows (admin, no BankID)', () => {
  let projectId = '';
  let accessToken = '';
  let createdPropertyDesignation = p3PropertyDesignation;

  async function ensureP3Project(): Promise<{ accessToken: string; projectId: string }> {
    if (accessToken && projectId) return { accessToken, projectId };

    const api = await createApiContext();
    try {
      accessToken = await loginAsAdmin(api);
      createdPropertyDesignation = p3PropertyDesignation;
      const created = await api.post('/api/admin/projects', {
        headers: await adminAuthHeaders(api, accessToken),
        data: { propertyDesignation: createdPropertyDesignation },
      });
      expect(created.ok(), await created.text()).toBeTruthy();
      const body = await parseJson<{ project?: { id?: string } }>(created);
      projectId = String(body.project?.id || '');
      expect(projectId.length).toBeGreaterThan(5);
      return { accessToken, projectId };
    } finally {
      await api.dispose();
    }
  }

  test('API: /health and /ready', async () => {
    const api = await createApiContext();
    try {
      const h = await api.get('/health');
      expect(h.ok(), await h.text()).toBeTruthy();
      const hb = (await h.json()) as { liveness?: string; ok?: boolean };
      expect(hb.ok).toBe(true);
      expect(hb.liveness).toBe('up');

      const r = await api.get('/ready');
      expect(r.ok(), await r.text()).toBeTruthy();
      const rb = (await r.json()) as { ok?: boolean; database?: string };
      expect(rb.database).toBe('ok');
      expect(rb.ok).toBe(true);
    } finally {
      await api.dispose();
    }
  });

  test('API: admin login + create project', async () => {
    const state = await ensureP3Project();
    expect(state.accessToken.length).toBeGreaterThan(20);
    expect(state.projectId.length).toBeGreaterThan(5);
  });

  test('API: fastighet/karta — liveuppslag med verifierad geometri', async () => {
    const api = await createApiContext();
    try {
      const state = await ensureP3Project();
      const res = await api.post('/api/property/lookup', {
        headers: {
          ...(await adminAuthHeaders(api, state.accessToken)),
          'content-type': 'application/json',
        },
        data: {
          projectId: state.projectId,
          propertyDesignation: createdPropertyDesignation,
          purpose: 'P3_STAGING_E2E_PROPERTY_MAP',
        },
      });
      const lookupText = await res.text();
      if (!res.ok()) {
        // Lokal miljö saknar ofta komplett fastighetsdata; staging ska fortsatt kräva live-svar.
        if (!isExternalTarget && lookupText.includes('PROPERTY_NOT_FOUND')) {
          return;
        }
        expect(res.ok(), lookupText).toBeTruthy();
      }
      const body = JSON.parse(lookupText) as {
        ok?: boolean;
        result?: { geometry?: unknown; _demo?: boolean; designation?: string };
        source?: string;
      };
      expect(body.ok).toBe(true);
      expect(body.result?._demo, 'P3 tillåter inte demo-geometri för fastighet/karta').not.toBe(true);
      expect(
        body.result?.geometry,
        `Ingen verifierad geometri returnerades från ${body.source || 'okänd källa'}`,
      ).toBeTruthy();
    } finally {
      await api.dispose();
    }
  });

  test('API: kravanalys — requirements cases list', async () => {
    const api = await createApiContext();
    try {
      const state = await ensureP3Project();
      const res = await api.get('/api/admin/requirements/cases?page=1&pageSize=5', {
        headers: await adminAuthHeaders(api, state.accessToken),
      });
      expect(res.ok(), await res.text()).toBeTruthy();
      const body = await parseJson<{ ok?: boolean }>(res);
      expect(body.ok).toBe(true);
    } finally {
      await api.dispose();
    }
  });

  test('API: dokumentuppladdning (liten textfil)', async () => {
    const api = await createApiContext();
    try {
      const state = await ensureP3Project();
      const headers = await adminAuthHeaders(api, state.accessToken);
      const buf = Buffer.from('P3 staging E2E text content.\n', 'utf8');
      const q = new URLSearchParams({
        projectId: state.projectId,
        originalName: 'p3-e2e.txt',
        subject: 'P3 E2E upload',
      });
      const res = await api.post(`/api/documents/upload?${q.toString()}`, {
        headers: {
          ...headers,
          'content-type': 'text/plain; charset=utf-8',
        },
        data: buf,
      });
      expect(
        res.ok() || res.status() === 201,
        `upload status ${res.status()}: ${await res.text()}`,
      ).toBeTruthy();
      const body = await parseJson<{ ok?: boolean; document?: { id?: string } }>(res);
      expect(body.ok).toBe(true);
      expect(String(body.document?.id || '').length).toBeGreaterThan(3);
    } finally {
      await api.dispose();
    }
  });

  test('API: sökstatus + RAG-anrop (endpoint svarar)', async () => {
    test.skip(
      !isExternalTarget,
      'RAG-flödet verifieras i staging; lokalmiljö kan sakna stabil sökindexering för beviskörning.',
    );
    const api = await createApiContext();
    try {
      const state = await ensureP3Project();
      const status = await api.get(`/api/search/status/${encodeURIComponent(state.projectId)}`, {
        headers: await adminAuthHeaders(api, state.accessToken),
      });
      expect(status.ok(), await status.text()).toBeTruthy();

      const rag = await api.post('/api/search/rag', {
        headers: {
          ...(await adminAuthHeaders(api, state.accessToken)),
          'content-type': 'application/json',
        },
        data: {
          query: 'miljö tillstånd',
          projectId: state.projectId,
          limit: 3,
        },
      });
      const ragText = await rag.text();
      expect(rag.ok(), `rag ${rag.status()}: ${ragText.slice(0, 500)}`).toBeTruthy();
      const ragJson = JSON.parse(ragText) as { ok?: boolean; result?: unknown };
      expect(ragJson.ok).toBe(true);
      if (isExternalTarget) {
        expect(ragJson.result).toBeTruthy();
      }
    } finally {
      await api.dispose();
    }
  });

  test('API: audit / export', async () => {
    const api = await createApiContext();
    try {
      const state = await ensureP3Project();
      const res = await api.get('/api/audit/export', {
        headers: await adminAuthHeaders(api, state.accessToken),
      });
      expect(res.ok(), await res.text()).toBeTruthy();
      const body = await parseJson<{ ok?: boolean; integrity?: unknown }>(res);
      expect(body.ok).toBe(true);
    } finally {
      await api.dispose();
    }
  });

  test('Browser: hub, Core och fastighetskarta renderar utan BankID', async ({ page }) => {
    test.skip(
      !isExternalTarget,
      'Browser-flödet verifieras i staging; lokal dev-server är inte en godkännandemiljö.',
    );
    test.setTimeout(120_000);
    const api = await createApiContext();
    try {
      const state = await ensureP3Project();
      const session = await loginAsAdminWithRefresh(api);
      await page.addInitScript(() => {
        if ('serviceWorker' in navigator) {
          void navigator.serviceWorker
            .getRegistrations()
            .then((registrations) => registrations.forEach((registration) => registration.unregister()));
        }
      });
      await page.addInitScript(
        (input: { accessToken: string; refreshToken: string; activeProjectId: string }) => {
          window.localStorage.setItem('miljobeslut_admin_bearer', input.accessToken);
          window.localStorage.setItem('miljobeslut_admin_refresh', input.refreshToken);
          window.localStorage.setItem('miljobeslut_admin_project', input.activeProjectId);
        },
        { ...session, activeProjectId: state.projectId },
      );
      await page.goto('/');
      await expect(page).toHaveTitle(/Milj.*beslut/i);
      await expect(
        page.locator('[data-testid="app-workspace-shell"], [data-testid="landing-open-core"]').first(),
      ).toBeVisible({ timeout: 60_000 });

      if (
        await page
          .getByTestId('app-workspace-shell')
          .isVisible()
          .catch(() => false)
      ) {
        await page.getByRole('button', { name: /Ärendeportal/i }).click();
      } else {
        await expect(page.getByTestId('landing-open-core')).toBeVisible({ timeout: 60_000 });
        await page.getByTestId('landing-open-core').click();
      }

      await expect(page.getByTestId('workspace-active-tab-label')).toContainText('core', {
        timeout: 60_000,
      });
      await page.getByRole('button', { name: /Provningsportal/i }).click();
      await page.getByRole('button', { name: /Fastighetsanalys/i }).click();
      await expect(page.getByTestId('workspace-active-tab-label')).toContainText('risks', {
        timeout: 30_000,
      });
      await expect(page.getByTestId('property-designation-input')).toBeVisible({ timeout: 45_000 });
      await expect(page.getByTestId('gis-risk-map')).toBeVisible({ timeout: 45_000 });
      await page.getByTestId('property-designation-input').fill(createdPropertyDesignation);
      await expect(page.getByTestId('property-lookup-submit')).toBeEnabled();
    } finally {
      await api.dispose();
    }
  });

  test('API: tillståndsutkast via Vertex', async () => {
    test.skip(skipVertex, 'Endast tillåtet för lokal felsökning; P3 staging ska köra Vertex-flödet.');
    test.skip(!isExternalTarget, 'Endpointen finns inte alltid lokalt; verifieras i staging.');
    test.setTimeout(180_000);
    const api = await createApiContext();
    try {
      const state = await ensureP3Project();
      const res = await api.post(`/api/projects/${encodeURIComponent(state.projectId)}/permit/generate`, {
        headers: {
          ...(await adminAuthHeaders(api, state.accessToken)),
          'content-type': 'application/json',
        },
        data: {
          propertyDesignation: createdPropertyDesignation,
          sniCode: '38.21',
          sniDescription: 'Test',
          description: 'E2E genererat tillståndsutkast.',
          budget: 100000,
          latitude: p3Latitude,
          longitude: p3Longitude,
        },
      });
      const text = await res.text();
      expect(res.ok(), text.slice(0, 800)).toBeTruthy();
      const body = JSON.parse(text) as { ok?: boolean; application?: unknown };
      expect(body.ok).toBe(true);
      expect(body.application).toBeTruthy();
    } finally {
      await api.dispose();
    }
  });
});

test.describe('P3 metadata', () => {
  test('rapporterar miljö för beviskedja', async () => {
    // Hjälp vid felsökning i HTML-rapport
    const target = getE2EApiBaseUrl();
    const external = isExternalE2E();
    expect(target.length).toBeGreaterThan(10);
    test.info().annotations.push({
      type: 'p3-target',
      description: external ? `external E2E → ${target}` : `local E2E → ${target}`,
    });
  });
});
