import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const OGR2OGR_PATH = process.env.OGR2OGR_PATH || 'C:\\Program Files\\GDAL\\ogr2ogr.exe';
const OGRINFO_PATH = process.env.OGRINFO_PATH || 'C:\\Program Files\\GDAL\\ogrinfo.exe';

const DEFAULT_PAGE_SIZE = Number(process.env.SGU_HARVEST_PAGE_SIZE ?? 5000);
const DEFAULT_CHUNK_DELAY_MS = Number(process.env.SGU_HARVEST_CHUNK_DELAY_MS ?? 750);
const DEFAULT_MAX_RETRIES = Number(process.env.SGU_HARVEST_MAX_RETRIES ?? 3);
const RETRY_BACKOFF_MS = [5_000, 15_000, 30_000] as const;

export type SguCollectionConfig = {
  id: string;
  url: string;
};

type GeoJsonFeatureCollection = {
  type: 'FeatureCollection';
  features: Array<{ type: 'Feature'; id?: string; properties: Record<string, unknown>; geometry: unknown }>;
  numberMatched?: number;
  numberReturned?: number;
};

type HarvestCheckpoint = {
  startIndex: number;
  pagesCompleted: number;
  featuresWritten: number;
  numberMatched: number;
  updated_at: string;
};

export type SguHarvestOptions = {
  collection: SguCollectionConfig;
  outputGpkg: string;
  workDir: string;
  pageSize?: number;
  chunkDelayMs?: number;
  maxRetries?: number;
  featureLimit?: number;
  resume?: boolean;
  onPage?: (info: { pageNumber: number; startIndex: number; returned: number; totalWritten: number; numberMatched: number }) => void;
};

export type SguHarvestResult = {
  success: boolean;
  featuresWritten: number;
  pagesFetched: number;
  numberMatched: number;
  gpkgFeatureCount: number;
  outputGpkg: string;
  paginationLogPath: string;
  checkpointPath: string;
  error?: string;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function itemsUrl(collectionUrl: string): string {
  return `${collectionUrl.replace(/\/$/, '')}/items`;
}

function checkpointPath(workDir: string): string {
  return path.join(workDir, 'harvest-checkpoint.json');
}

function paginationLogPath(workDir: string): string {
  return path.join(workDir, 'pagination.log');
}

function loadCheckpoint(workDir: string): HarvestCheckpoint | null {
  const cp = checkpointPath(workDir);
  if (!fs.existsSync(cp)) return null;
  return JSON.parse(fs.readFileSync(cp, 'utf8')) as HarvestCheckpoint;
}

function saveCheckpoint(workDir: string, checkpoint: HarvestCheckpoint): void {
  fs.mkdirSync(workDir, { recursive: true });
  fs.writeFileSync(checkpointPath(workDir), `${JSON.stringify(checkpoint, null, 2)}\n`, 'utf8');
}

function appendPaginationLog(workDir: string, line: string): void {
  fs.mkdirSync(workDir, { recursive: true });
  fs.appendFileSync(paginationLogPath(workDir), `${line}\n`, 'utf8');
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status === 502 || status === 503 || status === 504;
}

async function fetchPageWithRetry(
  url: string,
  maxRetries: number,
): Promise<GeoJsonFeatureCollection> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { Accept: 'application/geo+json, application/json' },
      });

      if (response.ok) {
        return (await response.json()) as GeoJsonFeatureCollection;
      }

      const body = await response.text();
      if (isRetryableStatus(response.status) && attempt < maxRetries) {
        const backoff = RETRY_BACKOFF_MS[Math.min(attempt, RETRY_BACKOFF_MS.length - 1)]!;
        console.warn(`   HTTP ${response.status} — retry ${attempt + 1}/${maxRetries} in ${backoff / 1000}s`);
        await sleep(backoff);
        continue;
      }

      throw new Error(`SGU API ${response.status}: ${body.slice(0, 500)}`);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt < maxRetries) {
        const backoff = RETRY_BACKOFF_MS[Math.min(attempt, RETRY_BACKOFF_MS.length - 1)]!;
        console.warn(`   Network error — retry ${attempt + 1}/${maxRetries} in ${backoff / 1000}s: ${lastError.message}`);
        await sleep(backoff);
        continue;
      }
    }
  }

  throw lastError ?? new Error('fetchPageWithRetry failed without error');
}

function ogrEnv(): NodeJS.ProcessEnv {
  return { ...process.env, OAMS_TRADITIONAL_GIS_ORDER: 'YES' };
}

function appendPageToGpkg(
  pageGeoJsonPath: string,
  outputGpkg: string,
  layerName: string,
  overwrite: boolean,
): void {
  const args = [
    '-f',
    'GPKG',
    outputGpkg,
    pageGeoJsonPath,
    '-t_srs',
    'EPSG:3006',
    '-nln',
    layerName,
  ];

  if (overwrite) {
    args.push('-overwrite');
  } else {
    args.push('-update', '-append');
  }

  const result = spawnSync(OGR2OGR_PATH, args, {
    encoding: 'utf-8',
    maxBuffer: 50 * 1024 * 1024,
    env: ogrEnv(),
  });

  if (result.status !== 0) {
    const detail = `${result.stderr ?? ''}\n${result.stdout ?? ''}`.trim();
    throw new Error(`ogr2ogr ${overwrite ? 'create' : 'append'} failed: ${detail}`);
  }
}

