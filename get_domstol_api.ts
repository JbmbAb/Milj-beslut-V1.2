import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  page.on('response', async response => {
    if (response.request().resourceType() === 'xhr' || response.request().resourceType() === 'fetch') {
       console.log('<<', response.status(), response.url());
       try {
         const text = await response.text();
         console.log('Response body:', text.substring(0, 500));
       } catch(e) {}
    }
  });

  await page.goto('https://www.domstol.se/sok/?query=&type=decision');
  
  console.log('Loaded. Clicking load more...');
  try {
     await page.click('button:has-text("Visa fler")');
     await page.waitForTimeout(3000);
  } catch (e) {
     console.log('Could not find Visa fler', e.message);
  }
  
  await browser.close();
})();
