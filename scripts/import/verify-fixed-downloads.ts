import * as fs from 'node:fs';
import * as path from 'node:path';
import * as readline from 'node:readline';

const FIXED_FILE = 'storage/aria2c_historical_input_fixed.txt';

async function main() {
  console.log('=== Verifying Fixed Historical Downloads ===');
  console.log(`Checking against: ${FIXED_FILE}\n`);

  if (!fs.existsSync(FIXED_FILE)) {
    console.error('❌ Error: Fixed input file does not exist.');
    process.exit(1);
  }

  const fileStream = fs.createReadStream(FIXED_FILE);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  });

  let urlLine: string | null = null;
  let totalChecked = 0;
  let presentCount = 0;
  let missingCount = 0;

  for await (const line of rl) {
    let trimmed = line.trim();
    if (trimmed.startsWith('\ufeff')) {
      trimmed = trimmed.substring(1);
    }
    
    if (!urlLine) {
      if (trimmed.startsWith('ftp://')) {
        urlLine = trimmed;
      }
    } else {
      if (trimmed.startsWith('dir=')) {
        const dirPart = trimmed.substring(4);
        const urlParts = urlLine.split('/');
        const filename = urlParts[urlParts.length - 1]!;
        const decodedFilename = decodeURIComponent(filename);
        const localPath = path.join(dirPart, decodedFilename);
        totalChecked++;

        if (fs.existsSync(localPath)) {
          presentCount++;
        } else {
          missingCount++;
          if (missingCount <= 10) {
            console.log(`  🔍 Missing [${missingCount}]: ${localPath}`);
          }
        }
        urlLine = null;
      }
    }
  }

  console.log('\n=== Verification Summary ===');
  console.log(`Total checked: ${totalChecked}`);
  console.log(`Present:       ${presentCount} (${((presentCount / totalChecked) * 100).toFixed(2)}%)`);
  console.log(`Missing:       ${missingCount} (${((missingCount / totalChecked) * 100).toFixed(2)}%)`);
}

main().catch(console.error);
