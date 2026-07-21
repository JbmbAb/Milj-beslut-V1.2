/**
 * Scans SGU_DOWNLOAD_DIR for *.zip, lists GPKG layers. Run:
 *   npx tsx scripts/import/discover-sgu-downloads.ts
 */
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const OGRINFO = process.env.OGRINFO_PATH ?? 'C:\\Program Files\\GDAL\\ogrinfo.exe';
const DOWNLOAD_DIR = process.env.SGU_DOWNLOAD_DIR ?? 'C:\\Users\\jimmy\\Downloads';

const SKIP_ZIP = new Set(
  [
    '2025-151-1.zip',
    '2025-187-1.zip',
    '2025-259-2.zip',
    'Avrinningsområde egenskaper  vattenkemi.zip',
    'Brandriskdata_2022.zip',
    'InspireMSB_APSFR.zip',
    'SVARO_2016.zip',
    'VARO_2016.zip',
    'natura_2000.zip',
    'surveypoint_info.zip',
    'blender-5.1.1-windows-x64.msi',
    'QGIS-OSGeo4W-4.0.2-1.msi',
    'Docker Desktop Installer.exe',
    'tiff-jordartskartor.zip',
    'berggrund50k-250k (1).zip',
    'hydraulisk-konduktivitet-berg (1).zip',
    'GE_SGU_Bedrock_50K-250K_epsg3006.zip',
    'GE_SGU_Bedrock_1M_epsg3006.zip',
    'GE_SGU_Geophysics_epsg3006.zip',
    'backscatter (1).zip',
    'biology (1).zip',
    'depth (1).zip',
    'helcom_hub (1).zip',
    'sgu_ytsub (1).zip',
    'sgu_ytsub (2).zip',
    'substrate (1).zip',
    'fiberhaltiga-sediment (1).zip',
  ].map((s) => s.toLowerCase()),
);

function listGpkgInZip(zipPath: string): string[] {
  try {
    const out = execSync(`tar -tf "${zipPath}"`, { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
    return out
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.toLowerCase().endsWith('.gpkg'));
  } catch {
    return [];
  }
}

function listLayers(vsizipGpkg: string): Array<{ layer: string; type: string }> {
  try {
    const out = execSync(`"${OGRINFO}" -ro -q "${vsizipGpkg}"`, {
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
      timeout: 120_000,
    });
    const layers: Array<{ layer: string; type: string }> = [];
    for (const line of out.split(/\r?\n/)) {
      const m = line.match(/^\d+:\s+(\S+)\s+\((.+)\)/);
      if (m) layers.push({ layer: m[1], type: m[2] });
    }
    return layers;
  } catch {
    return [];
  }
}

function geomHint(type: string): 'polygon' | 'line' | 'point' {
  const t = type.toLowerCase();
  if (t.includes('point')) return 'point';
  if (t.includes('line')) return 'line';
  return 'polygon';
}

async function main() {
  const zips = fs
    .readdirSync(DOWNLOAD_DIR)
    .filter((f) => f.toLowerCase().endsWith('.zip'))
    .filter((f) => !SKIP_ZIP.has(f.toLowerCase()))
    .sort((a, b) => a.localeCompare(b, 'sv'));

  console.log(`Scanning ${zips.length} zip files in ${DOWNLOAD_DIR}\n`);

  const results: Array<{
    zipFile: string;
    innerGpkg: string;
    layer: string;
    geometry: string;
  }> = [];

  for (const zipFile of zips) {
    const zipPath = path.join(DOWNLOAD_DIR, zipFile);
    const gpks = listGpkgInZip(zipPath);
    if (gpks.length === 0) {
      console.log(`SKIP (no gpkg): ${zipFile}`);
      continue;
    }
    for (const innerGpkg of gpks) {
      const vsizip = `/vsizip/${zipPath.replace(/\\/g, '/')}/${innerGpkg.replace(/\\/g, '/')}`;
      const layers = listLayers(vsizip);
      if (layers.length === 0) {
        console.log(`SKIP (no layers): ${zipFile} / ${innerGpkg}`);
        continue;
      }
      for (const { layer, type } of layers) {
        results.push({
          zipFile,
          innerGpkg,
          layer,
          geometry: geomHint(type),
        });
      }
      console.log(`OK ${zipFile} → ${innerGpkg} (${layers.length} lager)`);
    }
  }

  const outPath = path.join(process.cwd(), 'storage/ingest/sgu/discovered-manifest.json');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(results, null, 2), 'utf8');
  console.log(`\nWrote ${results.length} layer entries → ${outPath}`);
}

main().catch(console.error);
