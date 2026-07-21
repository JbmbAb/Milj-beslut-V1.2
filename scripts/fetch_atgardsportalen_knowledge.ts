import * as fs from 'node:fs/promises';
import path from 'node:path';
import { resolveKnowledgeBasePath } from '../server/services/importPathService.ts';

const BASE_URL = 'https://atgardsportalen.se';
const KNOWLEDGE_DIR = resolveKnowledgeBasePath('atgardsportalen');
const MANIFEST_PATH = path.join(KNOWLEDGE_DIR, 'manifest.json');

const HIGH_VALUE_PAGES = [
  { id: 'schaktsanering', url: `${BASE_URL}/grav-och-schaktsanering/`, title: 'Gräv- och schaktsanering (entreprenad)' },
  { id: 'hallbara-atgarder', url: `${BASE_URL}/hallbara-atgarder/`, title: 'Hållbara åtgärder och ESG' },
  { id: 'riskbedomning', url: `${BASE_URL}/riskbedomning/`, title: 'Riskbedömning för förorenade områden' },
  { id: 'halsorisker', url: `${BASE_URL}/riskbedomning/halsorisker/`, title: 'Hälsorisker och mänsklig exponering' },
  { id: 'miljorisker', url: `${BASE_URL}/riskbedomning/miljorisker/`, title: 'Miljörisker och ekotoxikologi' },
  { id: 'pfas', url: `${BASE_URL}/pfoa-och-pfos/`, title: 'PFAS - PFOA och PFOS i mark och avlopp' },
  { id: 'kvicksilver', url: `${BASE_URL}/kvicksilver-hg/`, title: 'Kvicksilver (Hg) i mark och recipient' },
  { id: 'metaller', url: `${BASE_URL}/metaller/`, title: 'Metaller i jord och vatten' },
  { id: 'vattenreningsmetoder', url: `${BASE_URL}/vattenreningsmetoder/`, title: 'Vattenreningsmetoder' },
  { id: 'insitu-metoder', url: `${BASE_URL}/in-situ-metoder/`, title: 'In-situ saneringsmetoder (jord och mark)' }
];

const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'sv-SE,sv;q=0.9,en;q=0.8',
};

async function main(): Promise<void> {
  console.log('=== Åtgärdsportalen Kunskapsinhämtning ===');
  console.log(`Målkatalog: ${KNOWLEDGE_DIR}`);

  await fs.mkdir(KNOWLEDGE_DIR, { recursive: true });

  const downloads = [];
  const failures = [];

  for (const page of HIGH_VALUE_PAGES) {
    try {
      console.log(`Hämtar: ${page.title} (${page.url})`);
      const response = await fetch(page.url, { headers: HEADERS });
      if (!response.ok) {
        throw new Error(`HTTP-fel: ${response.status} ${response.statusText}`);
      }

      const html = await response.text();
      
      // Enkel städning av HTML för att spara ren text/innehåll för AI-tolkning
      const cleanedText = cleanHtmlContent(html, page.title);
      
      const fileName = `${page.id}.txt`;
      const absPath = path.join(KNOWLEDGE_DIR, fileName);
      await fs.writeFile(absPath, cleanedText, 'utf8');

      downloads.push({
        id: page.id,
        title: page.title,
        url: page.url,
        savedAs: `atgardsportalen/${fileName}`,
        bytes: Buffer.byteLength(cleanedText, 'utf8'),
        savedAt: new Date().toISOString()
      });
      
      // Pausa kort för att vara snäll mot servern
      await new Promise(resolve => setTimeout(resolve, 300));
    } catch (error) {
      console.error(`- Misslyckades för ${page.id}:`, error);
      failures.push({
        id: page.id,
        url: page.url,
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }

  const manifest = {
    generatedAt: new Date().toISOString(),
    source: BASE_URL,
    processed: downloads.length,
    failures,
    downloads
  };

  await fs.writeFile(MANIFEST_PATH, JSON.stringify(manifest, null, 2), 'utf8');
  console.log(`\nInhämtning klar. Lyckade: ${downloads.length}, Misslyckade: ${failures.length}`);
  console.log(`Manifest sparat i: ${MANIFEST_PATH}`);
}

function cleanHtmlContent(html: string, title: string): string {
  // Extrahera huvudinnehållet (ofta inuti en article, main, eller innehålls-div)
  let mainContent = html;
  
  // Plocka ut det som finns inom <article> eller <main> om det finns
  const articleMatch = html.match(/<article[^>]*>([\s\S]*?)<\/article>/i) || 
                       html.match(/<main[^>]*>([\s\S]*?)<\/main>/i);
  
  if (articleMatch) {
    mainContent = articleMatch[1];
  }

  // Ta bort scripts, styles och andra icke-text block
  mainContent = mainContent
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '')
    .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')
    .replace(/<[^>]+>/g, ' ') // Ersätt HTML-taggar med mellanslag
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ') // Ta bort extra mellanslag
    .trim();

  return `TITEL: ${title}\nKÄLLA: ${BASE_URL}\nDATUM: ${new Date().toLocaleDateString('sv-SE')}\n\n${mainContent}`;
}

main().catch((error) => {
  console.error('Körning misslyckades:', error);
  process.exitCode = 1;
});
