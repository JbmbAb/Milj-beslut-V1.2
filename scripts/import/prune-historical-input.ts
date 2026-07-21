import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';

const INPUT_FILE = 'storage/aria2c_historical_input.txt';
const OUTPUT_FILE = 'storage/aria2c_historical_input_pruned.txt';

async function main() {
  console.log('=== Pruning Historical Maps Input File ===');
  console.log(`Input:  ${INPUT_FILE}`);
  console.log(`Output: ${OUTPUT_FILE}`);

  if (!fs.existsSync(INPUT_FILE)) {
    console.error('❌ Error: Input file does not exist.');
    process.exit(1);
  }

  const fileStream = fs.createReadStream(INPUT_FILE);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  });

  const outputStream = fs.createWriteStream(OUTPUT_FILE);

  let urlLine: string | null = null;
  let skippedCount = 0;
  let keptCount = 0;
  let lineIndex = 0;

  for await (const line of rl) {
    lineIndex++;
    if (lineIndex % 50000 === 0) {
      console.log(`  Processed ${lineIndex} lines (Kept: ${keptCount}, Skipped: ${skippedCount})...`);
    }

    if (!urlLine) {
      if (line.trim().startsWith('ftp://')) {
        urlLine = line;
      }
    } else {
      if (line.trim().startsWith('dir=')) {
        const dirPart = line.trim().substring(4); // Remove 'dir='
        const urlParts = urlLine.trim().split('/');
        const filename = urlParts[urlParts.length - 1]!;

        // Construct target local filepath
        // Replacing forward slashes and handling potential encoding quirks
        const localDir = dirPart.replace(/\//g, path.sep);
        const localPath = path.join(localDir, filename);

        // Check if the file already exists on disk
        if (fs.existsSync(localPath)) {
          skippedCount++;
        } else {
          outputStream.write(`${urlLine}\n`);
          outputStream.write(`${line}\n`);
          keptCount++;
        }
        urlLine = null; // reset for next entry
      }
    }
  }

  outputStream.end();
  console.log('\n=== Pruning Completed Successfully ===');
  console.log(`Total entries kept (not yet downloaded): ${keptCount}`);
  console.log(`Total entries skipped (already exists):  ${skippedCount}`);
}

main().catch(console.error);
