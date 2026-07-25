import { expect, test } from '@playwright/test';
import { injectAxe, checkA11y } from 'axe-playwright';
import {
  adminAuthHeaders,
  createApiContext,
  expectAdminLoginScreen,
  loginAsAdmin,
  parseJson,
  primeAuthenticatedPage,
} from './support';

async function openAdminModule(page: import('@playwright/test').Page) {
  const legacyButton = page.getByTestId('landing-open-admin');
  if (await legacyButton.count()) {
    await legacyButton.first().click();
    return;
  }

  await page.getByText('Administrator', { exact: true }).click();
}

test('staging smoke: health endpoints answer', async () => {
  const api = await createApiContext();
  try {
    const health = await api.get('/health');
    expect(health.ok()).toBeTruthy();

    const ready = await api.get('/ready');
    expect(ready.ok()).toBeTruthy();

    const datasources = await api.get('/api/datasources/health');
    expect(datasources.ok()).toBeTruthy();
  } finally {
    await api.dispose();
  }
});

test('staging smoke: admin login and protected project flow work', async () => {
  const api = await createApiContext();
  try {
    const token = await loginAsAdmin(api);

    const createProject = await api.post('/api/admin/projects', {
      headers: await adminAuthHeaders(api, token),
      data: {
        propertyDesignation: `SMOKE-${Date.now()}`,
      },
    });
    expect(createProject.ok()).toBeTruthy();
    const createPayload = await parseJson<{ project?: { id?: string } }>(createProject);
    const projectId = String(createPayload.project?.id || '').trim();
    expect(projectId).not.toBe('');

    const loadPlan = await api.get(`/api/projects/${encodeURIComponent(projectId)}/plan`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(loadPlan.ok()).toBeTruthy();
  } finally {
    await api.dispose();
  }
});

test('staging smoke: document upload, view, download and delete work', async () => {
  const api = await createApiContext();
  try {
    const token = await loginAsAdmin(api);

    const createProject = await api.post('/api/admin/projects', {
      headers: await adminAuthHeaders(api, token),
      data: {
        propertyDesignation: `SMOKE-DOC-${Date.now()}`,
      },
    });
    expect(createProject.ok()).toBeTruthy();
    const createPayload = await parseJson<{ project?: { id?: string } }>(createProject);
    const projectId = String(createPayload.project?.id || '').trim();
    expect(projectId).not.toBe('');

    const upload = await api.post(
      `/api/documents/upload?projectId=${encodeURIComponent(projectId)}&originalName=${encodeURIComponent('staging-smoke.txt')}&subject=${encodeURIComponent('Staging smoke document')}`,
      {
        headers: {
          ...(await adminAuthHeaders(api, token)),
          'Content-Type': 'text/plain',
        },
        data: Buffer.from('staging smoke upload'),
      },
    );
    expect(upload.status()).toBe(201);
    const uploadPayload = await parseJson<{ document?: { id?: string } }>(upload);
    const documentId = String(uploadPayload.document?.id || '').trim();
    expect(documentId).not.toBe('');

    const view = await api.get(`/api/documents/${encodeURIComponent(documentId)}/view`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(view.ok()).toBeTruthy();
    expect(await view.text()).toContain('staging smoke upload');

    const download = await api.get(`/api/documents/${encodeURIComponent(documentId)}/download`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(download.ok()).toBeTruthy();
    expect(String(download.headers()['content-disposition'] || '')).toContain('attachment;');

    const remove = await api.delete(`/api/documents/${encodeURIComponent(documentId)}`, {
      headers: await adminAuthHeaders(api, token),
    });
    expect(remove.ok()).toBeTruthy();
    const removePayload = await parseJson<{ ok?: boolean }>(remove);
    expect(removePayload.ok).toBe(true);
  } finally {
    await api.dispose();
  }
});

test('staging smoke: admin login UI still works', async ({ page }) => {
  await page.goto('/');
  await expectAdminLoginScreen(page);
});

test('staging smoke: landing page accessible (WCAG 2.1 AA)', async ({ page }) => {
  const api = await createApiContext();
  try {
    await primeAuthenticatedPage(page, api);
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Inject axe and run accessibility checks
    await injectAxe(page);
    await checkA11y(page, null, {
      detailedReport: true,
      detailedReportOptions: { html: true },
    });
  } finally {
    await api.dispose();
  }
});

test('staging smoke: admin module accessible (WCAG 2.1 AA)', async ({ page }) => {
  const api = await createApiContext();
  try {
    await primeAuthenticatedPage(page, api);
    await page.goto('/');
    await openAdminModule(page);
    await page.waitForLoadState('networkidle');

    // Inject axe and run accessibility checks
    await injectAxe(page);
    await checkA11y(page, null, {
      detailedReport: true,
      detailedReportOptions: { html: true },
    });
  } finally {
    await api.dispose();
  }
});
