/**
 * tests/e2e/staging-enskilt-avlopp.spec.ts
 *
 * Staging-bevisflöde för "Enskilt avlopp" (PDF-ready) — körs mot staging-miljön med äkta data.
 * Kör: npm run e2e:staging:avlopp
 *
 * Scope: utkast → handläggning → beslut → export JSON + dossier-PDF för utskrift.
 * Myndighetsinlämning till kommun är medvetet deferred.
 *
 * Täcker E2E-validering för enskilt avlopp:
 *   1. API-flöde utan fallback-mock
 *   2. Statusövergångar: utkast → handläggning → beslut
 *   3. Validering av obligatoriska fält, koordinater och mottagare
 *   4. Export/underlagssteg med spårbarhet och utskriftsbar PDF
 *   5. Rollbaserad åtkomst (admin vs övriga roller)
 */

import { expect, test } from '@playwright/test';
import {
  adminAuthHeaders,
  assertHumanInTheLoopText,
  assertNoDemoOrFallback,
  assertPrintablePdfResponse,
  createApiContext,
  isStagingModuleE2ETarget,
  loginAsAdmin,
  parseJson,
} from './support';

function envString(name: string, fallback: string): string {
  return String(process.env[name] ?? '').trim() || fallback;
}

const PROPERTY_DESIGNATION = envString('E2E_AVLOPP_PROPERTY', 'NACKA BOO 1:2');
const LATITUDE = parseFloat(envString('E2E_AVLOPP_LATITUDE', '59.330'));
const LONGITUDE = parseFloat(envString('E2E_AVLOPP_LONGITUDE', '18.068'));

let sharedToken = '';
let sharedApplicationId = '';

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

async function ensureApplication(): Promise<{ token: string; applicationId: string }> {
  if (sharedToken && sharedApplicationId) return { token: sharedToken, applicationId: sharedApplicationId };

  const api = await createApiContext();
  try {
    const token = await getToken();
    const headers = await adminAuthHeaders(api, token);

    const res = await api.post('/api/sewage/applications', {
      headers: { ...headers, 'content-type': 'application/json' },
      data: {
        propertyDesignation: PROPERTY_DESIGNATION,
        latitude: LATITUDE,
        longitude: LONGITUDE,
        applicantName: 'E2E Staging Testperson',
        applicantEmail: 'staging-e2e@example.invalid',
        systemType: 'INFILTRATION',
        purpose: 'staging_e2e_enskilt_avlopp',
        _source: 'staging-e2e',
      },
    });
    expect(res.ok(), `Skapa ansökan: ${res.status()} ${await res.text()}`).toBeTruthy();
    const body = await parseJson<{ ok?: boolean; application?: { id?: string } }>(res);
    expect(body.ok, 'Skapa ansökan: ok=false').toBe(true);
    assertNoDemoOrFallback(body, 'sewage create');
    sharedApplicationId = String(body.application?.id ?? '');
    expect(sharedApplicationId.length, 'Saknar application.id').toBeGreaterThan(3);
    return { token, applicationId: sharedApplicationId };
  } finally {
    await api.dispose();
  }
}

