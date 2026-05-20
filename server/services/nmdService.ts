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

// ─── Klasskarta NMD2023 basskikt v2.1 ────────────────────────────────────────

export const NMD_CLASS_MAP: Record<number, string> = {
  // Exploaterad mark
  51: 'Exploaterad mark, byggnad',
  52: 'Exploaterad mark, ej byggnad eller väg/järnväg',
  53: 'Exploaterad mark, väg/järnväg',
  54: 'Exploaterad mark, torvtäkt',
  // Vatten
  61: 'Sjö och vattendrag',
  62: 'Hav',
  // Skog på fastmark
  111: 'Tallskog på fastmark',
  112: 'Granskog på fastmark',
  113: 'Barrblandskog på fastmark',
  114: 'Lövblandad barrskog på fastmark',
  115: 'Triviallövskog på fastmark',
  116: 'Ädellövskog på fastmark',
  117: 'Triviallövskog med ädellövinslag på fastmark',
  118: 'Temporärt ej skog på fastmark (hygge/ungskog)',
  // Skog på våtmark
  121: 'Tallskog på våtmark',
  122: 'Granskog på våtmark',
  123: 'Barrblandskog på våtmark',
  124: 'Lövblandad barrskog på våtmark',
  125: 'Triviallövskog på våtmark',
  126: 'Ädellövskog på våtmark',
  127: 'Triviallövskog med ädellövinslag på våtmark',
  128: 'Temporärt ej skog på våtmark',
  // Fjällskog
  23: 'Låg fjällskog på våtmark',
  43: 'Låg fjällskog på fastmark',
  // Jordbruksmark (underindelning saknas i basskikt)
  3: 'Åkermark',
  // Öppen våtmark
  200: 'Öppen våtmark (underindelning saknas)',
  211: 'Buskmyr',
  212: 'Ristuvemyr',
  213: 'Fastmattemyr, mager',
  214: 'Fastmattemyr, frodig',
  215: 'Sumpkärr',
  216: 'Mjukmattemyr',
  217: 'Lösbottenmyr',
  218: 'Övrig öppen myr',
  221: 'Trädbevuxen våtmark, risbevuxen',
  222: 'Risdominerad våtmark',
  223: 'Gräsdominerad våtmark, mager',
  224: 'Gräsdominerad våtmark, frodvuxen',
  225: 'Gräsdominerad våtmark, högvuxen',
  226: 'Mossdominerad våtmark',
  227: 'Våtmark utan växttäcke',
  228: 'Övrig öppen våtmark',
  230: 'Låg fjällskog på övrig våtmark',
  // Öppen fastmark
  411: 'Öppen mark utan vegetation (ej glaciär)',
  412: 'Glaciär',
  413: 'Varaktigt snöfält',
  4211: 'Torr buskdominerad mark',
  4212: 'Frisk buskdominerad mark',
  4213: 'Frisk-fuktig buskdominerad mark',
  4221: 'Torr risdominerad mark',
  4222: 'Frisk risdominerad mark',
  4223: 'Frisk-fuktig risdominerad mark',
  4231: 'Torr gräsdominerad mark',
  4232: 'Frisk gräsdominerad mark',
  4233: 'Frisk-fuktig gräsdominerad mark',
};

// ─── MB-kategorier (förenklad) ───────────────────────────────────────────────

export type NmdMbKategori =
  | 'skog'
  | 'jordbruksmark'
  | 'vatmark'
  | 'vatten'
  | 'exploaterad'
  | 'fjall'
  | 'oppen_mark'
  | 'okand';

export function getNmdMbKategori(code: number): NmdMbKategori {
  if (code >= 111 && code <= 128) return 'skog';
  if (code === 23 || code === 43) return 'fjall';
  if (code === 3) return 'jordbruksmark';
  if ((code >= 200 && code <= 230) || (code >= 211 && code <= 228)) return 'vatmark';
  if (code === 61 || code === 62) return 'vatten';
  if (code >= 51 && code <= 54) return 'exploaterad';
  if (code >= 411 && code <= 4233) return 'oppen_mark';
  return 'okand';
}

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
  source: 'nmd2023_gdal';
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
