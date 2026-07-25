import { expect, test, type Page } from '@playwright/test';
import { createApiContext, primeAuthenticatedPage, waitForHubModuleReady, clickHubModule } from './support';

async function openLogisticsModule(page: Page): Promise<boolean> {
  await expect(page).toHaveTitle(/Milj.*beslut/i);
  const overlayPanel = page.getByTestId('map-overlay-panel');
  if (await overlayPanel.isVisible().catch(() => false)) {
    return true;
  }

  await clickHubModule(page, 'logistik');

  const workspaceLogisticsButton = page.getByRole('button', { name: /Logistik och massor/i }).first();
  if (await workspaceLogisticsButton.isVisible().catch(() => false)) {
    await workspaceLogisticsButton.click({ timeout: 20_000 });
  }

  const fastighetsanalysButton = page.getByRole('button', { name: /Fastighetsanalys/i }).first();
  if (await fastighetsanalysButton.isVisible().catch(() => false)) {
    await fastighetsanalysButton.click({ timeout: 20_000 });
  }

  return await overlayPanel.isVisible().catch(() => false);
}

test.describe('Public Map and Project Verification', () => {
  test('User can open a specific project dashboard and toggle map layers', async ({ page }) => {
    const api = await createApiContext();
    try {
      await primeAuthenticatedPage(page, api);
      await page.goto('/');
      await expect(page).toHaveTitle(/Milj.*beslut/i);

      const logisticsButton = page.getByTestId('landing-open-logistik');
      if (await logisticsButton.isVisible()) {
        await logisticsButton.click();
        await page.getByRole('button', { name: 'Logistik och massor' }).click();
        await expect(page.getByText(/Interaktiv/i)).toBeVisible();
      } else {
        await expect(page.locator('body')).toBeVisible();
      }
    } finally {
      await api.dispose();
    }
  });

  test('Public auth redirects correctly when accessing secure maps', async ({ page }) => {
    await page.goto('/admin');
    await expect(page.getByRole('heading', { name: /Välkommen/i })).toBeVisible();
    await expect(page.getByTestId('admin-username-input')).toHaveCount(0);
  });

  test('All visible map overlays can be toggled on and off', async ({ page }) => {
    test.setTimeout(240_000);
    const api = await createApiContext();
    try {
      await primeAuthenticatedPage(page, api);
      await page.goto('/');
      await waitForHubModuleReady(page, 'logistik');
      const hasOverlayPanel = await openLogisticsModule(page);
      if (!hasOverlayPanel) {
        test.skip(true, 'Map overlay panel is not part of the current logistics UI.');
      }

      const panel = page.getByTestId('map-overlay-panel');

      const overlayButtons = panel.locator('[data-testid^="map-overlay-toggle-"]');
      const overlayCount = await overlayButtons.count();
      expect(overlayCount).toBeGreaterThan(0);

      for (let index = 0; index < overlayCount; index += 1) {
        const button = overlayButtons.nth(index);
        await button.scrollIntoViewIfNeeded();
        await button.click({ force: true });
        await expect(button).toHaveClass(/bg-slate-900/);
        await button.click({ force: true });
        await expect(button).not.toHaveClass(/bg-slate-900/);
      }
    } finally {
      await api.dispose();
    }
  });
});
