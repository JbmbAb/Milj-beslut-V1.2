import { execSync } from 'child_process';
import { readdirSync, statSync } from 'fs';
import { join, basename, extname } from 'path';

const DB_URL = process.env.DATABASE_URL || 'postgresql://miljobeslut:password@localhost:5432/miljobeslut';
const GDAL_PATH = 'C:\\Program Files\\GDAL';
const OGR2OGR = join(GDAL_PATH, 'ogr2ogr.exe');

process.env.GDAL_DATA = join(GDAL_PATH, 'gdal-data');
process.env.PROJ_LIB = join(GDAL_PATH, 'projlib');

function findFiles(dir: string, extensions: string[]): string[] {
  let results: string[] = [];
  const list = readdirSync(dir);
  list.forEach((file) => {
    const path = join(dir, file);
    const stat = statSync(path);
    if (stat && stat.isDirectory()) {
      results = results.concat(findFiles(path, extensions));
    } else {
      if (extensions.includes(extname(file).toLowerCase())) {
        results.push(path);
      }
    }
  });
  return results;
}

const importedTables = new Set<string>();

async function importFile(filePath: string, schema: string, overwrite: boolean) {
  const fileName = basename(filePath, extname(filePath));
  // Standardize table name (e.g. byggnad_1, byggnad_2 -> lm_byggnad)
  const baseName = fileName.replace(/_\d+$/, '').toLowerCase();
  const targetTable = `lm_${baseName}`;
  const fullTableName = `${schema}.${targetTable}`;

  const isFirstForTable = !importedTables.has(fullTableName);
  const shouldOverwrite = overwrite && isFirstForTable;

  console.log(`Importing ${filePath} to ${fullTableName} (Overwrite: ${shouldOverwrite})...`);

  // Parse DB_URL for ogr2ogr
  const urlMatch = DB_URL.match(/postgresql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/(.+)/);
  if (!urlMatch) throw new Error('Invalid DATABASE_URL format');
  const [, user, password, host, port, dbname] = urlMatch;

  const mode = shouldOverwrite ? '-lco OVERWRITE=YES' : '-append';
  const cmd = `"${OGR2OGR}" -f PostgreSQL "PG:dbname='${dbname}' host='${host}' user='${user}' password='${password}' port='${port}'" "${filePath}" -nln ${fullTableName} -lco SCHEMA=${schema} ${mode} -skipfailures -nlt PROMOTE_TO_MULTI --config GML_SKIP_RESOLVE_ELEMS ALL`;

  try {
    execSync(cmd, { stdio: 'inherit' });
    console.log(`Successfully imported ${fileName}`);
    importedTables.add(fullTableName);
  } catch (error) {
    console.error(`Failed to import ${fileName}:`, error);
  }
}

async function main() {
  const target = process.argv[2];
  const schema = process.argv[3] || 'core';
  const overwrite = process.argv.includes('--overwrite');

  if (!target) {
    console.log('Usage: npx ts-node mass-import-lm.ts <directory> <schema> [--overwrite]');
    process.exit(1);
  }

  const files = findFiles(target, ['.xml', '.gml', '.gpkg', '.shp']);
  console.log(`Found ${files.length} files to import.`);

  for (const file of files) {
    await importFile(file, schema, overwrite);
  }
}

main().catch(console.error);