function countGpkgFeatures(outputGpkg: string, layerName: string): number {
  const result = spawnSync(
    OGRINFO_PATH,
    ['-sql', `SELECT COUNT(*) AS n FROM "${layerName}"`, outputGpkg],
    { encoding: 'utf-8' },
  );
  return Number((`${result.stdout ?? ''}`.match(/n \(Integer\) = (\d+)/) ?? [])[1] ?? 0);
}

export async function harvestSguCollection(options: SguHarvestOptions): Promise<SguHarvestResult> {
  const {
    collection,
    outputGpkg,
    workDir,
    pageSize = DEFAULT_PAGE_SIZE,
    chunkDelayMs = DEFAULT_CHUNK_DELAY_MS,
    maxRetries = DEFAULT_MAX_RETRIES,
    featureLimit,
    resume = false,
    onPage,
  } = options;

  fs.mkdirSync(workDir, { recursive: true });
  fs.mkdirSync(path.dirname(outputGpkg), { recursive: true });

  const cpFile = checkpointPath(workDir);
  const logFile = paginationLogPath(workDir);
  const existingCheckpoint = resume ? loadCheckpoint(workDir) : null;

  if (!resume && fs.existsSync(outputGpkg)) {
    fs.unlinkSync(outputGpkg);
  }
  if (!resume && fs.existsSync(cpFile)) {
    fs.unlinkSync(cpFile);
  }
  if (!resume && fs.existsSync(logFile)) {
    fs.unlinkSync(logFile);
  }

  let startIndex = existingCheckpoint?.startIndex ?? 0;
  let pagesCompleted = existingCheckpoint?.pagesCompleted ?? 0;
  let featuresWritten = existingCheckpoint?.featuresWritten ?? 0;
  let numberMatched = existingCheckpoint?.numberMatched ?? 0;

  if (resume && existingCheckpoint && !fs.existsSync(outputGpkg)) {
    throw new Error(`Resume requested but GPKG missing: ${outputGpkg}`);
  }

  const baseItemsUrl = itemsUrl(collection.url);

  while (true) {
    if (featureLimit != null && featuresWritten >= featureLimit) break;

    const params = new URLSearchParams({
      limit: String(pageSize),
      startIndex: String(startIndex),
    });
    const pageUrl = `${baseItemsUrl}?${params.toString()}`;
    const page = await fetchPageWithRetry(pageUrl, maxRetries);
    numberMatched = page.numberMatched ?? numberMatched;
    const returned = page.features?.length ?? 0;

    if (returned === 0) break;

    const pageNumber = pagesCompleted + 1;
    const pagePath = path.join(workDir, `page_${String(pageNumber).padStart(5, '0')}.geojson`);
    const pagePayload: GeoJsonFeatureCollection = {
      type: 'FeatureCollection',
      features: page.features,
    };

    if (featureLimit != null && featuresWritten + returned > featureLimit) {
      pagePayload.features = pagePayload.features.slice(0, featureLimit - featuresWritten);
    }

    fs.writeFileSync(pagePath, JSON.stringify(pagePayload), 'utf8');

    const overwrite = pagesCompleted === 0 && !fs.existsSync(outputGpkg);
    appendPageToGpkg(pagePath, outputGpkg, collection.id, overwrite);

    fs.unlinkSync(pagePath);

    const writtenThisPage = pagePayload.features.length;
    featuresWritten += writtenThisPage;
    pagesCompleted += 1;
    startIndex += pageSize;

    const logLine = `page=${pageNumber} startIndex=${startIndex - pageSize} returned=${returned} written=${writtenThisPage} total=${featuresWritten} numberMatched=${numberMatched}`;
    appendPaginationLog(workDir, logLine);
    onPage?.({
      pageNumber,
      startIndex: startIndex - pageSize,
      returned,
      totalWritten: featuresWritten,
      numberMatched,
    });

    saveCheckpoint(workDir, {
      startIndex,
      pagesCompleted,
      featuresWritten,
      numberMatched,
      updated_at: new Date().toISOString(),
    });

    if (returned < pageSize) break;
    if (featureLimit != null && featuresWritten >= featureLimit) break;

    await sleep(chunkDelayMs);
  }

  const gpkgFeatureCount = fs.existsSync(outputGpkg) ? countGpkgFeatures(outputGpkg, collection.id) : 0;
  const countOk = numberMatched === 0 || gpkgFeatureCount === featuresWritten;
  const matchedOk = featureLimit != null || numberMatched === 0 || gpkgFeatureCount === numberMatched;

  if (!countOk) {
    return {
      success: false,
      featuresWritten,
      pagesFetched: pagesCompleted,
      numberMatched,
      gpkgFeatureCount,
      outputGpkg,
      paginationLogPath: logFile,
      checkpointPath: cpFile,
      error: `Internal count mismatch: wrote ${featuresWritten}, GPKG has ${gpkgFeatureCount}`,
    };
  }

  if (!matchedOk) {
    return {
      success: false,
      featuresWritten,
      pagesFetched: pagesCompleted,
      numberMatched,
      gpkgFeatureCount,
      outputGpkg,
      paginationLogPath: logFile,
      checkpointPath: cpFile,
      error: `Incomplete harvest: GPKG ${gpkgFeatureCount} vs API numberMatched ${numberMatched}`,
    };
  }

  if (fs.existsSync(cpFile)) fs.unlinkSync(cpFile);

  return {
    success: true,
    featuresWritten,
    pagesFetched: pagesCompleted,
    numberMatched,
    gpkgFeatureCount,
    outputGpkg,
    paginationLogPath: logFile,
    checkpointPath: cpFile,
  };
}
