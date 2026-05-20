import { expect, test } from '@playwright/test';
import { adminAuthHeaders, createApiContext, loginAsAdmin } from './support';

import { createTokenPair } from '../../server/security/auth';

test.describe('Security E2E', () => {

  test('should return 401 for admin endpoint without token', async ({ request }) => {
    const response = await request.get('/api/admin/projects');
    expect(response.status()).toBe(401);
  });

  test('should return 401 for admin endpoint with invalid token', async ({ request }) => {
    const response = await request.get('/api/admin/projects', {
      headers: {
        Authorization: 'Bearer invalidtoken',
      },
    });
    expect(response.status()).toBe(401);
  });

  test('should return 403 for admin endpoint with consultant token', async ({ request }) => {
    const consultantToken = createTokenPair({
      id: 'consultant-1',
      organisationId: 'org-1',
      bankidId: 'consultant:test',
      role: 'CONSULTANT',
    }).accessToken;

    const response = await request.get('/api/admin/projects', {
      headers: {
        Authorization: `Bearer ${consultantToken}`,
      },
    });
    expect(response.status()).toBe(403);
  });
});
