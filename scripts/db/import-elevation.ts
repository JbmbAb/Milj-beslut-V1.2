import { execSync } from 'child_process';
import { createReadStream, createWriteStream, readdirSync, statSync, unlinkSync } from 'fs';
import { join, basename } from 'path';
import { Transform } from 'stream';

const GDAL_PATH = 'C:\\Program Files\\GDAL';
const OGR2OGR = join(GDAL_PATH, 'ogr2ogr.exe');

process.env.GDAL_DATA = join(GDAL_PATH, 'gdal-data');
process.env.PROJ_LIB = join(GDAL_PATH, 'projlib');

function findXYZFiles(dir: string): string[] {
  let results: string[] = [];
  const list = readdirSync(dir);
  list.forEach((file) => {
    const path = join(dir, file);
    const stat = statSync(path);
    if (stat && stat.isDirectory()) {
      results = results.concat(findXYZFiles(path));
    } else if (file.endsWith('.xyz')) {
      results.push(path);
    }
  });
  return results;
}

async function processXYZ(filePath: string) {
  const fileName = basename(filePath, '.xyz');
  // 1. Fix decimals using stream
  const tempCsv = join(process.cwd(), 'scratch', `${fileName}_fixed.csv`);

  await new Promise((resolve, reject) => {
    const read = createReadStream(filePath);
    const write = createWriteStream(tempCsv);
    const replaceStream = new Transform({
      transform(chunk, encoding, callback) {
        callback(null, chunk.toString().replace(/,/g, '.'));
      },
    });

    // Add header
    write.write('x y z\n');

    read.pipe(replaceStream).pipe(write);
    write.on('finish', () => {
      write.end();
      resolve(null);
    });
    write.on('error', reject);
  });

  // 2. Import as Points using ogr2ogr
  const targetTable = `lm_elevation_${fileName.toLowerCase()}`;
  const ogrCmd = `"${OGR2OGR}" -f PostgreSQL "PG:dbname='miljobeslut' host='localhost' user='miljobeslut' password='password'" "${tempCsv}" -nln env.${targetTable} -lco SCHEMA=env -lco OVERWRITE=YES -nlt POINT -oo X_POS=1 -oo Y_POS=2 -oo Z_POS=3 -oo DELIMITER=SPACE -oo SKIP_FIRST_LINE=YES -s_srs EPSG:3006`;

  try {
    // Small delay to ensure file is flushed
    await new Promise((r) => setTimeout(r, 200));
    execSync(ogrCmd);
    console.log(`Imported ${fileName} as points`);
  } catch (err) {
    console.error(`Failed to import ${fileName}:`, err);
  } finally {
    // Clean up temp CSV
    try {
      if (statSync(tempCsv).isFile()) unlinkSync(tempCsv);
    } catch {
      // Ignore cleanup errors
    }
  }
}

async function main() {
  const targetDir = process.argv[2];
  if (!targetDir) {
    console.log('Usage: npx ts-node import-elevation.ts <directory>');
    process.exit(1);
  }

  const files = findXYZFiles(targetDir);
  console.log(`Found ${files.length} XYZ files.`);

  for (const file of files) {
    await processXYZ(file);
  }
}

main().catch(console.error);
