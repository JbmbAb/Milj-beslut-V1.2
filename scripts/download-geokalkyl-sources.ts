import { execSync } from 'child_process';
import { existsSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

// =============================================================================
// KONFIGURERING (Offline-first / Master-arkiv & Nedladdnings-pipeline)
// =============================================================================
const DOWNLOAD_DIR = join(process.cwd(), 'GEO_Master_Archive', 'ingest', 'legal', 'geokalkyl');

export interface LegalSourceConfig {
  id: string;
  url: string;
  filename: string;
  format: 'pdf' | 'html' | 'json';
}

const SOURCES: LegalSourceConfig[] = [
  {
    id: 'sgi-geokalkyl-guide',
    url: 'https://www.sgi.se/tjanster-och-verktyg/kartor-och-verktyg/geokalkyl',
    filename: 'sgi_geokalkyl_guide.html',
    format: 'html'
  },
  {
    id: 'chalmers-odr-evaluation',
    url: 'https://odr.chalmers.se/items/42add86d-bfb8-48d3-acd1-c5134ee46626',
    filename: 'chalmers_evaluation_geokalkyl.html',
    format: 'html'
  },
  {
    id: 'diva-miljobalk-klimatkalkyler',
    url: 'https://www.diva-portal.org/smash/get/diva2:1871669/FULLTEXT01.pdf',
    filename: 'diva_miljobalk_klimatkalkyler.pdf',
    format: 'pdf'
  }
];

export async function runGeokalkylDownloader(): Promise<void> {
  console.log('🏁 Startar skördning (harvesting) av SGI, Chalmers och DiVA Geokalkyl-resurser...');
  
  // Skapa mappen i Master-arkivet om den inte finns
  if (!existsSync(DOWNLOAD_DIR)) {
    mkdirSync(DOWNLOAD_DIR, { recursive: true });
    console.log(`📁 Skapade lokal lagringskatalog: ${DOWNLOAD_DIR}`);
  }

  for (const source of SOURCES) {
    const targetPath = join(DOWNLOAD_DIR, source.filename);

    if (existsSync(targetPath)) {
      console.log(`✅ [Idempotent] ${source.id} finns redan sparad lokalt i Master-arkivet.`);
      continue;
    }

    console.log(`📥 Laddar ner ${source.id} från: ${source.url}...`);

    try {
      if (source.format === 'pdf') {
        // För binära filer som PDF:er använder vi curl i terminalen för säker binärnedladdning offline
        execSync(`curl -L -s -o "${targetPath}" "${source.url}"`, { stdio: 'inherit' });
      } else {
        // För HTML-guider laddar vi ner och sparar som text
        const response = await fetch(source.url);
        if (!response.ok) throw new Error(`HTTP-status: ${response.status}`);
        const text = await response.text();
        writeFileSync(targetPath, text, 'utf-8');
      }
      console.log(`💾 Sparade filen framgångsrikt till: ${targetPath}`);
    } catch (error) {
      console.error(`❌ Misslyckades att hämta ${source.id}: ${(error as Error).message}`);
    }
  }

  console.log('🎉 Skördningen är klar! Samtliga geokalkylresurser ligger nu säkrade lokalt i GEO_Master_Archive.');
}

// Kör om skriptet exekveras direkt
if (import.meta.url === `file://${process.argv[1]}`) {
  runGeokalkylDownloader();
}
