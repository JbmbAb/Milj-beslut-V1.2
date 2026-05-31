/**
 * SGU jordartsgenskaper – grovt nationellt rutnät (GeoTIFF, EPSG:3006).
 * Punktavläsning via GDAL gdallocationinfo (samma mönster som nmdService).
 *
 * Konfiguration (.env):
 *   SGU_JORDART_RASTER_DIR = katalog med Tiff_jordartskartor/<lager>/<lager>_3006.tif
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { logger } from '../logger';

export interface SguJordartRasterLayer {
  key: string;
  label: string;
  unit: string;
  fileName: string;
}

export const SGU_JORDART_RASTER_LAYERS: SguJordartRasterLayer[] = [
  { key: 'ph', label: 'pH', unit: '-', fileName: 'ph/ph_3006.tif' },
  { key: 'lerhalt', label: 'Lerhalt', unit: '%', fileName: 'lerhalt/lerhalt_3006.tif' },
  { key: 'sand', label: 'Sand', unit: '%', fileName: 'sand/sand_3006.tif' },
  { key: 'silt', label: 'Silt', unit: '%', fileName: 'silt/silt_3006.tif' },
  { key: 'mull', label: 'Mullhalt', unit: '%', fileName: 'mull/mull_3006.tif' },
  { key: 'alal', label: 'Aluminium', unit: 'mg/kg', fileName: 'alal/alal_3006.tif' },
  { key: 'caal', label: 'Kalcium', unit: 'mg/kg', fileName: 'caal/caal_3006.tif' },
  { key: 'feal', label: 'Järn', unit: 'mg/kg', fileName: 'feal/feal_3006.tif' },
  { key: 'kal', label: 'Kalium', unit: 'mg/kg', fileName: 'kal/kal_3006.tif' },
  { key: 'mgal', label: 'Magnesium', unit: 'mg/kg', fileName: 'mgal/mgal_3006.tif' },
  { key: 'pal', label: 'Fosfor', unit: 'mg/kg', fileName: 'pal/pal_3006.tif' },
  { key: 'dpsal', label: 'Dp-saturering', unit: '-', fileName: 'dpsal/dpsal_3006.tif' },
  {
    key: 'pscmmolkg',
    label: 'Kationbyteskapacitet',
    unit: 'cmol/kg',
    fileName: 'pscmmolkg/pscmmolkg_3006.tif',
  },
];

const DEFAULT_RASTER_DIR = path.join(
  process.cwd(),
  'storage',
  'ingest',
  'sgu',
  'jordart-raster',
  'Tiff_jordartskartor',
);

const SGU_JORDART_RASTER_DIR = process.env.SGU_JORDART_RASTER_DIR ?? DEFAULT_RASTER_DIR;
const GDAL_BIN_PATH = process.env.GDAL_BIN_PATH ?? '';
const TIMEOUT_MS = 8_000;

function getGdalTool(name: string): string {
  if (GDAL_BIN_PATH) {
    return path.join(GDAL_BIN_PATH, process.platform === 'win32' ? `${name}.exe` : name);
  }
  return name;
}

function resolveRasterPath(relativeFile: string): string | null {
  const abs = path.join(SGU_JORDART_RASTER_DIR, relativeFile);
  return fs.existsSync(abs) ? abs : null;
}

function runGdalLocationInfo(rasterPath: string, lng: number, lat: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const tool = getGdalTool('gdallocationinfo');
    const child = spawn(tool, ['-valonly', '-l_srs', 'EPSG:4326', rasterPath, String(lng), String(lat)]);

    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('gdallocationinfo timeout'));
    }, TIMEOUT_MS);

    child.stdout.on('data', (d: Buffer) => {
      stdout += d.toString();
    });
    child.stderr.on('data', (d: Buffer) => {
      stderr += d.toString();
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`gdallocationinfo exit ${code}: ${stderr.trim()}`));
        return;
      }
      resolve(stdout.trim());
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

export interface SguJordartRasterPointValue {
  key: string;
  label: string;
  unit: string;
  value: number | null;
}

export interface SguJordartRasterPointResult {
  ok: true;
  source: 'sgu_jordart_raster_gdal';
  rasterDir: string;
  coordinates: { lng: number; lat: number };
  layers: SguJordartRasterPointValue[];
}

export interface SguJordartRasterPointError {
  ok: false;
  error: string;
}

export async function querySguJordartRasterPoint(
  lat: number,
  lng: number,
  layerKeys?: string[],
): Promise<SguJordartRasterPointResult | SguJordartRasterPointError> {
  // 1. Validera koordinater (WGS84)
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return { ok: false, error: 'Ogiltiga koordinater (WGS84 krävs)' };
  }

  if (!fs.existsSync(SGU_JORDART_RASTER_DIR)) {
    return { ok: false, error: `SGU_JORDART_RASTER_DIR saknas: ${SGU_JORDART_RASTER_DIR}` };
  }

  const selected = layerKeys?.length
    ? SGU_JORDART_RASTER_LAYERS.filter((layer) => layerKeys.includes(layer.key))
    : SGU_JORDART_RASTER_LAYERS;

  // 2. Parallellisera GDAL-anrop för att drastiskt förbättra prestanda
  const results = await Promise.all(
    selected.map(async (layer): Promise<SguJordartRasterPointValue> => {
      const rasterPath = resolveRasterPath(layer.fileName);
      if (!rasterPath) {
        return { key: layer.key, label: layer.label, unit: layer.unit, value: null };
      }

      try {
        const raw = await runGdalLocationInfo(rasterPath, lng, lat);
        const value = raw === '' || raw.toLowerCase() === 'nan' ? null : Number(raw);
        return {
          key: layer.key,
          label: layer.label,
          unit: layer.unit,
          value: Number.isFinite(value) ? value : null,
        };
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        logger.warn('sguJordartRasterService: GDAL-fel', {
          layer: layer.key,
          lat,
          lng,
          error: message,
        });
        return { key: layer.key, label: layer.label, unit: layer.unit, value: null };
      }
    }),
  );

  return {
    ok: true,
    source: 'sgu_jordart_raster_gdal',
    rasterDir: SGU_JORDART_RASTER_DIR,
    coordinates: { lng, lat },
    layers: results,
  };
}

/**
 * Kontrollera om SGU Jordart-rastertjänsten är konfigurerad och åtkomlig.
 */
