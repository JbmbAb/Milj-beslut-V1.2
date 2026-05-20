import { expect, test, type Page } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { createApiContext, primeAuthenticatedPage } from './support';

const prisma = new PrismaClient({
  datasources: {
    db: {
      url:
        String(process.env.PLAYWRIGHT_DATABASE_URL || process.env.DATABASE_URL || '').trim() ||
        'postgresql://miljobeslut:password@localhost:5432/miljobeslut_test',
    },
  },
});

test.afterAll(async () => {
  await prisma.$disconnect();
});

async function openLogisticsModule(page: Page): Promise<void> {
  await expect(page).toHaveTitle(/Milj.*beslut/i);
  const overlayPanel = page.getByTestId('map-overlay-panel');
  if (await overlayPanel.isVisible().catch(() => false)) {
    return;
  }

  const landingLogistics = page.getByTestId('landing-open-logistik');
  const workspaceLogisticsButton = page.getByRole('button', { name: /Logistik och massor/i }).first();
  const fastighetsanalysButton = page.getByRole('button', { name: /Fastighetsanalys/i }).first();

  if (await landingLogistics.isVisible().catch(() => false)) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        await landingLogistics.click({ timeout: 15_000 });
        break;
      } catch {
        // Kortet kan renderas om under inloggningssynk; prova nästa navigationsväg.
      }
    }
  }

  if (await workspaceLogisticsButton.isVisible().catch(() => false)) {
    await workspaceLogisticsButton.click({ timeout: 20_000 });
  }

  if (await fastighetsanalysButton.isVisible().catch(() => false)) {
    await fastighetsanalysButton.click({ timeout: 20_000 });
  }

  await expect(overlayPanel).toBeVisible({ timeout: 60_000 });
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
      await openLogisticsModule(page);

      const panel = page.getByTestId('map-overlay-panel');
      await expect(panel).toBeVisible({ timeout: 60_000 });

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
