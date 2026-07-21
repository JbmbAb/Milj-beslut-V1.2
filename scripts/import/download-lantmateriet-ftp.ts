import * as ftp from 'basic-ftp';
import * as fs from 'fs';
import * as path from 'path';
import { getHarvestPath } from './config/mimersBrunn';
import { createManifest } from './utils/harvesting';
import dotenv from 'dotenv';

dotenv.config();

// Inställningar för nedladdning
const FTP_HOST = 'download-opendata.lantmateriet.se';
const TARGET_FOLDERS = [
  'Haradsekonomiska_kartan',
  'Ekonomiska_kartan',
  'Generalstabskartan'
];

async function main() {
  console.log(`\n=== LANTMÄTERIET FTP HARVESTER (Mimers Brunn) ===`);
  console.log(`Laddar ner från: ftp://${FTP_HOST}\n`);

  const client = new ftp.Client();
  client.ftp.verbose = false;

  try {
    console.log('Ansluter till FTP (anonymt)...');
    await client.access({
      host: FTP_HOST,
      secure: false
    });
    console.log('Ansluten!\n');

    for (const folder of TARGET_FOLDERS) {
      const targetDir = getHarvestPath('LM', folder, 'RASTERS');
      const rawDir = path.join(targetDir, 'raw');

      console.log(`\n----------------------------------------`);
      console.log(`📥 Påbörjar nedladdning av: ${folder}`);
      console.log(`   Target: ${targetDir}`);
      console.log(`----------------------------------------`);
      
      if (!fs.existsSync(rawDir)) {
        fs.mkdirSync(rawDir, { recursive: true });
      }

      // Track progress
      client.trackProgress(info => {
        if (info.bytesOverall > 0 && info.bytesOverall % (50 * 1024 * 1024) === 0) {
          const mb = Math.round(info.bytesOverall / 1024 / 1024);
          console.log(`  [Progress] ${folder} - Läst ${mb} MB...`);
        }
      });

      try {
        await client.downloadToDir(rawDir, folder);
        console.log(`✅ Färdig med ${folder}!`);
        
        console.log(`   - Genererar manifest för ${folder}...`);
        await createManifest(rawDir, {
          provider: 'LM',
          dataset: folder,
          version: new Date().toISOString().split('T')[0],
          source_url: `ftp://${FTP_HOST}/${folder}`,
          provenance: 'harvested',
        });

      } catch (err: any) {
        console.error(`❌ Ett fel uppstod vid nedladdning av ${folder}:`, err.message);
      }
      
      client.trackProgress(); // clear tracker
    }

  } catch (err) {
    console.error('Kritiskt fel vid anslutning:', err);
  } finally {
    client.close();
    console.log('\nNedladdning avslutad. Anslutning stängd.');
  }
}

main();
