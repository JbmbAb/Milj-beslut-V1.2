/**
 * Promote raster from _review → GEO_Master_Archive/Rasters (raw + COG + manifest).
 *
 * Usage:
 *   node scripts/db/promote-raster-cog.mjs
 *   node scripts/db/promote-raster-cog.mjs --source="H:\...\file.tif" --dataset=NMD_2023
 *
 * Requires GDAL gdal_translate on PATH or GDAL_TRANSLATE env.
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const MASTER = 'H:\\Delade enheter\\Miljöbeslut\\GEO_Master_Archive';
const REVIEW_ROOT = path.join(MASTER, '_review');
const RASTERS_ROOT = path.join(MASTER, 'Rasters');
const GDAL_TRANSLATE =
  process.env.GDAL_TRANSLATE || 'C:\\Program Files\\GDAL\\gdal_translate.exe';

const DEFAULT_SOURCE_REL =
  'Okänd_Provider/NMD2023_Tradslag_v1_0/NMD2023_Tradslag_v1_0/NMD2023_tradslag_lark_v1_0.tif';

function parseArg(name) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
}

function resolveReviewRoot() {
  const entries = fs.readdirSync(REVIEW_ROOT, { withFileTypes: true });
  const wrapper = entries.find((e) => e.isDirectory());
  if (!wrapper) throw new Error(`No folder under ${REVIEW_ROOT}`);
  return path.join(REVIEW_ROOT, wrapper.name);
}

function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

function resolveSourceFile() {
  const explicit = parseArg('source');
  if (explicit) return path.resolve(explicit);

  const reviewRoot = resolveReviewRoot();
  const rel = parseArg('rel') || DEFAULT_SOURCE_REL;
  const candidate = rel.includes('Okänd') || rel.includes('Ok')
    ? path.join(reviewRoot, rel.split('/').slice(1).join(path.sep))
    : path.join(reviewRoot, rel.replace(/\//g, path.sep));

  if (fs.existsSync(candidate)) return candidate;

  // Fallback: resolve wrapper folder name dynamically
  const dynamic = path.join(
    reviewRoot,
    'NMD2023_Tradslag_v1_0',
    'NMD2023_Tradslag_v1_0',
    'NMD2023_tradslag_lark_v1_0.tif',
  );
  if (fs.existsSync(dynamic)) return dynamic;
  throw new Error(`Source not found. Tried: ${candidate}`);
}

const config = {
  sourceFile: resolveSourceFile(),
  targetBaseDir: RASTERS_ROOT,
  provider: parseArg('provider') || 'Naturvardsverket',
  dataset: parseArg('dataset') || 'NMD_2023',
  version: parseArg('version') || '2026-06-19',
  targetSchema: parseArg('schema') || 'staging',
  targetTable: parseArg('table') || 'nmd_2023_tradslag_lark_poc',
  moveSource: process.argv.includes('--move'),
};

async function promoteRaster() {
  console.log(`\nStartar raster-promotion: ${config.dataset}`);
  console.log(`Källa: ${config.sourceFile}`);

  if (!fs.existsSync(config.sourceFile)) {
    console.error(`FEL: Källfil saknas: ${config.sourceFile}`);
    process.exit(1);
  }

  if (!fs.existsSync(GDAL_TRANSLATE)) {
    console.error(`FEL: gdal_translate saknas: ${GDAL_TRANSLATE}`);
    process.exit(1);
  }

  const fileName = path.basename(config.sourceFile);
  const stem = fileName.replace(/\.(tif|tiff)$/i, '');
  const cogFileName = `${stem}_cog.tif`;

  const canonicalDir = path.join(
    config.targetBaseDir,
    config.provider,
    config.dataset,
    config.version,
  );
  const rawDir = path.join(canonicalDir, 'raw');
  const normalizedDir = path.join(canonicalDir, 'normalized');
  const manifestPath = path.join(canonicalDir, 'manifest.json');

  fs.mkdirSync(rawDir, { recursive: true });
  fs.mkdirSync(normalizedDir, { recursive: true });

  const rawFilePath = path.join(rawDir, fileName);
  if (config.moveSource) {
    fs.renameSync(config.sourceFile, rawFilePath);
    console.log(`Flyttade original → ${rawFilePath}`);
  } else {
    fs.copyFileSync(config.sourceFile, rawFilePath);
    console.log(`Kopierade original → ${rawFilePath}`);
  }

  const normalizedFilePath = path.join(normalizedDir, cogFileName);
  console.log('Konverterar till COG (EPSG:3006)...');

  const gdalCmd =
    `"${GDAL_TRANSLATE}" -of COG -co COMPRESS=DEFLATE -co BIGTIFF=IF_SAFER -a_srs EPSG:3006 ` +
    `"${rawFilePath}" "${normalizedFilePath}"`;
  execSync(gdalCmd, { stdio: 'inherit' });
  console.log(`COG klar: ${normalizedFilePath}`);

  const manifest = {
    provider: config.provider,
    dataset: config.dataset,
    version: config.version,
    type: 'raster_cog',
    promotion_date: new Date().toISOString(),
    source_review_path: config.sourceFile,
    raw_path: rawFilePath,
    normalized_path: normalizedFilePath,
    source_archive_sha256: sha256File(rawFilePath),
    cog_sha256: sha256File(normalizedFilePath),
    target_schema: config.targetSchema,
    target_table: config.targetTable,
    container_path: `/master-archive/Rasters/${config.provider}/${config.dataset}/${config.version}/normalized/${cogFileName}`,
    status: 'ready_for_out_of_db_registration',
  };

  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
  console.log(`Manifest: ${manifestPath}`);
  console.log(`Container path: ${manifest.container_path}`);
  console.log(`Target table: ${config.targetSchema}.${config.targetTable}`);
}

promoteRaster().catch((err) => {
  console.error(err);
  process.exit(1);
});
