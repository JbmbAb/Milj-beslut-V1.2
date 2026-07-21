import * as fs from 'node:fs/promises';
import path from 'node:path';
import { resolveKnowledgeBasePath } from '../server/services/importPathService';

const BASE_URL = 'https://vattenbokhandeln.svensktvatten.se';
const KNOWLEDGE_DIR = resolveKnowledgeBasePath('svenskt_vatten');
const MANIFEST_PATH = path.join(KNOWLEDGE_DIR, 'manifest.json');

const HIGH_VALUE_PAGES = [
  {
    id: 'dagvattenatervinning',
    url: `${BASE_URL}/produkt/svenskt-vatten-utveckling/beslutsstod-for-dagvattenatervinning-vagledning-for-multikriterieanalys/`,
    title: 'Beslutsstöd för dagvattenåtervinning – vägledning för multikriterieanalys (Rapport 2025-20)'
  },
  {
    id: 'pfas-avloppsreningsverk',
    url: `${BASE_URL}/produkt/svenskt-vatten-utveckling/forekomst-och-avskiljning-av-pfas-pa-svenska-avloppsreningsverk/`,
    title: 'Förekomst och avskiljning av PFAS på svenska avloppsreningsverk (Rapport 2025-18)'
  },
  {
    id: 'pfas-analysmetoder',
    url: `${BASE_URL}/produkt/kartlaggning-av-pfas-analysmetoder-i-sverige/`,
    title: 'Kartläggning av PFAS-analysmetoder i Sverige (Meddelande, april 2026)'
  },
  {
    id: 'avloppsrening-samverkan',
    url: `${BASE_URL}/produkt/svenskt-vatten-utveckling/samverkan-mellan-konventionell-och-kvartar-avloppsrening/`,
    title: 'Samverkan mellan konventionell och kvartär avloppsrening (Rapport 2026-2)'
  },
  {
    id: 'slamhantering-metan',
    url: `${BASE_URL}/produkt/svenskt-vatten-utveckling/utslapp-av-vaxthusgaser-fran-hantering-av-avloppsslam-med-fokus-pa-metan/`,
    title: 'Utsläpp av växthusgaser från hantering av avloppsslam – med fokus på metan (Rapport 2026-1)'
  }
];

const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'sv-SE,sv;q=0.9,en;q=0.8',
};

async function main(): Promise<void> {
  console.log('=== Svenskt Vatten Vattenbokhandeln Ingest ===');
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
      const cleanedText = cleanHtmlContent(html, page.title, page.url);
      
      const fileName = `${page.id}.txt`;
      const absPath = path.join(KNOWLEDGE_DIR, fileName);
      await fs.writeFile(absPath, cleanedText, 'utf8');

      downloads.push({
        id: page.id,
        title: page.title,
        url: page.url,
        savedAs: `svenskt_vatten/${fileName}`,
        bytes: Buffer.byteLength(cleanedText, 'utf8'),
        savedAt: new Date().toISOString()
      });
      
      // Respektera servern med fördröjning
      await new Promise(resolve => setTimeout(resolve, 500));
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

function cleanHtmlContent(html: string, title: string, sourceUrl: string): string {
  let mainContent = html;
  
  // Plocka ut det som finns inom <article>, <main> eller WooCommerce-beskrivningar om det finns
  const articleMatch = html.match(/<article[^>]*>([\s\S]*?)<\/article>/i) || 
                       html.match(/<main[^>]*>([\s\S]*?)<\/main>/i) ||
                       html.match(/<div class="[^"]*product[^"]*">([\s\S]*?)<\/div>/i);
  
  if (articleMatch) {
    mainContent = articleMatch[1];
  }

  // Ta bort scripts, styles och andra icke-text block för att lämna ren text
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

  return `TITEL: ${title}\nKÄLLA: ${sourceUrl}\nDATUM: ${new Date().toLocaleDateString('sv-SE')}\n\n${mainContent}`;
}

main().catch((error) => {
  console.error('Körning misslyckades:', error);
  process.exitCode = 1;
});
