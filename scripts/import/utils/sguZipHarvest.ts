import { spawnSync } from 'child_process';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import type { SguHarvestSource } from '../config/sguHarvestSources';
import { calculateFileHash } from './harvesting';

const OGRINFO_PATH = process.env.OGRINFO_PATH || 'C:\\Program Files\\GDAL\\ogrinfo.exe';

const DEFAULT_MAX_RETRIES = Number(process.env.SGU_HARVEST_MAX_RETRIES ?? 3);
const RETRY_BACKOFF_MS = [5_000, 15_000, 30_000] as const;

export type SguZipHarvestOptions = {
  source: SguHarvestSource;
  rawDir: string;
  skipDownload?: boolean;
  skipExtract?: boolean;
};

export type SguZipVerifyReport = {
  gpkgPath: string;
  layer: string;
  featureCount: number;
  expectedFeatureCount?: number;
  extentLine?: string;
  crsOk: boolean;
};

export type SguZipHarvestResult = {
  success: boolean;
  zipPath: string;
  gpkgPath: string;
  verify?: SguZipVerifyReport;
  verifyReportPath?: string;
  error?: string;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status === 502 || status === 503 || status === 504;
}

async function downloadWithRetry(url: string, destPath: string, maxRetries: number): Promise<void> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        const body = await response.text();
        if (isRetryableStatus(response.status) && attempt < maxRetries) {
          const backoff = RETRY_BACKOFF_MS[Math.min(attempt, RETRY_BACKOFF_MS.length - 1)]!;
          console.warn(`   HTTP ${response.status} — retry ${attempt + 1}/${maxRetries} in ${backoff / 1000}s`);
          await sleep(backoff);
          continue;
        }
        throw new Error(`Download failed HTTP ${response.status}: ${body.slice(0, 300)}`);
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      fs.writeFileSync(destPath, buffer);
      return;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt < maxRetries) {
        const backoff = RETRY_BACKOFF_MS[Math.min(attempt, RETRY_BACKOFF_MS.length - 1)]!;
        console.warn(`   Download error — retry ${attempt + 1}/${maxRetries} in ${backoff / 1000}s: ${lastError.message}`);
        await sleep(backoff);
      }
    }
  }

  throw lastError ?? new Error('downloadWithRetry failed');
}

/** Stream large ZIP to disk without holding full archive in Node heap. */
async function downloadWithCurl(url: string, destPath: string): Promise<void> {
  const result = spawnSync(
    'curl.exe',
    ['-L', '--retry', '3', '--retry-delay', '5', '-o', destPath, url],
    { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 },
  );
  if (result.status !== 0 || !fs.existsSync(destPath)) {
    throw new Error(`curl download failed: ${result.stderr || result.stdout}`);
  }
}

function extractZip(zipPath: string, extractDir: string): void {
  fs.mkdirSync(extractDir, { recursive: true });
  const result = spawnSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-Command',
      `Expand-Archive -LiteralPath '${zipPath.replace(/'/g, "''")}' -DestinationPath '${extractDir.replace(/'/g, "''")}' -Force`,
    ],
    { encoding: 'utf-8', maxBuffer: 50 * 1024 * 1024 },
  );
  if (result.status !== 0) {
    throw new Error(`Expand-Archive failed: ${result.stderr || result.stdout}`);
  }
}

function countLayerFeatures(gpkgPath: string, layer: string): number {
  const result = spawnSync(
    OGRINFO_PATH,
    ['-sql', `SELECT COUNT(*) AS n FROM "${layer}"`, gpkgPath],
    { encoding: 'utf-8' },
  );
  if (result.status !== 0) {
    throw new Error(`ogrinfo count failed: ${result.stderr || result.stdout}`);
  }
  return Number((`${result.stdout ?? ''}`.match(/n \(Integer\) = (\d+)/) ?? [])[1] ?? 0);
}

function verifyGpkgLayer(gpkgPath: string, layer: string, expectedFeatureCount?: number): SguZipVerifyReport {
  const layerInfo = spawnSync(OGRINFO_PATH, ['-ro', '-so', gpkgPath, layer], { encoding: 'utf-8' });
  if (layerInfo.status !== 0) {
    throw new Error(`ogrinfo layer ${layer} failed: ${layerInfo.stderr || layerInfo.stdout}`);
  }

  const output = `${layerInfo.stdout ?? ''}`;
  const featureCount = countLayerFeatures(gpkgPath, layer);
  const extentLine = output.split('\n').find((l) => l.startsWith('Extent:'));
  const crsOk =
    output.includes('EPSG",3006') ||
    output.includes('SWEREF99 TM') ||
    output.includes('PROJCRS');

  const report: SguZipVerifyReport = {
    gpkgPath,
    layer,
    featureCount,
    expectedFeatureCount,
    extentLine: extentLine?.trim(),
    crsOk,
  };

  if (expectedFeatureCount != null && featureCount !== expectedFeatureCount) {
    throw new Error(
      `Feature count mismatch on ${layer}: got ${featureCount}, expected ${expectedFeatureCount}`,
    );
  }

  return report;
}

export function sha256File(filePath: string): string {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex').toUpperCase();
}

export async function harvestSguZip(options: SguZipHarvestOptions): Promise<SguZipHarvestResult> {
  const { source, rawDir, skipDownload = false, skipExtract = false } = options;
  const zip = source.zip;
  if (!zip) {
    return { success: false, zipPath: '', gpkgPath: '', error: 'No ZIP source configured' };
  }

  fs.mkdirSync(rawDir, { recursive: true });

  const zipPath = path.join(rawDir, zip.zipFileName);
  const extractDir = path.join(rawDir, 'extracted');
  const gpkgPath = path.join(extractDir, zip.innerGpkg);

  try {
    if (!skipDownload || !fs.existsSync(zipPath)) {
      console.log(`   Downloading ZIP (${zip.zipUrl})...`);
      await downloadWithCurl(zip.zipUrl, zipPath);
      console.log(`   ZIP saved: ${zipPath} (${(fs.statSync(zipPath).size / (1024 ** 3)).toFixed(2)} GB)`);
    } else {
      console.log(`   Reusing existing ZIP: ${zipPath}`);
    }

    if (!skipExtract || !fs.existsSync(gpkgPath)) {
      console.log(`   Extracting to ${extractDir}...`);
      if (fs.existsSync(extractDir)) {
        fs.rmSync(extractDir, { recursive: true, force: true });
      }
      extractZip(zipPath, extractDir);
    } else {
      console.log(`   Reusing extracted GPKG: ${gpkgPath}`);
    }

    if (!fs.existsSync(gpkgPath)) {
      throw new Error(`Expected GPKG not found after extract: ${gpkgPath}`);
    }

    console.log(`   Verifying layer "${zip.ogrLayer}"...`);
    const verify = verifyGpkgLayer(gpkgPath, zip.ogrLayer, zip.expectedFeatureCount);
    console.log(`   Features: ${verify.featureCount.toLocaleString('sv-SE')}`);
    if (verify.extentLine) console.log(`   ${verify.extentLine}`);

    const verifyReportPath = path.join(rawDir, 'harvest-verify.json');
    fs.writeFileSync(
      verifyReportPath,
      `${JSON.stringify({ ...verify, verified_at: new Date().toISOString(), zip_sha256: await calculateFileHash(zipPath), gpkg_sha256: await calculateFileHash(gpkgPath) }, null, 2)}\n`,
      'utf8',
    );

    return { success: true, zipPath, gpkgPath, verify, verifyReportPath };
  } catch (error) {
    return {
      success: false,
      zipPath,
      gpkgPath,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
