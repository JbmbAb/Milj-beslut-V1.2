import { expect, test } from '@playwright/test';
import { createApiContext, primeAuthenticatedPage, waitForHubModuleReady } from './support';

/**
 * Konsult/projekt-resa: från start till Core-arbetsyta (teknisk hub).
 * E2E använder samma admin-session som övriga lokala tester (ingen separat BankID-roll i test-DB).
 */
test.describe('Role: consultant / office user — Core workspace', () => {
  test.setTimeout(180_000);
  test('inloggad användare når Core-kortet och öppnar arbetsyta', async ({ page }) => {
    const api = await createApiContext();
    try {
      await primeAuthenticatedPage(page, api);
      await page.goto('/');
      await waitForHubModuleReady(page, 'core');
      await page.getByTestId('landing-open-core').click();
      await expect(page.getByText(/Ansökningsflöde|MODULER REDO/i).first()).toBeVisible({ timeout: 20000 });
    } finally {
      await api.dispose();
    }
  });
});
