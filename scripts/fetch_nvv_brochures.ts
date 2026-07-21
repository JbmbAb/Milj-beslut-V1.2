import fs from 'fs';
import path from 'path';
import { resolveKnowledgeBasePath } from '../server/services/importPathService.ts';
import { XMLParser } from 'fast-xml-parser';
import dotenv from 'dotenv';

dotenv.config();

const KNOWLEDGE_DIR = resolveKnowledgeBasePath('naturvardsverket');
const BROCHURES_DIR = path.join(KNOWLEDGE_DIR, 'broschyrer');
const OAI_BASE_URL = 'http://naturvardsverket.diva-portal.org/dice/oai';

const NVV_PUBLIC_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
  Accept: 'application/xml, text/xml, */*',
  'Accept-Language': 'sv-SE,sv;q=0.9,en;q=0.8',
};

async function fetchAllNvvBrochures() {
  console.log('🚀 Startar intelligent inhämtning av Naturvårdsverkets PDF-publikationer via DiVA...');

  ensureDir(BROCHURES_DIR);

  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
  });

  let resumptionToken: string | null = null;
  let totalDownloaded = 0;
  let totalFound = 0;

  const keywords = [
    'handbok',
    'broschyr',
    'vagledning',
    'vägledning',
    'information',
    'rapport',
    'faktablad',
    'avlopp',
    'enskilt',
  ];

  try {
    do {
      let url = `${OAI_BASE_URL}?verb=ListRecords&metadataPrefix=oai_dc&set=all-naturvardsverket`;
      if (resumptionToken) {
        url = `${OAI_BASE_URL}?verb=ListRecords&resumptionToken=${encodeURIComponent(resumptionToken)}`;
        console.log(`📑 Hämtar nästa sida med token: ${resumptionToken.substring(0, 20)}...`);
      } else {
        console.log('🌐 Startar initial hämtning från OAI-PMH...');
      }

      const response = await fetch(url, { headers: NVV_PUBLIC_HEADERS });
      if (!response.ok) {
        throw new Error(`OAI-fel: ${response.status} ${response.statusText}`);
      }

      const xmlData = await response.text();
      const jsonObj = parser.parse(xmlData);

      const listRecords = jsonObj['OAI-PMH']?.ListRecords;
      const records = listRecords?.record;
      const rawToken = listRecords?.resumptionToken;
      resumptionToken = typeof rawToken === 'object' ? rawToken['#text'] : rawToken;

      if (records) {
        const recordArray = Array.isArray(records) ? records : [records];
        console.log(`📦 Bearbetar ${recordArray.length} poster på denna sida...`);

        for (const record of recordArray) {
          if (record.header?.['@_status'] === 'deleted') continue;

          const metadata = record.metadata?.['oai_dc:dc'];
          if (!metadata) continue;

          const title = metadata['dc:title'];
          const cleanTitle =
            typeof title === 'string' ? title : Array.isArray(title) ? title[0] : 'Okänd titel';

          const formats = Array.isArray(metadata['dc:format'])
            ? metadata['dc:format']
            : [metadata['dc:format']];
          const isPdf = formats.some((f: any) => typeof f === 'string' && f.includes('pdf'));

          if (isPdf) {
            // Kolla om titeln matchar våra intressanta sökord
            const titleLower = cleanTitle.toLowerCase();
            const isInteresting = keywords.some((kw) => titleLower.includes(kw));

            if (isInteresting) {
              totalFound++;

              // Extrahera ID från t.ex. "oai:DiVA.org:naturvardsverket-8882"
              const identifier = record.header?.identifier;
              const idMatch = identifier?.match(/naturvardsverket-(\d+)$/);

              if (idMatch) {
                const id = idMatch[1];
                const pdfUrl = `https://naturvardsverket.diva-portal.org/smash/get/diva2:${id}/FULLTEXT01.pdf`;

                const fileName = `${toFileSlug(cleanTitle)}__${id}.pdf`;
                const destPath = path.join(BROCHURES_DIR, fileName);

                if (fs.existsSync(destPath)) continue;

                await downloadBinaryFile(pdfUrl, destPath);
                totalDownloaded++;

                // Begränsa för att inte ladda ner för mycket på en gång i ett turn
                if (totalDownloaded >= 50) {
                  console.log('🛑 Uppnådde gränsen på 50 filer för detta pass. Fortsätter senare...');
                  return;
                }
              }
            }
          }
        }
      }

      if (resumptionToken) {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    } while (resumptionToken);

    console.log(`\n🎉 Klar med detta pass!`);
    console.log(`📊 Publikationer matchade: ${totalFound}`);
    console.log(`💾 Filer nedladdade nu: ${totalDownloaded}`);
  } catch (error: any) {
    console.error('❌ Ett fel uppstod under inhämtningen:', error.message);
  }
}

async function downloadBinaryFile(url: string, destinationPath: string) {
  try {
    const response = await fetch(url, {
      headers: {
        ...NVV_PUBLIC_HEADERS,
        Accept: 'application/pdf',
      },
    });

    if (!response.ok) return;

    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > 1000 && buffer.toString('utf8', 0, 4) === '%PDF') {
      fs.writeFileSync(destinationPath, buffer);
      console.log(`   ✅ Sparad: ${path.basename(destinationPath)} (${Math.round(buffer.length / 1024)} KB)`);
    }
  } catch {
    // Tyst misslyckande
  }
}

function toFileSlug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[åä]/g, 'a')
    .replace(/[ö]/g, 'o')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 80);
}

function ensureDir(dirPath: string) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

fetchAllNvvBrochures();
