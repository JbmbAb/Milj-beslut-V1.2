import * as fs from 'node:fs/promises';
import path from 'node:path';
import { resolveKnowledgeBasePath } from '../server/services/importPathService';

const BASE_URL = 'https://vattenbokhandeln.svensktvatten.se';
const KNOWLEDGE_DIR = path.join(resolveKnowledgeBasePath('svenskt_vatten'), 'standards');
const MANIFEST_PATH = path.join(KNOWLEDGE_DIR, 'manifest.json');

const SEARCH_QUERIES = [
  'P110', // Dagvattenavledning
  'P105', // Hållbar dagvattenhantering
  'P114', // Dagvattenhantering i nyexploatering
  'P112', // MBA (Mikrobiologisk BarriärAnalys)
  'P113', // MBA fortsättning
  'P101', // Dimensionering av spillvattenledningar
  'P90',  // Äldre dagvattenguide (referens)
  'dagvattenavledning'
];

const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'sv-SE,sv;q=0.9,en;q=0.8',
};

async function main(): Promise<void> {
  console.log('=== Svenskt Vatten Standarder Ingest för LLM-inlärning ===');
  console.log(`Målkatalog: ${KNOWLEDGE_DIR}`);

  await fs.mkdir(KNOWLEDGE_DIR, { recursive: true });

  const productUrls = new Set<string>();

  // 1. Sök efter standarder och samla produkt-länkar
  for (const query of SEARCH_QUERIES) {
    try {
      const searchUrl = `${BASE_URL}/?s=${encodeURIComponent(query)}&post_type=product`;
      console.log(`Söker efter "${query}" på: ${searchUrl}`);
      
      const response = await fetch(searchUrl, { headers: HEADERS });
      if (!response.ok) continue;

      const html = await response.text();
      
      // Hitta alla produktlänkar i HTML-källkoden med regex
      const productRegex = /href="(https:\/\/vattenbokhandeln\.svensktvatten\.se\/produkt\/[^"]+)"/g;
      let match;
      while ((match = productRegex.exec(html)) !== null) {
        productUrls.add(match[1]);
      }
      
      await new Promise(resolve => setTimeout(resolve, 300));
    } catch (err) {
      console.error(`Sökfel för "${query}":`, err);
    }
  }

  const uniqueUrls = Array.from(productUrls);
  console.log(`\nHittade ${uniqueUrls.length} unika standarder/produkter att hämta beskrivningar från.`);

  const downloads = [];
  const failures = [];

  // 2. Ladda ner beskrivningen av varje produkt/standard
  for (const url of uniqueUrls) {
    const segments = url.replace(/\/$/, '').split('/');
    const slug = segments[segments.length - 1] || 'produkt';
    
    try {
      console.log(`Hämtar innehåll för: ${slug} (${url})`);
      const response = await fetch(url, { headers: HEADERS });
      if (!response.ok) {
        throw new Error(`HTTP-fel: ${response.status} ${response.statusText}`);
      }

      const html = await response.text();
      
      // Försök extrahera titel
      let title = slug.replace(/-/g, ' ');
      const titleMatch = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
      if (titleMatch) {
        title = titleMatch[1].replace(/<[^>]+>/g, ' ').trim();
      }

      const cleanedText = cleanHtmlContent(html, title, url);
      
      const fileName = `${slug}.txt`;
      const absPath = path.join(KNOWLEDGE_DIR, fileName);
      await fs.writeFile(absPath, cleanedText, 'utf8');

      downloads.push({
        slug,
        title,
        url,
        savedAs: `svenskt_vatten/standards/${fileName}`,
        bytes: Buffer.byteLength(cleanedText, 'utf8'),
        savedAt: new Date().toISOString()
      });

      await new Promise(resolve => setTimeout(resolve, 500));
    } catch (error) {
      console.error(`- Misslyckades för ${slug}:`, error);
      failures.push({
        slug,
        url,
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }

  const manifest = {
    generatedAt: new Date().toISOString(),
    processed: downloads.length,
    failures,
    downloads
  };

  await fs.writeFile(MANIFEST_PATH, JSON.stringify(manifest, null, 2), 'utf8');
  console.log(`\nInhämtning klar. Lyckade standarder: ${downloads.length}, Misslyckade: ${failures.length}`);
  console.log(`Standardmanifest sparat i: ${MANIFEST_PATH}`);
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

  // Ta bort ovidkommande scripts, styles och nav-taggar för ren text
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

  return `STANDARD-TITEL: ${title}\nURL: ${sourceUrl}\nDATUM: ${new Date().toLocaleDateString('sv-SE')}\n\n${mainContent}`;
}

main().catch((error) => {
  console.error('Körning misslyckades:', error);
  process.exitCode = 1;
});
