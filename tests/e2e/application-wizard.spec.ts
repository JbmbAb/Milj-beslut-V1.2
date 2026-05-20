import { expect, test, type Page } from '@playwright/test';
import { createApiContext, isExternalE2E, primeAuthenticatedPage } from './support';

const BROWSER_TIMEOUT = 180_000;

async function openProjectModule(page: Page): Promise<void> {
  await expect(page).toHaveTitle(/Milj.*beslut/i, { timeout: BROWSER_TIMEOUT });
  const projectCard = page.getByTestId('landing-open-projekt');
  await expect(projectCard).toBeVisible({ timeout: BROWSER_TIMEOUT });
  await expect(projectCard).toBeEnabled();
  await projectCard.click();
}

test.describe('Project manager workspace E2E', () => {
  test.setTimeout(BROWSER_TIMEOUT);
  test('user can open project manager and see plan workspace', async ({ page }) => {
    const api = await createApiContext();
    try {
      await primeAuthenticatedPage(page, api);
      await page.goto('/');
      await openProjectModule(page);
      await expect(page.getByTestId('workspace-active-tab-label')).toContainText('plan', {
        timeout: 30_000,
      });

      const planRoot = page.getByTestId('project-manager-plan');
      await expect(planRoot).toBeVisible({ timeout: 30_000 });
      await expect(planRoot.getByPlaceholder('Projektnamn...')).toBeVisible();
      await expect(planRoot.getByText(/Ansvars-spärrar \(Stop Gates\)/i)).toBeVisible();
      await expect(planRoot.getByRole('button', { name: /Föreslå Intressenter/i })).toBeVisible();
    } finally {
      await api.dispose();
    }
  });

  test('user sees project plan structure and archive panel', async ({ page }) => {
    const api = await createApiContext();
    try {
      await primeAuthenticatedPage(page, api);
      await page.goto('/');
      await openProjectModule(page);
      await expect(page.getByTestId('workspace-active-tab-label')).toContainText('plan', {
        timeout: 30_000,
      });

      const planRoot = page.getByTestId('project-manager-plan');
      await expect(planRoot).toBeVisible({ timeout: 30_000 });
      await expect(planRoot.getByPlaceholder('Projektnamn...')).toBeVisible();
      await expect(planRoot.getByText('Projektbeskrivning')).toBeVisible();
      const moduleReadiness = planRoot.getByRole('heading', { name: 'Integrated Module Readiness' });
      await moduleReadiness.scrollIntoViewIfNeeded();
      await expect(moduleReadiness).toBeVisible();
    } finally {
      await api.dispose();
    }
  });
});
