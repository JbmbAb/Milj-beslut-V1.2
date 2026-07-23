import * as fs from 'node:fs';
import * as path from 'node:path';
import * as readline from 'node:readline';

const INPUT_FILE = 'storage/aria2c_historical_input_pruned.txt';
const FIXED_FILE = 'storage/aria2c_historical_input_fixed.txt';

async function main() {
  console.log('=== Fixing Historical Maps URL Encodings ===');
  console.log(`Input:  ${INPUT_FILE}`);
  console.log(`Output: ${FIXED_FILE}`);

  if (!fs.existsSync(INPUT_FILE)) {
    console.error('❌ Error: Input file does not exist.');
    process.exit(1);
  }

  const fileStream = fs.createReadStream(INPUT_FILE);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  });

  const outputStream = fs.createWriteStream(FIXED_FILE, { encoding: 'utf8' });
  outputStream.write('\ufeff');

  let urlLine: string | null = null;
  let lineCount = 0;
  let fixedCount = 0;

  for await (const line of rl) {
    lineCount++;
    const trimmed = line.trim();

    if (!urlLine) {
      if (trimmed.startsWith('ftp://')) {
        urlLine = trimmed;
      }
    } else {
      if (trimmed.startsWith('dir=')) {
        const dirPart = trimmed.substring(4);

        // Fix URL: decode double-encoded UTF-8
        let fixedUrl = urlLine;
        try {
          const urlObj = new URL(urlLine);
          // Decodera eventuell %-kodning
          const decodedPath = decodeURIComponent(urlObj.pathname);
          // Av-dubbelkoda UTF-8-as-binary till utf8
          const fixedPath = Buffer.from(decodedPath, 'binary').toString('utf8');
          // Enkoda om sökvägen korrekt
          const encodedPathParts = fixedPath.split('/').map(part => {
            // Bevara tomma delar
            if (!part) return '';
            return encodeURIComponent(part);
          });
          const encodedPath = encodedPathParts.join('/');
          fixedUrl = `${urlObj.protocol}//${urlObj.host}${encodedPath}`;
        } catch (err: any) {
          console.warn(`  ⚠️ Failed to parse URL: ${urlLine}`, err.message);
        }

        // Fix Destination Directory: preserve proper root and decode only double-encoded subpath
        let fixedDir = dirPart;
        try {
          const prefix = 'H:/Delade enheter/Miljöbeslut/';
          if (dirPart.startsWith(prefix)) {
            const sub = dirPart.substring(prefix.length);
            const fixedSub = Buffer.from(sub, 'binary').toString('utf8');
            fixedDir = prefix + fixedSub;
          } else {
            fixedDir = Buffer.from(dirPart, 'binary').toString('utf8');
          }
        } catch (err: any) {
          console.warn(`  ⚠️ Failed to fix directory path: ${dirPart}`, err.message);
        }

        // Skriv ut den korrigerade posten
        outputStream.write(`${fixedUrl}\n`);
        outputStream.write(`  dir=${fixedDir}\n`);

        fixedCount++;
        urlLine = null;
      }
    }
  }

  outputStream.end();
  console.log('\n=== Encoding Correction Completed ===');
  console.log(`Successfully fixed and wrote: ${fixedCount} entries.`);
}

main().catch(console.error);
