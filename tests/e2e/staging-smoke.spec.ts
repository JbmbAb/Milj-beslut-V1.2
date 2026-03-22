import { expect, test } from '@playwright/test';
import { createApiContext, getE2EAdminCredentials, loginAsAdmin, parseJson } from './support';

async function openAdminModule(page: import('@playwright/test').Page) {
  const legacyButton = page.getByTestId('landing-open-admin');
  if (await legacyButton.count()) {
    await legacyButton.first().click();
    return;
  }

  await page.getByText('Administrator', { exact: true }).click();
}

async function loginThroughAdminUiIfNeeded(page: import('@playwright/test').Page) {
  const creds = getE2EAdminCredentials();
  const loadProjectsButton = page.getByRole('button', { name: /Ladda projekt/i });
  if ((await loadProjectsButton.count()) && (await loadProjectsButton.isEnabled())) {
    return;
  }

  const usernameInput = (await page.getByTestId('admin-username-input').count())
    ? page.getByTestId('admin-username-input')
    : page.getByPlaceholder(/Anv/i);
  const passwordInput = (await page.getByTestId('admin-password-input').count())
    ? page.getByTestId('admin-password-input')
    : page.locator('input[type="password"]').first();

  if (await usernameInput.count()) {
    await usernameInput.fill(creds.username);
    await passwordInput.fill(creds.password);
    await page.getByRole('button', { name: /Logga in/i }).click();
    if (await page.getByTestId('admin-status-info').count()) {
      await expect(page.getByTestId('admin-status-info')).toContainText(
        /inloggad|projektlista laddad|katalog laddad/i,
      );
    }
    await expect(loadProjectsButton).toBeEnabled();
  } else {
    await page.getByText('Admin inloggning och session', { exact: false }).waitFor();
    await page.getByPlaceholder(/Anv/i).fill(creds.username);
    await page.locator('input[type="password"]').first().fill(creds.password);
    await page.getByRole('button', { name: /Logga in/i }).click();
    await expect(loadProjectsButton).toBeEnabled();
  }
}

test('staging smoke: health endpoints answer', async () => {
  const api = await createApiContext();
  try {
    const health = await api.get('/health');
    expect(health.ok()).toBeTruthy();

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
      headers: { Authorization: `Bearer ${token}` },
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
      headers: { Authorization: `Bearer ${token}` },
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
          Authorization: `Bearer ${token}`,
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
      headers: { Authorization: `Bearer ${token}` },
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
  await openAdminModule(page);
  await page.getByRole('button', { name: /Analys och compliance/i }).click();
  await expect(page.getByText(/Admin inloggning och session/i)).toBeVisible();
  await loginThroughAdminUiIfNeeded(page);
  await expect(page.getByRole('button', { name: /Ladda projekt/i })).toBeEnabled();
});
