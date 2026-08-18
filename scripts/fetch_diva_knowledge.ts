import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { XMLParser } from 'fast-xml-parser';
import { resolveKnowledgeBasePath } from '../server/services/importPathService.ts';

dotenv.config();

const DIVA_DOMAIN = (process.env.DIVA_DOMAIN || 'his').trim().toLowerCase();
const BASE_URL = `https://${DIVA_DOMAIN}.diva-portal.org`;
const OAI_URL = `${BASE_URL}/dice/oai`;
const METADATA_PREFIX = (process.env.DIVA_METADATA_PREFIX || 'swepub_mods').trim();
const SET_SPEC = (process.env.DIVA_SET || `all-${DIVA_DOMAIN}`).trim();
const FROM_DATE = (process.env.DIVA_FROM || '').trim();
const MAX_RECORDS = Number.parseInt(process.env.DIVA_MAX_RECORDS || '5000', 10);
const FETCH_DELAY_MS = Number.parseInt(process.env.DIVA_DELAY_MS || '350', 10);
const DOWNLOAD_PDFS = (process.env.DIVA_DOWNLOAD_PDFS || '').trim() === '1';
const MAX_PDFS = Number.parseInt(process.env.DIVA_MAX_PDFS || '800', 10);

const OUTPUT_DIR = resolveKnowledgeBasePath(`diva-${DIVA_DOMAIN}`);
const RECORDS_DIR = path.join(OUTPUT_DIR, 'records');
const PDF_DIR = path.join(OUTPUT_DIR, 'pdf');
const MANIFEST_PATH = path.join(OUTPUT_DIR, 'manifest.json');

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  trimValues: true,
  parseTagValue: false,
  parseAttributeValue: false,
});

const HEADERS = {
  'User-Agent': 'MiljobeslutBot/1.0 (+legal-corpus-ingestion)',
  Accept: 'application/xml,text/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'sv-SE,sv;q=0.9,en;q=0.8',
};

export const DIVA_LEGACY_CLASSIFICATION = 'LEGACY_NON_AUTHORITATIVE' as const;
export const LEGACY_DYNAMIC_DIVA_ACQUISITION_BLOCKED =
  'P2-AUTH-03E1 BLOCKED: operator-selected DIVA_DOMAIN is not admissible source authority. ' +
  'Each institution requires an explicit signed SourceRegistry definition.';

function rejectLegacyDynamicDivaAcquisition(): never {
  throw new Error(LEGACY_DYNAMIC_DIVA_ACQUISITION_BLOCKED);
}

type HarvestedRecord = {
  id: string;
  title: string;
  sourceUrl: string;
  normalizedUrl: string;
  savedAs: string;
  metadataPrefix: string;
  setSpec: string;
  harvestedAt: string;
  pdfUrl?: string;
};

type HarvestedPdf = {
  id: string;
  sourceUrl: string;
  normalizedUrl: string;
  parentId: string;
  savedAs: string;
  contentType: 'application/pdf';
  bytes: number;
  savedAt: string;
};

