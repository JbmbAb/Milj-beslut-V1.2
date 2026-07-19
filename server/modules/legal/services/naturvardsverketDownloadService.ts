import * as fs from 'node:fs/promises';
import path from 'node:path';
import { XMLParser } from 'fast-xml-parser';
import { resolveKnowledgeBasePath } from '../../../services/importPathService.ts';

const OPEN_DATA_URL = 'https://oppnadata.naturvardsverket.se/';
const GEODATA_CATALOG_URL = 'https://geodatakatalogen.naturvardsverket.se/';
const PROTECTED_NATURE_WFS_URL =
  'https://geodata.naturvardsverket.se/naturvardsregistret/wfs?service=WFS&request=GetCapabilities';
const LEGACY_EBH_WFS_URL = 'https://vic-wfs.naturvardsverket.se/ebh?service=WFS&request=GetCapabilities';
const OAI_BASE_URL = 'http://naturvardsverket.diva-portal.org/dice/oai';
const NVV_PUBLIC_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
  Accept: 'application/xml, text/xml, */*',
  'Accept-Language': 'sv-SE,sv;q=0.9,en;q=0.8',
};

type FetchResponseLike = {
  ok: boolean;
  status: number;
  statusText: string;
  text(): Promise<string>;
  arrayBuffer(): Promise<ArrayBuffer>;
};

type FetchLike = (input: string, init?: RequestInit) => Promise<FetchResponseLike>;

export interface DownloadNaturvardsverketKnowledgeResult {
  outputDir: string;
  files: string[];
  manifestPath: string;
}

interface NvvPdfPublication {
  title: string;
  pdfUrl: string;
  savedAs: string;
  bytes: number;
  savedAt: string;
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

  const brochuresDir = path.join(outputDir, 'broschyrer');
  let brochures: NvvPdfPublication[] = [];
  let brochureDownloadError: string | undefined;
  try {
    brochures = await downloadNaturvardsverketPdfPublications(fetchImpl, brochuresDir, now);
  } catch (error) {
    brochureDownloadError = error instanceof Error ? error.message : String(error);
    await fs.mkdir(brochuresDir, { recursive: true });
  }
  const brochureManifestPath = path.join(brochuresDir, 'manifest.json');
  await fs.writeFile(
    brochureManifestPath,
    JSON.stringify(
      {
        generatedAt: now().toISOString(),
        source: OAI_BASE_URL,
        processed: brochures.length,
        error: brochureDownloadError,
        downloads: brochures.map((brochure) => ({
          title: brochure.title,
          sourceUrl: brochure.pdfUrl,
          normalizedUrl: brochure.pdfUrl,
          savedAs: brochure.savedAs,
          contentType: 'application/pdf',
          bytes: brochure.bytes,
          savedAt: brochure.savedAt,
        })),
      },
      null,
      2,
    ),
    'utf8',
  );

  const legacyEbhProbe = await probeLegacyUrl(fetchImpl, LEGACY_EBH_WFS_URL);
  const manifestPath = path.join(outputDir, 'manifest.json');
  const files = [
    'oppnadata.html',
    'geodatakatalogen.html',
    'naturvardsregistret-wfs-capabilities.xml',
    'broschyrer/manifest.json',
  ];

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
          brochureOaiBaseUrl: OAI_BASE_URL,
        },
        files,
        brochures: {
          manifestPath: path.join('broschyrer', 'manifest.json'),
          processed: brochures.length,
          error: brochureDownloadError,
        },
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

async function probeLegacyUrl(
  fetchImpl: FetchLike,
  url: string,
): Promise<{
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

async function downloadNaturvardsverketPdfPublications(
  fetchImpl: FetchLike,
  brochuresDir: string,
  now: () => Date,
): Promise<NvvPdfPublication[]> {
  await fs.mkdir(brochuresDir, { recursive: true });

  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
  });

  const publications: NvvPdfPublication[] = [];
  let resumptionToken: string | null = null;

  do {
    let url = `${OAI_BASE_URL}?verb=ListRecords&metadataPrefix=oai_dc&set=all-naturvardsverket`;
    if (resumptionToken) {
      url = `${OAI_BASE_URL}?verb=ListRecords&resumptionToken=${encodeURIComponent(resumptionToken)}`;
    }

    const response = await fetchImpl(url, { headers: NVV_PUBLIC_HEADERS });
    if (!response.ok) {
      throw new Error(`Kunde inte hämta NVV-publikationer (${response.status} ${response.statusText})`);
    }

    const xmlData = await response.text();
    const jsonObj = parser.parse(xmlData);
    const listRecords = jsonObj['OAI-PMH']?.ListRecords;
    const records = listRecords?.record;
    const rawToken = listRecords?.resumptionToken;
    resumptionToken = typeof rawToken === 'object' ? rawToken['#text'] : rawToken;

    if (records) {
      const recordArray = Array.isArray(records) ? records : [records];
      for (const record of recordArray) {
        if (record.header?.['@_status'] === 'deleted') continue;

        const metadata = record.metadata?.['oai_dc:dc'];
        if (!metadata) continue;

        const formats = Array.isArray(metadata['dc:format'])
          ? metadata['dc:format']
          : [metadata['dc:format']];
        const isPdf = formats.some(
          (item: unknown) => typeof item === 'string' && item.toLowerCase().includes('pdf'),
        );
        if (!isPdf) continue;

        const identifier = record.header?.identifier;
        const idMatch = typeof identifier === 'string' ? identifier.match(/naturvardsverket-(\d+)$/) : null;
        if (!idMatch) continue;

        const id = idMatch[1];
        const pdfUrl = `https://naturvardsverket.diva-portal.org/smash/get/diva2:${id}/FULLTEXT01.pdf`;
        const title = normalizePublicationTitle(metadata['dc:title']) || `Naturvårdsverket ${id}`;
        const fileName = `${toFileSlug(title)}__${id}.pdf`;
        const destinationPath = path.join(brochuresDir, fileName);

        const pdfResponse = await fetchImpl(pdfUrl, {
          headers: {
            ...NVV_PUBLIC_HEADERS,
            Accept: 'application/pdf',
          },
        });

        if (!pdfResponse.ok) {
          continue;
        }

        const buffer = Buffer.from(await pdfResponse.arrayBuffer());
        await fs.mkdir(path.dirname(destinationPath), { recursive: true });
        await fs.writeFile(destinationPath, buffer);
        publications.push({
          title,
          pdfUrl,
          savedAs: `broschyrer/${fileName}`,
          bytes: buffer.byteLength,
          savedAt: now().toISOString(),
        });
      }
    }
  } while (resumptionToken);

  return publications;
}

function normalizePublicationTitle(title: unknown): string {
  if (typeof title === 'string') return title.trim();
  if (Array.isArray(title)) {
    return (
      title
        .map((item) => (typeof item === 'string' ? item.trim() : ''))
        .find(Boolean)
        ?.trim() || ''
    );
  }
  return '';
}

function toFileSlug(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[åä]/g, 'a')
      .replace(/ö/g, 'o')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'naturvardsverket'
  );
}
