import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { resolveKnowledgeBasePath } from '../server/services/importPathService.ts';

dotenv.config();

const BASE_URL = 'https://www.sgu.se';
const ROOT_URL = `${BASE_URL}/`;
const OUTPUT_DIR = resolveKnowledgeBasePath('sgu-portal');
const PAGES_DIR = path.join(OUTPUT_DIR, 'pages');
const PDF_DIR = path.join(OUTPUT_DIR, 'pdf');
const MANIFEST_PATH = path.join(OUTPUT_DIR, 'manifest.json');
const MAX_PAGES = Number.parseInt(process.env.SGU_PORTAL_MAX_PAGES || '180', 10);
const FETCH_DELAY_MS = Number.parseInt(process.env.SGU_PORTAL_DELAY_MS || '150', 10);

const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'sv-SE,sv;q=0.9,en;q=0.8',
};

export const SGU_PORTAL_CLASSIFICATION = 'DISCOVERY_ONLY' as const;
export const LEGACY_SGU_PORTAL_ACQUISITION_BLOCKED =
  'P2-AUTH-03E1 BLOCKED: the broad SGU portal crawler is discovery-only and cannot acquire or ' +
  'persist source payloads. Governed SGU acquisition requires exact signed endpoints.';

function rejectLegacySguPortalAcquisition(): never {
  throw new Error(LEGACY_SGU_PORTAL_ACQUISITION_BLOCKED);
}

const ALLOWED_PREFIXES = [
  '/produkter-och-tjanster/geologiska-data/',
  '/produkter-och-tjanster/kartor/',
  '/produkter-och-tjanster/publikationer/',
  '/samhallsplanering/',
  '/mineralnaring/',
  '/grundvatten/',
  '/anvandarstod-for-geologiska-fragor/',
  '/om-sgu/fragor-och-svar/',
  '/om-sgu/nyheter/',
];

type SavedPage = {
  title: string;
  sourceUrl: string;
  normalizedUrl: string;
  savedAs: string;
  fetchedAt: string;
};

type SavedPdf = {
  title: string;
  sourceUrl: string;
  normalizedUrl: string;
  parentUrl: string;
  savedAs: string;
  contentType: 'application/pdf';
  bytes: number;
  savedAt: string;
};

async function main(): Promise<void> {
  rejectLegacySguPortalAcquisition();

  ensureDir(OUTPUT_DIR);
  ensureDir(PAGES_DIR);
  ensureDir(PDF_DIR);

  console.log('SGU portal downloader');
  console.log(`Root: ${ROOT_URL}`);
  console.log(`Output: ${OUTPUT_DIR}`);

  const rootHtml = await fetchText(ROOT_URL);
  const pagesToFetch = new Map<string, string>();
  pagesToFetch.set(ROOT_URL, 'SGU startsida');

  for (const url of extractRelevantUrls(rootHtml)) {
    if (pagesToFetch.size >= MAX_PAGES) break;
    pagesToFetch.set(url, inferTitleFromUrl(url));
  }

  const pages: SavedPage[] = [];
  const pdfs: SavedPdf[] = [];
  const seenPdfs = new Set<string>();

  for (const [url, fallbackTitle] of pagesToFetch) {
    try {
      const html = url === ROOT_URL ? rootHtml : await fetchText(url);
      const title = extractHtmlTitle(html) || fallbackTitle;
      const savedAs = savePage(url, html);

      pages.push({
        title,
        sourceUrl: url,
        normalizedUrl: url,
        savedAs,
        fetchedAt: new Date().toISOString(),
      });

      for (const pdfUrl of extractPdfUrls(html)) {
        if (seenPdfs.has(pdfUrl)) continue;
        seenPdfs.add(pdfUrl);

        try {
          const fileName = buildPdfFileName(title, pdfUrl);
          const abs = path.join(PDF_DIR, fileName);

          if (!fs.existsSync(abs)) {
            const buffer = await fetchPdf(pdfUrl);
            fs.writeFileSync(abs, buffer);
            console.log(`  + pdf/${fileName} (${Math.round(buffer.byteLength / 1024)} KB)`);
          }

          const stat = fs.statSync(abs);
          pdfs.push({
            title,
            sourceUrl: pdfUrl,
            normalizedUrl: pdfUrl,
            parentUrl: url,
            savedAs: `pdf/${fileName}`,
            contentType: 'application/pdf',
            bytes: stat.size,
            savedAt: new Date(stat.mtime).toISOString(),
          });
        } catch {
          // Continue on PDF failure.
        }
      }

      await sleep(FETCH_DELAY_MS);
    } catch {
      // Continue on page failure.
    }
  }

  const manifest = {
    generatedAt: new Date().toISOString(),
    source: ROOT_URL,
    scannedPages: pagesToFetch.size,
    pages,
    pdfs,
  };

  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2), 'utf8');

  console.log(`Done. pages=${pages.length}, pdfs=${pdfs.length}`);
  console.log(`Manifest: ${MANIFEST_PATH}`);
}

