/**
 * Staging E2E: Lokaliseringsutredning
 * Kör: npm run e2e:staging:localization
 *
 * Kräver extern miljö:
 *   STAGING_URL eller PLAYWRIGHT_BASE_URL (frontend/API-bas)
 *   E2E_ADMIN_USERNAME / E2E_ADMIN_PASSWORD (eller ADMIN_CONSOLE_*)
 *
 * Valfritt:
 *   E2E_LOC_PROJECT_ID — befintligt projekt (annars skapas via /api/admin/projects)
 *   E2E_LOC_PROPERTY — fastighet vid projektskapande
 *   E2E_LOC_LAT / E2E_LOC_LNG — testkoordinat
 */

import { expect, test } from '@playwright/test';
import {
  adminAuthHeaders,
  createApiContext,
  getE2EApiBaseUrl,
  isExternalE2E,
  loginAsAdmin,
  parseJson,
} from './support';

function envString(name: string, fallback = ''): string {
  const value = String(process.env[name] ?? '').trim();
  return value || fallback;
}

const PROPERTY = envString('E2E_LOC_PROPERTY', 'NACKA BOO 1:2');
const SITE = {
  id: 'E2E-ALT-1',
  name: 'Staging testplats',
  lat: Number(envString('E2E_LOC_LAT', '59.33')),
  lng: Number(envString('E2E_LOC_LNG', '18.068')),
};

const resolvedApiBaseUrl = getE2EApiBaseUrl();
const isLocalTarget = /127\.0\.0\.1|localhost/i.test(resolvedApiBaseUrl);
const isExternalTarget = isExternalE2E() && !isLocalTarget;

let sharedToken = '';
let sharedProjectId = '';

async function getToken(): Promise<string> {
  if (sharedToken) return sharedToken;
  const api = await createApiContext();
  try {
    sharedToken = await loginAsAdmin(api);
    return sharedToken;
  } finally {
    await api.dispose();
  }
}

/** Skapar projekt om E2E_LOC_PROJECT_ID saknas — admin blir då medlem. */
async function ensureLocalizationProject(): Promise<{ token: string; projectId: string }> {
  if (sharedToken && sharedProjectId) {
    return { token: sharedToken, projectId: sharedProjectId };
  }

  const preset = envString('E2E_LOC_PROJECT_ID');
  const api = await createApiContext();
  try {
    const token = await getToken();
    if (preset) {
      sharedProjectId = preset;
      return { token, projectId: preset };
    }

    const headers = await adminAuthHeaders(api, token);
    const created = await api.post('/api/admin/projects', {
      headers: { ...headers, 'content-type': 'application/json' },
      data: { propertyDesignation: PROPERTY },
    });
    expect(created.ok(), `Skapa projekt: ${created.status()} ${await created.text()}`).toBeTruthy();
    const body = await parseJson<{ project?: { id?: string } }>(created);
    sharedProjectId = String(body.project?.id ?? '');
    expect(sharedProjectId.length, 'Saknar project.id efter skapande').toBeGreaterThan(3);
    return { token, projectId: sharedProjectId };
  } finally {
    await api.dispose();
  }
}

function formatApiError(status: number, text: string): string {
  if (status === 503 && text.includes('LOCALIZATION_DATA_UNAVAILABLE')) {
    return `${status} ${text} — strikt läge: för många externa datakällor (NVR/RAA/VISS/SLU) otillgängliga i staging.`;
  }
  if (status === 403 || text.toLowerCase().includes('project')) {
    return `${status} ${text} — kontrollera E2E_LOC_PROJECT_ID eller att admin skapar projekt via /api/admin/projects.`;
  }
  return `${status} ${text}`;
}

test.describe('Staging: Lokaliseringsutredning', () => {
  test.skip(
    !isExternalTarget,
    `Kräver staging (STAGING_URL/PLAYWRIGHT_BASE_URL, inte localhost). API-bas: ${resolvedApiBaseUrl}`,
  );
  test.describe.configure({ mode: 'serial' });

  test('generate-report: ok med siteAnalyses och dataSources', async () => {
    const api = await createApiContext();
    try {
      const { token, projectId } = await ensureLocalizationProject();
      const headers = await adminAuthHeaders(api, token);
      const res = await api.post('/api/localization/generate-report', {
        headers: { ...headers, 'content-type': 'application/json' },
        data: { projectId, siteAlternatives: [SITE] },
      });
      const text = await res.text();
      expect(res.ok(), formatApiError(res.status(), text)).toBeTruthy();
      const body = JSON.parse(text) as {
        ok?: boolean;
        siteAnalyses?: Array<{ dataSources?: unknown[] }>;
        summary?: { bestAlternativeId?: string };
        warnings?: string[];
      };
      expect(body.ok).toBe(true);
      expect(body.siteAnalyses?.length).toBeGreaterThan(0);
      expect(body.siteAnalyses?.[0]?.dataSources?.length).toBeGreaterThan(0);
      expect(body.summary?.bestAlternativeId).toBeTruthy();
    } finally {
      await api.dispose();
    }
  });

  test('audit-trail: referens LOK-{projectId}', async () => {
    const api = await createApiContext();
    try {
      const { token, projectId } = await ensureLocalizationProject();
      const headers = await adminAuthHeaders(api, token);
      const res = await api.get(`/api/localization/${projectId}/audit-trail`, { headers });
      const text = await res.text();
      expect(res.ok(), formatApiError(res.status(), text)).toBeTruthy();
      const body = JSON.parse(text) as { referenceNumber?: string; entries?: unknown[] };
      expect(body.referenceNumber).toBe(`LOK-${projectId}`);
      expect(Array.isArray(body.entries)).toBe(true);
      expect(body.entries?.length).toBeGreaterThan(0);
    } finally {
      await api.dispose();
    }
  });
});
