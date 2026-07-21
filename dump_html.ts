import { chromium } from 'playwright';
import fs from 'fs';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto('https://www.dataportal.se/datasets/601_3755', { waitUntil: 'networkidle' });
  const html = await page.content();
  fs.writeFileSync('dataportal_dump.html', html);
  await browser.close();
})();