function extractRelevantUrls(html: string): string[] {
  const urls = new Set<string>();
  const regex = /<a[^>]+href="([^"]+)"[^>]*>/gi;

  let match: RegExpExecArray | null = regex.exec(html);
  while (match) {
    const href = match[1] || '';
    const abs = toAbsoluteUrl(href);

    if (!abs.startsWith(BASE_URL)) {
      match = regex.exec(html);
      continue;
    }

    const pathname = new URL(abs).pathname;
    if (ALLOWED_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
      urls.add(abs);
    }

    match = regex.exec(html);
  }

  return [...urls];
}

function extractPdfUrls(html: string): string[] {
  const urls = new Set<string>();
  const regex = /href="([^"\s]+\.pdf(?:\?[^"\s]*)?)"/gi;

  let match: RegExpExecArray | null = regex.exec(html);
  while (match) {
    urls.add(toAbsoluteUrl(match[1] || ''));
    match = regex.exec(html);
  }

  return [...urls];
}

function extractHtmlTitle(html: string): string {
  const m = html.match(/<title>([\s\S]*?)<\/title>/i);
  if (!m?.[1]) return '';
  return stripTags(decodeHtml(m[1])).trim();
}

function savePage(url: string, html: string): string {
  const fileName = `${normalizePathFromUrl(url)}.html`;
  const abs = path.join(PAGES_DIR, fileName);
  fs.writeFileSync(abs, html, 'utf8');
  return `pages/${fileName}`;
}

function normalizePathFromUrl(url: string): string {
  const pathname = new URL(url).pathname.replace(/\/+$/, '');
  const cleaned = pathname
    .replace(/^\/+/g, '')
    .replace(/[^a-zA-Z0-9/_-]+/g, '-')
    .replace(/\//g, '__')
    .toLowerCase();
  return cleaned || 'start';
}

function buildPdfFileName(title: string, pdfUrl: string): string {
  const slug = toSlug(title).slice(0, 80) || 'sgu-portal';
  const id = inferIdFromUrl(pdfUrl);
  return `${slug}__${id}.pdf`;
}

function inferIdFromUrl(url: string): string {
  const tail = url.split('/').pop() || 'pdf';
  return tail
    .replace(/\.pdf$/i, '')
    .replace(/[^a-zA-Z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
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

function toAbsoluteUrl(url: string): string {
  if (!url) return ROOT_URL;
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith('//')) return `https:${url}`;
  return new URL(url, BASE_URL).toString();
}

function inferTitleFromUrl(url: string): string {
  const last = new URL(url).pathname.split('/').filter(Boolean).pop() || 'sgu';
  return decodeURIComponent(last).replace(/[-_]+/g, ' ').trim();
}

function toSlug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[åä]/g, 'a')
    .replace(/ö/g, 'o')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function stripTags(value: string): string {
  return value
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((error) => {
  console.error('SGU portal downloader failed:', error);
  process.exitCode = 1;
});