async function main(): Promise<void> {
  rejectLegacyDynamicDivaAcquisition();

  ensureDir(OUTPUT_DIR);
  ensureDir(RECORDS_DIR);
  ensureDir(PDF_DIR);

  console.log('DiVA OAI-PMH downloader');
  console.log(`Domain: ${DIVA_DOMAIN}`);
  console.log(`Base: ${BASE_URL}`);
  console.log(`OAI: ${OAI_URL}`);
  console.log(`Set: ${SET_SPEC}`);
  console.log(`Metadata prefix: ${METADATA_PREFIX}`);
  if (FROM_DATE) {
    console.log(`From: ${FROM_DATE}`);
  }

  const records: HarvestedRecord[] = [];
  const pdfs: HarvestedPdf[] = [];
  const seenIds = new Set<string>();
  const seenPdfs = new Set<string>();

  let page = 0;
  let resumptionToken = '';

  while (records.length < MAX_RECORDS) {
    const url = buildListRecordsUrl(resumptionToken);
    const xml = await fetchText(url);
    const parsed = parser.parse(xml) as Record<string, unknown>;

    const listRecords = getListRecordsNode(parsed);
    const recordNodes = toArray(readPath(listRecords, ['record']));

    for (const node of recordNodes) {
      if (records.length >= MAX_RECORDS) {
        break;
      }

      const header = readPath(node, ['header']) as Record<string, unknown> | undefined;
      const identifier = getIdentifier(header) || `page-${page + 1}-row-${records.length + 1}`;
      if (seenIds.has(identifier)) {
        continue;
      }
      seenIds.add(identifier);

      const metadataNode = readPath(node, ['metadata']);
      const flatStrings = collectAllStringValues(metadataNode);
      const urls = uniq(flatStrings.filter((value) => /^https?:\/\//i.test(value)));
      const pdfUrl = urls.find((value) => /\.pdf(?:[?#].*)?$/i.test(value));
      const sourceUrl =
        urls.find((value) => value.includes('.diva-portal.org/smash/record.jsf')) ||
        urls.find((value) => value.includes('.diva-portal.org')) ||
        `${BASE_URL}/smash/record.jsf?pid=${encodeURIComponent(identifier)}`;

      const title =
        extractPreferredTitle(metadataNode) ||
        flatStrings.find((value) => value.length > 20 && !/^https?:\/\//i.test(value)) ||
        `DiVA record ${identifier}`;

      const fileName = `${toSafeFileName(identifier)}.json`;
      const savePath = path.join(RECORDS_DIR, fileName);
      const recordPayload = {
        identifier,
        header,
        metadata: metadataNode,
      };

      fs.writeFileSync(savePath, JSON.stringify(recordPayload, null, 2), 'utf8');

      records.push({
        id: identifier,
        title,
        sourceUrl,
        normalizedUrl: sourceUrl,
        savedAs: `records/${fileName}`,
        metadataPrefix: METADATA_PREFIX,
        setSpec: SET_SPEC,
        harvestedAt: new Date().toISOString(),
        pdfUrl,
      });

      if (DOWNLOAD_PDFS && pdfUrl && pdfs.length < MAX_PDFS && !seenPdfs.has(pdfUrl)) {
        seenPdfs.add(pdfUrl);
        try {
          const pdfName = `${toSafeFileName(identifier)}.pdf`;
          const pdfAbs = path.join(PDF_DIR, pdfName);
          if (!fs.existsSync(pdfAbs)) {
            const buffer = await fetchPdf(pdfUrl);
            fs.writeFileSync(pdfAbs, buffer);
          }
          const stat = fs.statSync(pdfAbs);
          pdfs.push({
            id: `pdf-${identifier}`,
            sourceUrl: pdfUrl,
            normalizedUrl: pdfUrl,
            parentId: identifier,
            savedAs: `pdf/${pdfName}`,
            contentType: 'application/pdf',
            bytes: stat.size,
            savedAt: new Date(stat.mtime).toISOString(),
          });
        } catch {
          // Continue on per-file failure to keep harvesting resilient.
        }
      }
    }

    page += 1;
    resumptionToken = extractResumptionToken(listRecords);
    if (!resumptionToken) {
      break;
    }

    await sleep(FETCH_DELAY_MS);
  }

  const manifest = {
    generatedAt: new Date().toISOString(),
    source: OAI_URL,
    domain: DIVA_DOMAIN,
    metadataPrefix: METADATA_PREFIX,
    setSpec: SET_SPEC,
    fromDate: FROM_DATE || undefined,
    scannedPages: page,
    records,
    pdfs,
  };

  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2), 'utf8');

  console.log(`Done. records=${records.length}, pdfs=${pdfs.length}, pages=${page}`);
  console.log(`Manifest: ${MANIFEST_PATH}`);
}

function buildListRecordsUrl(resumptionToken: string): string {
  const params = new URLSearchParams();
  params.set('verb', 'ListRecords');

  if (resumptionToken) {
    params.set('resumptionToken', resumptionToken);
  } else {
    params.set('metadataPrefix', METADATA_PREFIX);
    params.set('set', SET_SPEC);
    if (FROM_DATE) {
      params.set('from', FROM_DATE);
    }
  }

  return `${OAI_URL}?${params.toString()}`;
}

function getListRecordsNode(parsed: Record<string, unknown>): Record<string, unknown> {
  const root = (parsed['OAI-PMH'] || parsed['oai-pmh'] || parsed) as Record<string, unknown>;
  const listRecords = (root['ListRecords'] || root['listrecords']) as Record<string, unknown>;
  if (!listRecords) {
    throw new Error('OAI response missing ListRecords node');
  }
  return listRecords;
}

function getIdentifier(header?: Record<string, unknown>): string {
  if (!header) return '';
  const raw = String(header['identifier'] || '').trim();
  return raw;
}

function extractResumptionToken(listRecords: Record<string, unknown>): string {
  const tokenNode = listRecords['resumptionToken'];
  if (!tokenNode) return '';
  if (typeof tokenNode === 'string') return tokenNode.trim();
  if (typeof tokenNode === 'object') {
    const text = String((tokenNode as Record<string, unknown>)['#text'] || '').trim();
    return text;
  }
  return '';
}

function readPath(input: unknown, keys: string[]): unknown {
  let cursor = input as Record<string, unknown> | undefined;
  for (const key of keys) {
    if (!cursor || typeof cursor !== 'object') {
      return undefined;
    }
    cursor = cursor[key] as Record<string, unknown> | undefined;
  }
  return cursor;
}

function collectAllStringValues(input: unknown): string[] {
  const values: string[] = [];

  function visit(node: unknown): void {
    if (typeof node === 'string') {
      const trimmed = node.trim();
      if (trimmed) {
        values.push(trimmed);
      }
      return;
    }

    if (Array.isArray(node)) {
      for (const item of node) {
        visit(item);
      }
      return;
    }

    if (node && typeof node === 'object') {
      for (const value of Object.values(node as Record<string, unknown>)) {
        visit(value);
      }
    }
  }

  visit(input);
  return values;
}

function extractPreferredTitle(metadataNode: unknown): string {
  const candidates: string[] = [];

  function visit(node: unknown, keyHint: string): void {
    if (typeof node === 'string') {
      const value = node.trim();
      if (!value) return;
      if (/title|rubrik|titel/i.test(keyHint)) {
        candidates.push(value);
      }
      return;
    }

    if (Array.isArray(node)) {
      for (const item of node) {
        visit(item, keyHint);
      }
      return;
    }

    if (node && typeof node === 'object') {
      for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
        visit(value, key);
      }
    }
  }

  visit(metadataNode, '');
  return candidates.find((value) => value.length > 2) || '';
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, { headers: HEADERS });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${url}`);
  }
  return response.text();
}

async function fetchPdf(url: string): Promise<Buffer> {
  const response = await fetch(url, {
    headers: {
      ...HEADERS,
      Accept: 'application/pdf,*/*;q=0.8',
    },
  });

  if (!response.ok) {
    throw new Error(`PDF HTTP ${response.status} for ${url}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.byteLength < 8 || buffer.toString('utf8', 0, 4) !== '%PDF') {
    throw new Error(`Not a PDF payload for ${url}`);
  }
  return buffer;
}

function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function toArray<T>(value: T | T[] | undefined): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function toSafeFileName(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 180);
}

function uniq(values: string[]): string[] {
  return [...new Set(values)];
}

async function sleep(ms: number): Promise<void> {
  if (ms <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((error) => {
  console.error('fetch_diva_knowledge failed:', error);
  process.exitCode = 1;
});
