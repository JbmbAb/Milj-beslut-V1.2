/**
 * nmdService.ts
 *
 * Marktäckeklassificering via NMD 2023 (Nationellt Marktäckedata, SLU/Naturvårdsverket).
 * Läser lokalt GeoTIFF med GDAL gdallocationinfo — kräver ingen PostGIS-rasterimport.
 *
 * Konfiguration (.env):
 *   NMD_RASTER_PATH  = sökväg till NMD2023bas_v2_1.tif
 *   GDAL_BIN_PATH    = katalog med gdallocationinfo.exe (Windows) eller tom (Linux PATH)
 *
 * Klasskoder: NMD2023 basskikt v2.1
 * @see NMD2023_Produktbeskrivning_Basskikt_NMD2023_v2_1.pdf
 */

import { spawn } from 'node:child_process';
import * as path from 'node:path';
import { logger } from '../logger';
import { getNmdMbKategori, NMD_CLASS_MAP, type NmdMbKategori } from '../modules/gis/nmdMetadata';
import { queryNmdRasterPoint } from '../modules/gis/nmdRasterService';

// ─── GDAL-anrop ──────────────────────────────────────────────────────────────

const NMD_RASTER_PATH = process.env.NMD_RASTER_PATH ?? '';
const GDAL_BIN_PATH = process.env.GDAL_BIN_PATH ?? '';
const TIMEOUT_MS = 8_000;

function getGdalTool(name: string): string {
  if (GDAL_BIN_PATH) {
    return path.join(GDAL_BIN_PATH, process.platform === 'win32' ? `${name}.exe` : name);
  }
  return name;
}

function runGdalLocationInfo(lng: number, lat: number): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!NMD_RASTER_PATH) {
      reject(new Error('NMD_RASTER_PATH ej konfigurerad i .env'));
      return;
    }

    const tool = getGdalTool('gdallocationinfo');
    // -l_srs EPSG:4326 = ta emot WGS84-koordinater (lng lat)
    const child = spawn(tool, ['-valonly', '-l_srs', 'EPSG:4326', NMD_RASTER_PATH, String(lng), String(lat)]);

    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('gdallocationinfo timeout'));
    }, TIMEOUT_MS);

    child.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    child.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`gdallocationinfo exit ${code}: ${stderr.trim()}`));
      } else {
        resolve(stdout.trim());
      }
    });
    child.on('error', (err) => { clearTimeout(timer); reject(err); });
  });
}

// ─── Publik API ───────────────────────────────────────────────────────────────

export interface NmdPointResult {
  ok: true;
  code: number;
  description: string;
  mbKategori: NmdMbKategori;
  source: 'nmd2023_gdal' | 'nmd2023_postgis';
}

export interface NmdPointError {
  ok: false;
  error: string;
}

/**
 * Slå upp NMD-marktäckeklass för en punkt i WGS84.
 * @param lat  Latitud (WGS84)
 * @param lng  Longitud (WGS84)
 */
export async function queryNmdPoint(lat: number, lng: number): Promise<NmdPointResult | NmdPointError> {
  try {
    const postgisHit = await queryNmdRasterPoint(lat, lng);
    if (postgisHit) {
      logger.debug('nmdService: punkt slogs upp via PostGIS raster', { lat, lng, code: postgisHit.code });
      return {
        ok: true,
        code: postgisHit.code,
        description: postgisHit.description,
        mbKategori: postgisHit.mbKategori,
        source: postgisHit.source,
      };
    }

    const raw = await runGdalLocationInfo(lng, lat);
    const code = parseInt(raw, 10);

    if (isNaN(code)) {
      return { ok: false, error: `Ogiltigt svar från GDAL: "${raw}"` };
    }

    const description = NMD_CLASS_MAP[code] ?? `Okänd klass (${code})`;
    const mbKategori = getNmdMbKategori(code);

    logger.debug('nmdService: punkt slogs upp', { lat, lng, code, description });
    return { ok: true, code, description, mbKategori, source: 'nmd2023_gdal' };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn('nmdService: GDAL-fel', { lat, lng, error: msg });
    return { ok: false, error: msg };
  }
}

/**
 * Kontrollera om NMD-tjänsten är konfigurerad och åtkomlig.
 */
export async function checkNmdHealth(): Promise<{ ok: boolean; rasterPath: string; error?: string }> {
  const rasterPath = NMD_RASTER_PATH;
  if (!rasterPath) {
    return { ok: false, rasterPath: '', error: 'NMD_RASTER_PATH saknas i .env' };
  }

  // Testpunkt: Stockholms innerstad
  const result = await queryNmdPoint(59.33, 18.07);
  if (!result.ok) {
    return { ok: false, rasterPath, error: (result as { ok: false; error: string }).error };
  }
  return { ok: true, rasterPath };
}
