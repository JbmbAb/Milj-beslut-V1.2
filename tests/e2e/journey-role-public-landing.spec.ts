import { expect, test } from '@playwright/test';

/**
 * Offentlig/anonym resa: landningssida utan tokens i localStorage.
 */
test.describe('Role: public — landing', () => {
  test('anonym besökare ser landningssidan och ingen admin-formulär-debug', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/Milj.*beslut/i);
    await expect(page.locator('body')).toBeVisible();
    await expect(page.getByTestId('admin-username-input')).toHaveCount(0);
  });
});
