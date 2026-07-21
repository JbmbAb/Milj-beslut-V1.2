import { loadEnvFile } from '../server/loadEnv';
import { resolveKnowledgeBasePath } from '../server/services/importPathService';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import fetch from 'node-fetch';

const API_BASE_URL = 'https://rattspraxis.etjanst.domstol.se/api/v1/publiceringar';
const DELAY_BETWEEN_PAGES = 500; // ms

async function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function toFileSlug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

async function fetchWithRetry(url: string, retries = 3): Promise<any> {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Miljobeslut History Fetcher/1.0', 'Accept': 'application/json' },
      });
      if (res.ok) return res;
      console.warn(`Attempt ${i + 1} failed for ${url}: ${res.status}`);
    } catch (err) {
      console.warn(`Attempt ${i + 1} error for ${url}: ${err}`);
    }
    await delay(2000 * (i + 1));
  }
  throw new Error(`Failed to fetch ${url} after ${retries} retries`);
}

async function main() {
  loadEnvFile();
  
  const outputDir = resolveKnowledgeBasePath('legal', 'domstol-history');
  const pagesDir = path.join(outputDir, 'pages');
  
  await fs.mkdir(pagesDir, { recursive: true });

  const allItems: any[] = [];
  let page = 1;
  const MAX_PAGES = 2500; // Max ~2500 pages (25k items)
  let consecutiveEmptyPages = 0;

  console.log('🚀 Starting download of historical legal data from Sveriges Domstolar API...');

  while (page <= MAX_PAGES) {
    const pageUrl = `${API_BASE_URL}?page=${page}`;
    console.log(`Fetching page ${page}: ${pageUrl}`);
    
    let responseText = '';
    try {
      const res = await fetchWithRetry(pageUrl);
      responseText = await res.text();
    } catch (err) {
      console.error(`Failed to fetch page ${page}, aborting.`);
      break;
    }

    // Remove BOM if present
    const cleanText = responseText.replace(/^\uFEFF/, '');
    const data = JSON.parse(cleanText);
    
    const itemsOnPage = data.value || data.content || data.items || data;
    
    if (!Array.isArray(itemsOnPage) || itemsOnPage.length === 0) {
      consecutiveEmptyPages++;
      if (consecutiveEmptyPages >= 3) {
        console.log(`✅ No more items found. Finished pagination.`);
        break;
      } else {
        console.log(`⚠️ Page ${page} was empty, trying next page just in case...`);
        page++;
        await delay(DELAY_BETWEEN_PAGES);
        continue;
      }
    }

    consecutiveEmptyPages = 0;
    console.log(`Found ${itemsOnPage.length} items on page ${page}.`);
    
    // Process items
    for (const item of itemsOnPage) {
      const guid = item.id;
      const title = item.malNummerLista?.[0] ? `Avgörande ${item.malNummerLista[0]}` : 'Vägledande avgörande';
      const link = `https://www.domstol.se/domar-och-beslut/sok-vagledande-domar-och-beslut/avgorande/?id=${item.id}`;
      
      const fileName = `${toFileSlug(guid || title)}.json`;
      const filePath = path.join(pagesDir, fileName);
      
      // We save the raw JSON representation for the case
      await fs.writeFile(filePath, JSON.stringify(item, null, 2), 'utf8');

      allItems.push({
        guid,
        title: title,
        link,
        savedAs: fileName,
        savedAt: new Date().toISOString(),
      });
    }

    page++;
    
    // Save manifest incrementally
    const manifestPath = path.join(outputDir, 'items.json');
    await fs.writeFile(manifestPath, JSON.stringify({ processed: allItems.length, items: allItems }, null, 2), 'utf8');
    
    await delay(DELAY_BETWEEN_PAGES);
  }

  console.log(`\n🎉 Import completed! Total items processed: ${allItems.length}`);
}

main().catch(err => {
  console.error('Fatal error in domstol-history script:', err);
  process.exitCode = 1;
});
