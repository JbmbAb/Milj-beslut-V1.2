import { test, expect } from '@playwright/test';
import { loginAsAdmin } from './helpers/login';

test.describe('Executive Summary Queue', () => {
  // Logga in som admin före varje test i denna svit
  loginAsAdmin();

  test('should enqueue, process, and display a mock executive summary', async ({ page }) => {
    // Sätt miljövariabeln för att aktivera mock-läget för just detta test.
    // Detta är en kraftfull Playwright-funktion som låter oss styra backend-beteende.
    await page.addInitScript(() => {
      (window as any).playwright_set_env = { EXEC_SUMMARY_MOCK_MODE: 'true' };
    });

    // 1. Gå till ett befintligt projekt (ID från seed-data)
    await page.goto('/projects/clxodd6wg000008l463w1d2f4');

    // Hitta "Exekutiv Sammanfattning"-sektionen
    const summaryCard = page.getByTestId('exec-summary-card');
    await expect(summaryCard).toBeVisible();

    // 2. Klicka på knappen för att köa ett nytt jobb
    const enqueueButton = summaryCard.getByRole('button', { name: 'Generera Sammanfattning' });
    await enqueueButton.click();

    // 3. Vänta på att statusen blir "QUEUED" eller "RUNNING"
    // Detta bekräftar att API-anropet för att köa jobbet lyckades.
    await expect(summaryCard.getByText(/Status: (QUEUED|RUNNING)/)).toBeVisible({ timeout: 10000 });
    await expect(enqueueButton).toBeDisabled();

    // 4. Vänta på att jobbet ska slutföras och statusen bli "DONE"
    // Playwright kommer automatiskt att "polla" här tills texten syns eller en timeout nås.
    await expect(summaryCard.getByText('Status: DONE')).toBeVisible({ timeout: 20000 });

    // 5. Verifiera att resultatet från vårt mock-läge visas korrekt
    // Detta bekräftar att hela bakgrundsprocessen har kört klart.
    const summaryText = summaryCard.getByTestId('summary-text');
    const keyRisksList = summaryCard.getByTestId('key-risks-list');

    // Innehållet ska matcha exakt det vi definierade i `execSummaryQueueService.ts`
    await expect(summaryText).toContainText(
      'Detta är en mock-sammanfattning för projekt clxodd6wg000008l463w1d2f4.',
    );
    await expect(keyRisksList.getByRole('listitem').first()).toContainText(
      'Mock-risk: Beroende av externa system',
    );
    await expect(keyRisksList.getByRole('listitem').last()).toContainText(
      'Mock-risk: Ofullständig datainmatning',
    );

    // 6. Verifiera att "Generera"-knappen nu är återaktiverad
    await expect(enqueueButton).toBeEnabled();

    // 7. (Bonus) Verifiera att en ny generering inte startar direkt,
    // eftersom det redan finns ett färdigt resultat.
    await enqueueButton.click();
    // Status ska förbli "DONE" eftersom systemet återanvänder det färdiga resultatet.
    // Vi lägger en kort väntan för att säkerställa att inget hinner ändras.
    await page.waitForTimeout(500);
    await expect(summaryCard.getByText('Status: DONE')).toBeVisible();
  });
});
