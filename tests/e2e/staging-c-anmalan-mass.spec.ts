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
const PROJECT_ID = String(process.env.E2E_CMASS_PROJECT_ID ?? 'demo-project').trim();
const isExternalTarget = isExternalE2E();

let sharedToken = '';
let sharedCaseId = '';

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
      const token = await getToken();
      const headers = await adminAuthHeaders(api, token);
      const res = await api.post('/api/c-notification/mass/operations', {
        headers: { ...headers, 'content-type': 'application/json' },
        data: {
          projectId: PROJECT_ID,
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
        export?: { humanInTheLoop?: string; operations?: unknown[] };
      }>(res);
      expect(body.export?.humanInTheLoop).toContain('verifiera');
      expect((body.export?.operations ?? []).length).toBeGreaterThanOrEqual(2);
    } finally {
      await api.dispose();
    }
  });
});
