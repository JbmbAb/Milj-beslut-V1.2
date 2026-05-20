/**
 * Staging E2E: Lokaliseringsutredning
 * Kör: npm run e2e:staging:localization
 */

import { expect, test } from '@playwright/test';
import {
  adminAuthHeaders,
  createApiContext,
  isExternalE2E,
  loginAsAdmin,
  parseJson,
} from './support';

const PROJECT_ID = String(process.env.E2E_LOC_PROJECT_ID ?? 'demo-project').trim();
const SITE = {
  id: 'E2E-ALT-1',
  name: 'Staging testplats',
  lat: Number(process.env.E2E_LOC_LAT ?? 59.33),
  lng: Number(process.env.E2E_LOC_LNG ?? 18.068),
};
const isExternalTarget = isExternalE2E();

let sharedToken = '';

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

test.describe('Staging: Lokaliseringsutredning', () => {
  test.skip(!isExternalTarget, 'Kräver staging-miljö (STAGING_URL).');
  test.describe.configure({ mode: 'serial' });

  test('generate-report: ok med siteAnalyses och dataSources', async () => {
    const api = await createApiContext();
    try {
      const token = await getToken();
      const headers = await adminAuthHeaders(api, token);
      const res = await api.post('/api/localization/generate-report', {
        headers: { ...headers, 'content-type': 'application/json' },
        data: { projectId: PROJECT_ID, siteAlternatives: [SITE] },
      });
      expect(res.ok(), await res.text()).toBeTruthy();
      const body = await parseJson<{
        ok?: boolean;
        siteAnalyses?: Array<{ dataSources?: unknown[] }>;
        summary?: { bestAlternativeId?: string };
      }>(res);
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
      const token = await getToken();
      const headers = await adminAuthHeaders(api, token);
      const res = await api.get(`/api/localization/${PROJECT_ID}/audit-trail`, { headers });
      expect(res.ok(), await res.text()).toBeTruthy();
      const body = await parseJson<{ referenceNumber?: string; entries?: unknown[] }>(res);
      expect(body.referenceNumber).toBe(`LOK-${PROJECT_ID}`);
      expect(Array.isArray(body.entries)).toBe(true);
    } finally {
      await api.dispose();
    }
  });
});
