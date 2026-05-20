import { expect, test } from '@playwright/test';
import { createApiContext, loginAsAdmin } from './support';

/**
 * Kritisk admin-resa: autentisering mot admin-API och läsning av systemstatus
 * (drift/observability utan att förutsätta staging-URL).
 */
test.describe('Role: admin — system status', () => {
  test('admin kan läsa /api/admin/app-status med giltig bearer-token', async () => {
    const api = await createApiContext();
    try {
      const token = await loginAsAdmin(api);
      const res = await api.get('/api/admin/app-status', {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.ok(), `expected 2xx, got ${res.status()}`).toBeTruthy();
      const body = (await res.json()) as { ok?: boolean };
      expect(body?.ok !== false).toBeTruthy();
    } finally {
      await api.dispose();
    }
  });
});
