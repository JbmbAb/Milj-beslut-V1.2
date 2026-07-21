/**
 * domstol-sorter.ts
 * 
 * Mimer Bibliotekarie: Sorteringsmotor för domar.
 * Hanterar flödet från Domstolsverkets RSS/Nedladdningar:
 * 1. Skiljer på Miljödomar (MMD/MÖD) och Övriga domar.
 * 2. Miljödomar -> PostGIS (spatial koppling) + Arkiv
 * 3. Övriga domar + Författningar -> Endast Arkiv + RAG-index
 */

import * as fs from 'fs';
import * as path from 'path';

const logger = {
  info: (msg: string) => console.log(`[INFO] ${msg}`),
  error: (msg: string, err?: any) => console.error(`[ERROR] ${msg}`, err || '')
};

const H_DRIVE_ROOT = process.env.H_DRIVE_ROOT || 'H:\\Delade enheter\\Miljöbeslut\\GEO_Master_Archive';
const BASE_DOC_DIR = path.join(H_DRIVE_ROOT, 'Documents', 'Sources');

// Mock data representing incoming rulings from Domstolsverket API/RSS
const incomingRulings = [
  {
    id: 'MÖD 2025:12',
    court: 'Mark- och miljööverdomstolen',
    title: 'Fråga om tillstånd till markbädd, risk för förorening',
    property: 'Falun 1:1',
    contentUrl: 'http://domstol.se/mod/2025-12.pdf'
  },
  {
    id: 'NJA 2024 s 111',
    court: 'Högsta domstolen',
    title: 'Skadestånd vid avtalsbrott',
    property: null,
    contentUrl: 'http://domstol.se/nja/2024-111.pdf'
  },
  {
    id: 'MMD Vänersborg M 112-25',
    court: 'Mark- och miljödomstolen',
    title: 'Vitesföreläggande gällande bristfälligt avlopp',
    property: 'Lidköping 2:4',
    contentUrl: 'http://domstol.se/mmd/m-112-25.pdf'
  },
  {
    id: 'HFD 2025 ref. 4',
    court: 'Högsta förvaltningsdomstolen',
    title: 'Kammarrättens avvisning av överklagande i socialmål',
    property: null,
    contentUrl: 'http://domstol.se/hfd/2025-4.pdf'
  }
];

function isEnvironmentalCourt(courtName: string): boolean {
  const envCourts = ['mark- och miljödomstolen', 'mark- och miljööverdomstolen'];
  return envCourts.some(c => courtName.toLowerCase().includes(c));
}

async function runDomstolSorting() {
  logger.info('Mimer Bibliotekarie: Startar juridisk sorteringsmotor för inkommande domar...');

  const envDir = path.join(BASE_DOC_DIR, 'Domstolsverket', 'Miljodomstolar');
  const otherDir = path.join(BASE_DOC_DIR, 'Domstolsverket', 'Ovriga_Domar');
  const statDir = path.join(BASE_DOC_DIR, 'Riksdagen', 'SFS'); // Example of where statutes are

  fs.mkdirSync(envDir, { recursive: true });
  fs.mkdirSync(otherDir, { recursive: true });
  fs.mkdirSync(statDir, { recursive: true });

  let postgisImportCount = 0;
  let archiveOnlyCount = 0;

  for (const ruling of incomingRulings) {
    const isEnv = isEnvironmentalCourt(ruling.court);
    
    if (isEnv) {
      logger.info(`[MILJÖDOM - TILL POSTGIS]: ${ruling.id} från ${ruling.court}`);
      logger.info(`   -> Arkiveras i: ${envDir}`);
      logger.info(`   -> EXTRAGERAR GEO: Kopplar till fastighet '${ruling.property}' i PostGIS.`);
      postgisImportCount++;
      // Här anropas den faktiska PostGIS-rutinen i produktion
    } else {
      logger.info(`[ÖVRIG DOM - ENDAST ARKIV]: ${ruling.id} från ${ruling.court}`);
      logger.info(`   -> Arkiveras i: ${otherDir}`);
      logger.info(`   -> IGNORERAR POSTGIS: Går direkt till RAG-vektorisering.`);
      archiveOnlyCount++;
    }
  }

  logger.info('\n=== Sorteringsrapport ===');
  logger.info(`Miljödomar skickade till PostGIS: ${postgisImportCount}`);
  logger.info(`Övriga domar sparade separat (endast RAG): ${archiveOnlyCount}`);
  logger.info(`Författningssamlingar (SFS/NFS etc) sparas också separat i ${path.dirname(statDir)}`);
}

runDomstolSorting().catch(err => logger.error('Sorting failed', err));
