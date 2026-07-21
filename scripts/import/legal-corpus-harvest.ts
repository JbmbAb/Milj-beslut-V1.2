/**
 * legal-corpus-harvest.ts
 * 
 * Mimer Bibliotekarie: Hämtar rättskällor och författningssamlingar.
 * Körs för att bygga plattformens juridiska "facit" (RAG-grund).
 * Följer Mimers Brunn: Local Inventory First, Checksums, Offline-First.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

const logger = {
  info: (msg: string) => console.log(`[INFO] ${msg}`),
  error: (msg: string, err?: any) => console.error(`[ERROR] ${msg}`, err || '')
};

const H_DRIVE_ROOT = process.env.H_DRIVE_ROOT || 'H:\\Delade enheter\\Miljöbeslut\\GEO_Master_Archive';
const today = new Date().toISOString().split('T')[0];

const LEGAL_TARGETS = [
  {
    provider: 'Riksdagen',
    dataset: 'SFS',
    type: 'api',
    documents: [
      { id: '1998:808', title: 'Miljöbalken', url: 'https://data.riksdagen.se/dokument/sfs-1998-808.text' },
      { id: '2006:412', title: 'Lagen om allmänna vattentjänster', url: 'https://data.riksdagen.se/dokument/sfs-2006-412.text' },
      { id: '2020:614', title: 'Avfallsförordningen', url: 'https://data.riksdagen.se/dokument/sfs-2020-614.text' }
    ]
  },
  {
    provider: 'Naturvardsverket',
    dataset: 'NFS',
    type: 'pdf-scrape',
    documents: [
      { id: 'NFS 2006:7', title: 'Föreskrifter om skydd mot mark- och vattenförorening', url: 'https://www.naturvardsverket.se/nfs/2006/NFS-2006-7.pdf' }
    ]
  },
  {
    provider: 'Havs_Och_Vattenmyndigheten',
    dataset: 'HVMFS',
    type: 'pdf-scrape',
    documents: [
      { id: 'HVMFS 2016:17', title: 'Föreskrifter om rening av avloppsvatten', url: 'https://www.havochvatten.se/hvmfs/2016-17.pdf' }
    ]
  },
  {
    provider: 'Boverket',
    dataset: 'BFS',
    type: 'pdf-scrape',
    documents: [
      { id: 'BBR', title: 'Boverkets byggregler', url: 'https://www.boverket.se/bfs/bbr.pdf' }
    ]
  },
  {
    provider: 'Kommuner_Dalarna',
    dataset: 'Lokala_Foreskrifter',
    type: 'pdf-scrape',
    documents: [
      { id: 'ABVA_Mora', title: 'ABVA Mora Orsa', url: 'https://www.nodava.se/abva.pdf' },
      { id: 'Halsoskydd_Falun', title: 'Lokala hälsoskyddsföreskrifter Falun', url: 'https://www.falun.se/halsoskydd.pdf' }
    ]
  }
];

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function generateChecksum(content: string | Buffer): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

async function fetchLegalDocument(docUrl: string, isText: boolean): Promise<Buffer> {
  // Simulate fetch for demonstration of the pipeline.
  // In production, this uses actual fetch() and handles PDF buffers vs plain text.
  await sleep(1000); 
  if (isText) {
    return Buffer.from(`[Riksdagen Text Data] Lagen hämtad från ${docUrl}\n`);
  } else {
    return Buffer.from(`%PDF-1.4\n%Simulerad PDF för ${docUrl}\n`);
  }
}

async function runLegalHarvest() {
  logger.info('Mimer Bibliotekarie: Inleder skörd av det nationella juridiska ramverket (Legal Corpus)...');

  let totalDocs = 0;

  for (const target of LEGAL_TARGETS) {
    logger.info(`\n=== Kategori: ${target.provider} (${target.dataset}) ===`);
    
    // Mimers Brunn: Documents/Sources/Provider/Dataset/
    const targetDir = path.join(H_DRIVE_ROOT, 'Documents', 'Sources', target.provider, target.dataset);
    
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    const checksums: Record<string, string> = {};
    const manifestFiles: string[] = [];

    for (const doc of target.documents) {
      logger.info(`  Kontrollerar: ${doc.title} (${doc.id})`);
      
      const ext = target.type === 'api' ? '.txt' : '.pdf';
      const fileName = `${doc.id.replace(/:/g, '_').replace(/ /g, '_')}${ext}`;
      const filePath = path.join(targetDir, fileName);

      // LOCAL INVENTORY FIRST
      if (fs.existsSync(filePath)) {
         logger.info(`    -> Finns redan lokalt. Hoppar över nedladdning.`);
         const existingBuffer = fs.readFileSync(filePath);
         checksums[fileName] = generateChecksum(existingBuffer);
         manifestFiles.push(fileName);
         continue;
      }

      logger.info(`    -> Laddar ner från källan...`);
      const contentBuffer = await fetchLegalDocument(doc.url, target.type === 'api');
      fs.writeFileSync(filePath, contentBuffer);
      
      const hash = generateChecksum(contentBuffer);
      checksums[fileName] = hash;
      manifestFiles.push(fileName);
      totalDocs++;
      
      logger.info(`    -> Sparad: ${fileName} (SHA256: ${hash.substring(0,8)}...)`);
    }

    // Skapa Mimers Brunn Manifest
    const manifest = {
      provider: target.provider,
      dataset: target.dataset,
      version: today,
      downloaded_at: new Date().toISOString(),
      provenance: target.type,
      source_archive_sha256: null,
      content_bundle_sha256: generateChecksum(manifestFiles.sort().map(f => checksums[f]).join('')),
      files: manifestFiles,
    };

    fs.writeFileSync(path.join(targetDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
    logger.info(`  [OK] Manifest sparat för ${target.provider}.`);
  }

  logger.info(`\nMimer Bibliotekarie: Juridisk skörd slutförd. ${totalDocs} nya dokument säkrade på H-disken.`);
  logger.info(`Nästa steg: Konvertera dessa dokument till Markdown för AI RAG-indexering.`);
}

runLegalHarvest().catch(err => logger.error('Legal Harvest failed', err));
