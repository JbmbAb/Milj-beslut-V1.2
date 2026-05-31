/**
 * Staging E2E: C-anmälan schaktmassor
 * Kör: npm run e2e:staging:c-mass
 */

import { expect, test } from '@playwright/test';
import {
  adminAuthHeaders,
  createApiContext,
  isExternalE2E,
  loginAsAdmin,
  parseJson,
} from './support';

const PROPERTY = String(process.env.E2E_CMASS_PROPERTY ?? 'NACKA BOO 1:2').trim();
const isExternalTarget = isExternalE2E();

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

test.describe('Staging: C-anmälan schaktmassor', () => {
  test.skip(!isExternalTarget, 'Kräver staging-miljö (STAGING_URL).');
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
      expect(['NOTIFICATION_REQUIRED', 'PERMIT_REQUIRED', 'EXEMPT']).toContain(body.gateDecision);
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
      const body = await parseJson<{ ok?: boolean; caseId?: string }>(res);
      expect(body.ok).toBe(true);
      sharedCaseId = String(body.caseId ?? '');
      expect(sharedCaseId.length).toBeGreaterThan(3);
    } finally {
      await api.dispose();
    }
  });

  test('export innehåller transportkedja och human-in-the-loop', async () => {
    expect(sharedCaseId.length).toBeGreaterThan(3);
    const api = await createApiContext();
    try {
      const token = await getToken();
      const headers = await adminAuthHeaders(api, token);
      await api.post('/api/c-notification/mass/generate-documents', {
        headers: { ...headers, 'content-type': 'application/json' },
        data: { caseId: sharedCaseId },
      });
      const res = await api.get(`/api/c-notification/mass/${encodeURIComponent(sharedCaseId)}/export`, {
        headers,
      });
      expect(res.ok(), await res.text()).toBeTruthy();
      const body = await parseJson<{
        export?: {
          humanInTheLoop?: string;
          decisions?: { mellanlagring?: unknown[]; deponi?: unknown[] };
        };
      }>(res);
      expect(body.export?.humanInTheLoop).toContain('verifiera');
      const totalOps =
        (body.export?.decisions?.mellanlagring ?? []).length +
        (body.export?.decisions?.deponi ?? []).length;
      expect(totalOps).toBeGreaterThanOrEqual(2);
    } finally {
      await api.dispose();
    }
  });
});