test.describe('Staging: Enskilt avlopp (PDF-ready)', () => {
  test.skip(!isStagingModuleE2ETarget(), 'Kräver staging eller E2E_ALLOW_LOCAL=true.');
  test.describe.configure({ mode: 'serial' });

  test('1. API-flöde: skapa ansökan utan mock', async () => {
    const { applicationId } = await ensureApplication();
    expect(applicationId.length).toBeGreaterThan(3);

    const api = await createApiContext();
    try {
      const token = await getToken();
      const headers = await adminAuthHeaders(api, token);
      const res = await api.get(`/api/sewage/applications/${encodeURIComponent(applicationId)}`, {
        headers,
      });
      expect(res.ok(), await res.text()).toBeTruthy();
      const body = await parseJson<{
        ok?: boolean;
        application?: { status?: string; _demo?: boolean };
      }>(res);
      expect(body.ok).toBe(true);
      assertNoDemoOrFallback(body, 'sewage application');
      expect(body.application?._demo, 'Demo-flagga FÅR INTE vara satt i staging').not.toBe(true);
      expect(['DRAFT', 'SUBMITTED', 'IN_REVIEW']).toContain(body.application?.status);
    } finally {
      await api.dispose();
    }
  });

  test('2. Statusövergång: utkast → handläggning', async () => {
    const { token, applicationId } = await ensureApplication();
    const api = await createApiContext();
    try {
      const headers = await adminAuthHeaders(api, token);
      const res = await api.patch(`/api/sewage/applications/${encodeURIComponent(applicationId)}/status`, {
        headers: { ...headers, 'content-type': 'application/json' },
        data: { status: 'IN_REVIEW' },
      });
      expect(
        res.ok() || res.status() === 200,
        `Statusövergång IN_REVIEW: ${res.status()} ${await res.text()}`,
      ).toBeTruthy();
      const body = await parseJson<{ ok?: boolean; status?: string }>(res);
      expect(body.ok ?? body.status === 'IN_REVIEW').toBeTruthy();
    } finally {
      await api.dispose();
    }
  });

  test('2. Statusövergång: handläggning → beslut', async () => {
    const { token, applicationId } = await ensureApplication();
    const api = await createApiContext();
    try {
      const headers = await adminAuthHeaders(api, token);
      const res = await api.patch(`/api/sewage/applications/${encodeURIComponent(applicationId)}/status`, {
        headers: { ...headers, 'content-type': 'application/json' },
        data: { status: 'DECISION', decisionNote: 'Staging E2E godkänd' },
      });
      expect(
        res.ok() || res.status() === 200,
        `Statusövergång DECISION: ${res.status()} ${await res.text()}`,
      ).toBeTruthy();
      const body = await parseJson<{ ok?: boolean; status?: string }>(res);
      expect(body.ok ?? body.status === 'DECISION').toBeTruthy();
    } finally {
      await api.dispose();
    }
  });

  test('3. Validering: saknade obligatoriska fält returnerar 400', async () => {
    const api = await createApiContext();
    try {
      const token = await getToken();
      const headers = await adminAuthHeaders(api, token);

      const res = await api.post('/api/sewage/applications', {
        headers: { ...headers, 'content-type': 'application/json' },
        data: { systemType: 'INFILTRATION' },
      });
      expect([400, 422]).toContain(res.status());
    } finally {
      await api.dispose();
    }
  });

  test('3. Validering: ogiltiga koordinater utanför Sverige returnerar fel', async () => {
    const api = await createApiContext();
    try {
      const token = await getToken();
      const headers = await adminAuthHeaders(api, token);

      const res = await api.post('/api/sewage/applications', {
        headers: { ...headers, 'content-type': 'application/json' },
        data: {
          propertyDesignation: PROPERTY_DESIGNATION,
          latitude: 0,
          longitude: 0,
          applicantName: 'Fel Koordinatperson',
          applicantEmail: 'fail@example.invalid',
          systemType: 'INFILTRATION',
        },
      });
      expect([400, 422]).toContain(res.status());
    } finally {
      await api.dispose();
    }
  });

  test('3b. validate: körs på befintlig ansökan', async () => {
    const { token, applicationId } = await ensureApplication();
    const api = await createApiContext();
    try {
      const headers = await adminAuthHeaders(api, token);
      const res = await api.post(`/api/sewage/applications/${encodeURIComponent(applicationId)}/validate`, {
        headers: { ...headers, 'content-type': 'application/json' },
        data: {},
      });
      expect(res.ok(), await res.text()).toBeTruthy();
      const body = await parseJson<{ ok?: boolean; valid?: boolean; issues?: unknown[] }>(res);
      expect(body.ok).toBe(true);
      expect(typeof body.valid).toBe('boolean');
    } finally {
      await api.dispose();
    }
  });

  test('3c. generate-documents: förbereder underlag utan submit', async () => {
    const { token, applicationId } = await ensureApplication();
    const api = await createApiContext();
    try {
      const headers = await adminAuthHeaders(api, token);
      const res = await api.post(
        `/api/sewage/applications/${encodeURIComponent(applicationId)}/generate-documents`,
        {
          headers: { ...headers, 'content-type': 'application/json' },
          data: {},
        },
      );
      expect(res.ok(), await res.text()).toBeTruthy();
      const body = await parseJson<{ ok?: boolean; documents?: unknown }>(res);
      expect(body.ok).toBe(true);
      assertNoDemoOrFallback(body, 'sewage generate-documents');
    } finally {
      await api.dispose();
    }
  });

  test('4. JSON-export: human-in-the-loop i underlag', async () => {
    const { token, applicationId } = await ensureApplication();
    const api = await createApiContext();
    try {
      const headers = await adminAuthHeaders(api, token);
      const res = await api.get(`/api/sewage/applications/${encodeURIComponent(applicationId)}/export`, {
        headers,
      });
      expect(res.status(), await res.text()).toBe(200);
      const body = await parseJson<{ ok?: boolean; export?: { humanInTheLoop?: string } }>(res);
      expect(body.ok).toBe(true);
      assertNoDemoOrFallback(body, 'sewage JSON export');
      assertHumanInTheLoopText(body.export?.humanInTheLoop ?? '', 'sewage JSON export');
    } finally {
      await api.dispose();
    }
  });

  test('4. dossier-PDF: utskriftsbar PDF (slutsteg PDF-ready)', async () => {
    const { token, applicationId } = await ensureApplication();
    const api = await createApiContext();
    try {
      const headers = await adminAuthHeaders(api, token);
      const res = await api.get(`/api/sewage/applications/${encodeURIComponent(applicationId)}/dossier`, {
        headers,
      });
      if (!res.ok()) {
        throw new Error(`sewage dossier: ${res.status()} ${await res.text()}`);
      }
      await assertPrintablePdfResponse(res, 'sewage dossier');
    } finally {
      await api.dispose();
    }
  });

  test('5. Rollbaserad åtkomst: anonymt anrop nekas', async () => {
    const { applicationId } = await ensureApplication();
    const api = await createApiContext();
    try {
      const res = await api.get(`/api/sewage/applications/${encodeURIComponent(applicationId)}`);
      expect([401, 403]).toContain(res.status());
    } finally {
      await api.dispose();
    }
  });

  test('5. Rollbaserad åtkomst: CSRF-token krävs för mutationsanrop', async () => {
    const { token, applicationId } = await ensureApplication();
    const api = await createApiContext();
    try {
      const res = await api.patch(`/api/sewage/applications/${encodeURIComponent(applicationId)}/status`, {
        headers: {
          Authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        data: { status: 'DECISION' },
      });
      expect([400, 403]).toContain(res.status());
    } finally {
      await api.dispose();
    }
  });

  test('5. Audit trail: spår efter status/export (submit deferred)', async () => {
    const { token, applicationId } = await ensureApplication();
    const api = await createApiContext();
    try {
      const headers = await adminAuthHeaders(api, token);
      const res = await api.get(`/api/sewage/applications/${encodeURIComponent(applicationId)}/audit-trail`, {
        headers,
      });
      expect(res.ok(), await res.text()).toBeTruthy();
      const body = await parseJson<{ ok?: boolean; entries?: unknown[]; referenceNumber?: string }>(res);
      expect(body.ok).toBe(true);
      expect(Array.isArray(body.entries)).toBe(true);
      expect(body.referenceNumber?.length).toBeGreaterThan(3);
    } finally {
      await api.dispose();
    }
  });
});
