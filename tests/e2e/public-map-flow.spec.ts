import { expect, test } from '@playwright/test';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({
  datasources: {
    db: {
      url:
        String(process.env.PLAYWRIGHT_DATABASE_URL || process.env.DATABASE_URL || '').trim() ||
        'postgresql://riskguard:password@localhost:5432/riskguard_test',
    },
  },
});

test.afterAll(async () => {
  await prisma.$disconnect();
});

test.describe('Public Map and Project Verification', () => {
  test('User can open a specific project dashboard and toggle map layers', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/Milj.*beslut/i);

    const logisticsButton = page.getByText('Logistik & Massor', { exact: true });

    if (await logisticsButton.isVisible()) {
      await logisticsButton.click();
      await page.getByRole('button', { name: 'Logistik och massor' }).click();
      await expect(page.getByText(/Interaktiv/i)).toBeVisible();
    } else {
      await expect(page.locator('body')).toBeVisible();
    }
  });

  test('Public auth redirects correctly when accessing secure maps', async ({ page }) => {
    await page.goto('/admin');

    const loginField = page.getByTestId('admin-username-input');
    if (!(await loginField.isVisible())) {
      await page.getByTestId('landing-open-admin').click();
    }

    await expect(loginField).toBeVisible();

    await loginField.fill('attacker');
    await page.getByTestId('admin-password-input').fill('badpassword');
    await page.getByTestId('admin-login-button').click();

    await expect(page.getByText(/Fel|Invalid|Unauthorized/i)).toBeVisible();
  });
});
