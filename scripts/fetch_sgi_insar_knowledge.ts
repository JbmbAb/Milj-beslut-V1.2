import * as fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { resolveKnowledgeBasePath } from '../server/services/importPathService';

const require = createRequire(import.meta.url);
const pdf = require('pdf-parse');

const BASE_URL = 'https://gis.sgi.se/dokument/insar/SGI';
const KNOWLEDGE_DIR = path.join(resolveKnowledgeBasePath('sgi'), 'insar');
const MANIFEST_PATH = path.join(KNOWLEDGE_DIR, 'manifest.json');

const FILES_TO_DOWNLOAD = [
  {
    id: 'sgi_insar_faq',
    url: `${BASE_URL}/faq_ver1.htm`,
    fileName: 'faq_ver1.htm',
    type: 'html',
    title: 'SGI InSAR Sverige - Vanliga Frågor (FAQ)'
  },
  {
    id: 'sgi_insar_guide',
    url: `${BASE_URL}/Kort%20beskrivning%20av%20InSAR,%20Sentinel1,%20CLMS,%20EGMS,%20SGI%20till%C3%A4mpning.pdf`,
    fileName: 'Kort beskrivning av InSAR, Sentinel1, CLMS, EGMS, SGI tillämpning.pdf',
    type: 'pdf',
    title: 'Kort beskrivning av InSAR, Sentinel1, CLMS, EGMS och SGI tillämpning'
  },
  {
    id: 'sgi_insar_wmts_spec',
    url: `${BASE_URL}/WMTS_markrorelser_InSAR_SGI.pdf`,
    fileName: 'WMTS_markrorelser_InSAR_SGI.pdf',
    type: 'pdf',
    title: 'Teknisk specifikation för WMTS-markrörelser (InSAR SGI)'
  }
];

const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
};

async function main(): Promise<void> {
  console.log('=== SGI InSAR Sverige Kunskapsinhämtning ===');
  console.log(`Målkatalog: ${KNOWLEDGE_DIR}`);

  await fs.mkdir(KNOWLEDGE_DIR, { recursive: true });

  const downloads = [];
  const failures = [];

  for (const file of FILES_TO_DOWNLOAD) {
    try {
      console.log(`Laddar ner: ${file.title} (${file.url})`);
      const response = await fetch(file.url, { headers: HEADERS });
      if (!response.ok) {
        throw new Error(`HTTP-fel: ${response.status} ${response.statusText}`);
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      const rawPath = path.join(KNOWLEDGE_DIR, file.fileName);
      await fs.writeFile(rawPath, buffer);
      console.log(`- Sparade originalfilen: ${file.fileName}`);

      let extractedText = '';
      if (file.type === 'pdf') {
        const parser = new pdf.PDFParse({ data: buffer });
        await parser.load();
        const parsed = await parser.getText();
        extractedText = parsed.text ?? '';
        await parser.destroy();
      } else if (file.type === 'html') {
        const rawHtml = buffer.toString('utf8');
        extractedText = cleanHtmlContent(rawHtml);
      }

      const txtFileName = `${file.id}.txt`;
      const txtPath = path.join(KNOWLEDGE_DIR, txtFileName);
      
      const fullContent = `TITEL: ${file.title}\nKÄLLA: ${file.url}\nDATUM: ${new Date().toLocaleDateString('sv-SE')}\n\n${extractedText}`;
      await fs.writeFile(txtPath, fullContent, 'utf8');
      console.log(`- Sparade extraherad text som: ${txtFileName}`);

      downloads.push({
        id: file.id,
        title: file.title,
        url: file.url,
        rawSavedAs: `sgi/insar/${file.fileName}`,
        textSavedAs: `sgi/insar/${txtFileName}`,
        bytes: Buffer.byteLength(fullContent, 'utf8'),
        savedAt: new Date().toISOString()
      });

      await new Promise(resolve => setTimeout(resolve, 300));
    } catch (error) {
      console.error(`- Misslyckades för ${file.id}:`, error);
      failures.push({
        id: file.id,
        url: file.url,
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
  console.log(`\nInhämtning klar. Lyckade: ${downloads.length}, Misslyckade: ${failures.length}`);
  console.log(`SGI InSAR manifest sparat i: ${MANIFEST_PATH}`);
}

function cleanHtmlContent(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

main().catch((error) => {
  console.error('Inhämtning misslyckades:', error);
  process.exitCode = 1;
});
