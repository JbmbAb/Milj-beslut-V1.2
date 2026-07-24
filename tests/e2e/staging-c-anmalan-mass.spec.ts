/**
 * Staging E2E: C-anmälan schaktmassor (PDF-ready)
 * Kör: npm run e2e:staging:c-mass
 *
 * Scope: validate → operations → generate-documents → JSON-export + PDF-export.
 * Myndighetsinlämning (/submit) är medvetet deferred i detta flöde.
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

const PROPERTY = String(process.env.E2E_CMASS_PROPERTY ?? 'NACKA BOO 1:2').trim();

let sharedToken = '';
let sharedProjectId = '';
let sharedCaseId = '';

/** Skapar projekt om E2E_CMASS_PROJECT_ID saknas — admin blir då medlem. */
async function ensureMassProject(): Promise<{ token: string; projectId: string }> {
  const preset = String(process.env.E2E_CMASS_PROJECT_ID ?? '').trim();
  if (sharedToken && sharedProjectId) {
    return { token: sharedToken, projectId: sharedProjectId };
  }

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

test.describe('Staging: C-anmälan schaktmassor (PDF-ready)', () => {
  test.skip(!isStagingModuleE2ETarget(), 'Kräver staging eller E2E_ALLOW_LOCAL=true.');
  test.describe.configure({ mode: 'serial' });

  test('validate-codes: MPF gate för mellanlagring', async () => {
    const api = await createApiContext();
    try {
      const token = await getToken();
      const headers = await adminAuthHeaders(api, token);
      const res = await api.post('/api/c-notification/mass/validate-codes', {
        headers: { ...headers, 'content-type': 'application/json' },
        data: {
          propertyDesignation: PROPERTY,
          operationType: 'MELLANLAGRING',
          quantityPerYear: 12000,
          ewcCode: '17 05 08',
        },
      });
      expect(res.ok(), await res.text()).toBeTruthy();
      const body = await parseJson<{ gateDecision?: string }>(res);
      assertNoDemoOrFallback(body, 'mass validate-codes');
      expect(['NOTIFICATION_REQUIRED', 'PERMIT_REQUIRED', 'EXEMPT']).toContain(body.gateDecision);
    } finally {
      await api.dispose();
    }
  });

  test('property-search: fastighetsuppslag utan demo', async () => {
    const api = await createApiContext();
    try {
      const token = await getToken();
      const headers = await adminAuthHeaders(api, token);
      const res = await api.post('/api/c-notification/mass/property-search', {
        headers: { ...headers, 'content-type': 'application/json' },
        data: { propertyDesignation: PROPERTY },
      });
      expect([200, 404, 503]).toContain(res.status());
      if (res.ok()) {
        const body = await parseJson<{ ok?: boolean; result?: unknown }>(res);
        expect(body.ok).toBe(true);
        assertNoDemoOrFallback(body, 'mass property-search');
      }
    } finally {
      await api.dispose();
    }
  });

  test('gis-analysis: platsanalys med tolerant hantering vid saknad PostGIS', async () => {
    const api = await createApiContext();
    try {
      const { token, projectId } = await ensureMassProject();
      const headers = await adminAuthHeaders(api, token);
      const res = await api.post('/api/c-notification/mass/gis-analysis', {
        headers: { ...headers, 'content-type': 'application/json' },
        data: { projectId, propertyDesignation: PROPERTY },
      });
      expect([200, 404, 503]).toContain(res.status());
      if (res.ok()) {
        const body = await parseJson<{
          ok?: boolean;
          analysis?: { centroid?: { lat: number; lng: number } };
        }>(res);
        expect(body.ok).toBe(true);
        expect(body.analysis?.centroid?.lat).toBeTruthy();
      }
    } finally {
      await api.dispose();
    }
  });

  test('regulatory-classify: MPF/EWC-klassificering', async () => {
    const api = await createApiContext();
    try {
      const token = await getToken();
      const headers = await adminAuthHeaders(api, token);
      const res = await api.post('/api/c-notification/mass/regulatory-classify', {
        headers: { ...headers, 'content-type': 'application/json' },
        data: {
          lat: 59.33,
          lng: 18.07,
          ewcCode: '17 05 08',
          annualVolume: 12000,
        },
      });
      expect(res.ok(), await res.text()).toBeTruthy();
      const body = await parseJson<{ ok?: boolean; gateDecision?: string }>(res);
      expect(body.ok ?? body.gateDecision).toBeTruthy();
    } finally {
      await api.dispose();
    }
  });

  test('operations: skapa ärende med mellanlagring och deponi', async () => {
    const api = await createApiContext();
    try {
      const { token, projectId } = await ensureMassProject();
      const headers = await adminAuthHeaders(api, token);
      const res = await api.post('/api/c-notification/mass/operations', {
        headers: { ...headers, 'content-type': 'application/json' },
        data: {
          projectId,
          propertyDesignation: PROPERTY,
          operations: [
            {
              operationType: 'MELLANLAGRING',
              ewcCode: '17 05 08',
              quantityPerYear: 12000,
              receiverName: 'Staging Mottagare',
              capacityM3: 5000,
            },
            {
              operationType: 'DEPONI',
              ewcCode: '17 05 03*',
              quantityPerYear: 20,
              receiverName: 'Staging Deponi',
              capacityM3: 8000,
            },
          ],
        },
      });
      expect(res.ok(), await res.text()).toBeTruthy();
      const body = await parseJson<{ ok?: boolean; caseId?: string; status?: string }>(res);
      expect(body.ok).toBe(true);
      assertNoDemoOrFallback(body, 'mass operations');
      sharedCaseId = String(body.caseId ?? '');
      expect(sharedCaseId.length).toBeGreaterThan(3);
      expect(body.status).not.toBe('SUBMITTED');
    } finally {
      await api.dispose();
    }
  });

  test('generate-documents: förbered export (PDF-ready, ej submit)', async () => {
    expect(sharedCaseId.length).toBeGreaterThan(3);
    const api = await createApiContext();
    try {
      const token = await getToken();
      const headers = await adminAuthHeaders(api, token);
      const res = await api.post('/api/c-notification/mass/generate-documents', {
        headers: { ...headers, 'content-type': 'application/json' },
        data: { caseId: sharedCaseId },
      });
      expect(res.ok(), await res.text()).toBeTruthy();
      const body = await parseJson<{ ok?: boolean; documents?: unknown }>(res);
      expect(body.ok).toBe(true);
      assertNoDemoOrFallback(body, 'mass generate-documents');
    } finally {
      await api.dispose();
    }
  });

  test('JSON-export: transportkedja och human-in-the-loop', async () => {
    expect(sharedCaseId.length).toBeGreaterThan(3);
    const api = await createApiContext();
    try {
      const token = await getToken();
      const headers = await adminAuthHeaders(api, token);
      const res = await api.get(`/api/c-notification/mass/${encodeURIComponent(sharedCaseId)}/export`, {
        headers,
      });
      expect(res.ok(), await res.text()).toBeTruthy();
      const body = await parseJson<{
        export?: {
          humanInTheLoop?: string;
          status?: string;
          decisions?: { mellanlagring?: unknown[]; deponi?: unknown[] };
        };
      }>(res);
      assertNoDemoOrFallback(body, 'mass JSON export');
      assertHumanInTheLoopText(body.export?.humanInTheLoop ?? '', 'mass JSON export');
      expect(body.export?.status).not.toBe('SUBMITTED');
      const totalOps =
        (body.export?.decisions?.mellanlagring ?? []).length + (body.export?.decisions?.deponi ?? []).length;
      expect(totalOps).toBeGreaterThanOrEqual(2);
    } finally {
      await api.dispose();
    }
  });

  test('export-pdf: utskriftsbar PDF för utskrift (slutsteg PDF-ready)', async () => {
    expect(sharedCaseId.length).toBeGreaterThan(3);
    const api = await createApiContext();
    try {
      const token = await getToken();
      const headers = await adminAuthHeaders(api, token);
      const res = await api.get(`/api/c-notification/mass/${encodeURIComponent(sharedCaseId)}/export-pdf`, {
        headers,
      });
      if (!res.ok()) {
        throw new Error(`mass export-pdf: ${res.status()} ${await res.text()}`);
      }
      await assertPrintablePdfResponse(res, 'mass export-pdf');
    } finally {
      await api.dispose();
    }
  });

  test('audit-trail: spår efter generate/export (submit deferred)', async () => {
    expect(sharedCaseId.length).toBeGreaterThan(3);
    const api = await createApiContext();
    try {
      const token = await getToken();
      const headers = await adminAuthHeaders(api, token);
      const res = await api.get(`/api/c-notification/mass/${encodeURIComponent(sharedCaseId)}/audit-trail`, {
        headers,
      });
      expect(res.ok(), await res.text()).toBeTruthy();
      const body = await parseJson<{ entries?: unknown[]; referenceNumber?: string }>(res);
      expect(Array.isArray(body.entries)).toBe(true);
      expect(body.referenceNumber?.length).toBeGreaterThan(3);
    } finally {
      await api.dispose();
    }
  });
});