export async function checkSguJordartRasterHealth(): Promise<{
  ok: boolean;
  rasterDir: string;
  layerCount: number;
  error?: string;
}> {
  const rasterDir = SGU_JORDART_RASTER_DIR;
  if (!fs.existsSync(rasterDir)) {
    return { ok: false, rasterDir, layerCount: 0, error: 'SGU_JORDART_RASTER_DIR saknas' };
  }

  const availableLayers = listSguJordartRasterLayers();
  if (availableLayers.length === 0) {
    return { ok: false, rasterDir, layerCount: 0, error: 'Inga GeoTIFF-filer hittades' };
  }

  // Test-anrop för att verifiera GDAL (Stockholm)
  try {
    const testLayer = availableLayers[0];
    const rasterPath = resolveRasterPath(testLayer.fileName);
    if (rasterPath) {
      await runGdalLocationInfo(rasterPath, 18.06, 59.33);
    }
    return { ok: true, rasterDir, layerCount: availableLayers.length };
  } catch (err) {
    return {
      ok: false,
      rasterDir,
      layerCount: availableLayers.length,
      error: `GDAL-test misslyckades: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

export function listSguJordartRasterLayers(): SguJordartRasterLayer[] {
  return SGU_JORDART_RASTER_LAYERS.filter((layer) => resolveRasterPath(layer.fileName));
}
