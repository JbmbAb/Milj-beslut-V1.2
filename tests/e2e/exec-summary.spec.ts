import { expect, test } from '@playwright/test';
import {
  adminAuthHeaders,
  createApiContext,
  E2E_SEEDED_PROJECT_ID,
  loginAsAdmin,
  parseJson,
} from './support';

test.describe('Executive Summary Queue', () => {
  test('enqueues, processes, and returns mock summary in CI', async () => {
    const api = await createApiContext();
    try {
      const token = await loginAsAdmin(api);
      const projectId = E2E_SEEDED_PROJECT_ID;

      const enqueue = await api.post(`/api/projects/${encodeURIComponent(projectId)}/exec-summary/enqueue`, {
        headers: await adminAuthHeaders(api, token),
      });
      expect(enqueue.ok(), await enqueue.text()).toBeTruthy();
      const enqueueBody = await parseJson<{ ok?: boolean; job?: { id?: string; status?: string } }>(enqueue);
      const jobId = String(enqueueBody.job?.id || '').trim();
      expect(jobId.length).toBeGreaterThan(5);
      expect(['QUEUED', 'RUNNING', 'DONE']).toContain(enqueueBody.job?.status);

      await expect
        .poll(
          async () => {
            const statusRes = await api.get(
              `/api/projects/${encodeURIComponent(projectId)}/exec-summary/status/${encodeURIComponent(jobId)}`,
              { headers: await adminAuthHeaders(api, token) },
            );
            if (!statusRes.ok()) return 'FAILED';
            const statusBody = await parseJson<{ job?: { status?: string } }>(statusRes);
            return statusBody.job?.status || 'UNKNOWN';
          },
          { timeout: 30_000 },
        )
        .toBe('DONE');

      const doneRes = await api.get(
        `/api/projects/${encodeURIComponent(projectId)}/exec-summary/status/${encodeURIComponent(jobId)}`,
        { headers: await adminAuthHeaders(api, token) },
      );
      expect(doneRes.ok()).toBeTruthy();
      const doneBody = await parseJson<{
        job?: {
          status?: string;
          result?: { summary?: string; keyRisks?: string[] };
        };
      }>(doneRes);
      expect(doneBody.job?.status).toBe('DONE');
      expect(doneBody.job?.result?.summary || '').toContain(`projekt ${projectId}`);
      expect(doneBody.job?.result?.keyRisks?.length || 0).toBeGreaterThan(0);
    } finally {
      await api.dispose();
    }
  });
});
