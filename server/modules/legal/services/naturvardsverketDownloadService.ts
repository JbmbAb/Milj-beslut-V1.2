import * as fs from 'node:fs/promises';
import path from 'node:path';
import { resolveKnowledgeBasePath } from '../../../services/importPathService';

const OPEN_DATA_URL = 'https://oppnadata.naturvardsverket.se/';
const GEODATA_CATALOG_URL = 'https://geodatakatalogen.naturvardsverket.se/';
const PROTECTED_NATURE_WFS_URL =
  'https://geodata.naturvardsverket.se/naturvardsregistret/wfs?service=WFS&request=GetCapabilities';
const LEGACY_EBH_WFS_URL = 'https://vic-wfs.naturvardsverket.se/ebh?service=WFS&request=GetCapabilities';

type FetchResponseLike = {
  ok: boolean;
  status: number;
  statusText: string;
  text(): Promise<string>;
};

type FetchLike = (input: string, init?: RequestInit) => Promise<FetchResponseLike>;

export interface DownloadNaturvardsverketKnowledgeResult {
  outputDir: string;
  files: string[];
  manifestPath: string;
}

interface DownloadNaturvardsverketKnowledgeOptions {
  outputDir?: string;
  fetchImpl?: FetchLike;
  now?: () => Date;
}

export async function downloadNaturvardsverketKnowledge(
  options: DownloadNaturvardsverketKnowledgeOptions = {},
): Promise<DownloadNaturvardsverketKnowledgeResult> {
  const outputDir = options.outputDir ?? resolveNaturvardsverketDownloadDirectory();
  const fetchImpl = options.fetchImpl ?? ((input: string, init?: RequestInit) => fetch(input, init));
  const now = options.now ?? (() => new Date());

  await fs.rm(outputDir, { recursive: true, force: true });
  await fs.mkdir(outputDir, { recursive: true });

  const openData = await fetchTextFile(fetchImpl, OPEN_DATA_URL);
  await fs.writeFile(path.join(outputDir, 'oppnadata.html'), openData, 'utf8');

  const geodataCatalog = await fetchTextFile(fetchImpl, GEODATA_CATALOG_URL);
  await fs.writeFile(path.join(outputDir, 'geodatakatalogen.html'), geodataCatalog, 'utf8');

  const protectedNatureCapabilities = await fetchTextFile(fetchImpl, PROTECTED_NATURE_WFS_URL, {
    Accept: 'application/xml,text/xml;q=0.9,*/*;q=0.1',
  });
  await fs.writeFile(
    path.join(outputDir, 'naturvardsregistret-wfs-capabilities.xml'),
    protectedNatureCapabilities,
    'utf8',
  );

  const legacyEbhProbe = await probeLegacyUrl(fetchImpl, LEGACY_EBH_WFS_URL);
  const manifestPath = path.join(outputDir, 'manifest.json');
  const files = ['oppnadata.html', 'geodatakatalogen.html', 'naturvardsregistret-wfs-capabilities.xml'];

  await fs.writeFile(
    manifestPath,
    JSON.stringify(
      {
        fetchedAt: now().toISOString(),
        sources: {
          openDataUrl: OPEN_DATA_URL,
          geodataCatalogUrl: GEODATA_CATALOG_URL,
          protectedNatureWfsUrl: PROTECTED_NATURE_WFS_URL,
          legacyEbhWfsUrl: LEGACY_EBH_WFS_URL,
        },
        files,
        legacyEbhProbe,
      },
      null,
      2,
    ),
    'utf8',
  );

  return {
    outputDir,
    files,
    manifestPath,
  };
}

export function resolveNaturvardsverketDownloadDirectory(): string {
  return resolveKnowledgeBasePath('naturvardsverket');
}

async function fetchTextFile(
  fetchImpl: FetchLike,
  url: string,
  extraHeaders?: Record<string, string>,
): Promise<string> {
  const response = await fetchImpl(url, {
    headers: {
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'User-Agent': 'Miljobeslut Naturvardsverket Downloader/1.0',
      ...extraHeaders,
    },
  });

  if (!response.ok) {
    throw new Error(`Kunde inte hämta ${url} (${response.status} ${response.statusText})`);
  }

  return response.text();
}

async function probeLegacyUrl(fetchImpl: FetchLike, url: string): Promise<{
  ok: boolean;
  status?: number;
  statusText?: string;
  message?: string;
}> {
  try {
    const response = await fetchImpl(url, {
      headers: {
        Accept: 'application/xml,text/xml;q=0.9,*/*;q=0.1',
        'User-Agent': 'Miljobeslut Naturvardsverket Downloader/1.0',
      },
    });

    return {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
    };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}
