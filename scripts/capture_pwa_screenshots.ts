import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';

async function main() {
  console.log("Launching headless browser...");
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  const url = 'http://localhost:3000/';
  console.log(`Navigating to ${url}...`);
  
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    console.log("Page loaded successfully.");
    
    // Give any animations some time to settle
    await page.waitForTimeout(2000);

    const publicDir = path.resolve(process.cwd(), 'public');
    if (!fs.existsSync(publicDir)) {
      fs.mkdirSync(publicDir, { recursive: true });
    }

    // 1. Desktop Screenshot (Wide, aspect ratio < 2.5:1)
    console.log("Capturing desktop screenshot...");
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.screenshot({ path: path.join(publicDir, 'screenshot-desktop.png') });
    console.log("Desktop screenshot saved.");

    // 2. Mobile Screenshot (Narrow, portrait height > width)
    console.log("Capturing mobile screenshot...");
    await page.setViewportSize({ width: 412, height: 800 });
    await page.screenshot({ path: path.join(publicDir, 'screenshot-mobile.png') });
    console.log("Mobile screenshot saved.");

  } catch (error) {
    console.error("Error capturing screenshots:", error);
  } finally {
    await browser.close();
    console.log("Browser closed.");
  }
}

main().catch(console.error);
