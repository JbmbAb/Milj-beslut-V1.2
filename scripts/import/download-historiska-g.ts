import * as ftp from 'basic-ftp';
import * as fs from 'fs';
import * as path from 'path';

// Inställningar för nedladdning
const FTP_HOST = 'download-opendata.lantmateriet.se';
const DOWNLOAD_DIR = 'G:\\Min enhet\\Historiska_kartor';
const TARGET_FOLDERS = [
  'Haradsekonomiska_kartan',
  'Ekonomiska_kartan',
  'Generalstabskartan'
];

async function main() {
  console.log(`\n=== LANTMÄTERIET FTP DOWNLOADER ===`);
  console.log(`Laddar ner från: ftp://${FTP_HOST}`);
  console.log(`Sparar till:     ${DOWNLOAD_DIR}\n`);

  if (!fs.existsSync(DOWNLOAD_DIR)) {
    fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
  }

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
      const localFolder = path.join(DOWNLOAD_DIR, folder);
      console.log(`\n----------------------------------------`);
      console.log(`📥 Påbörjar nedladdning av: ${folder}`);
      console.log(`----------------------------------------`);
      
      if (!fs.existsSync(localFolder)) {
        fs.mkdirSync(localFolder, { recursive: true });
      }

      // Track progress
      client.trackProgress(info => {
        if (info.bytesOverall > 0 && info.bytesOverall % (10 * 1024 * 1024) === 0) {
          const mb = Math.round(info.bytesOverall / 1024 / 1024);
          console.log(`  [Progress] ${folder} - Läst ${mb} MB...`);
        }
      });

      try {
        await client.downloadToDir(localFolder, folder);
        console.log(`✅ Färdig med ${folder}!`);
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
