import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { resolveKnowledgeBasePath } from '../server/services/importPathService.ts';

dotenv.config();

const BASE_URL = 'https://www.sgu.se';
const ROOT_URL = `${BASE_URL}/bergsstaten/`;
const OUTPUT_DIR = resolveKnowledgeBasePath('bergsstaten');
const PAGES_DIR = path.join(OUTPUT_DIR, 'pages');
const PDF_DIR = path.join(OUTPUT_DIR, 'pdf');
const MANIFEST_PATH = path.join(OUTPUT_DIR, 'manifest.json');
const MAX_NOTICE_PAGES = Number.parseInt(process.env.BERGSSTATEN_MAX_NOTICE_PAGES || '250', 10);
const FETCH_DELAY_MS = Number.parseInt(process.env.BERGSSTATEN_DELAY_MS || '200', 10);

const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'sv-SE,sv;q=0.9,en;q=0.8',
};

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
  ensureDir(OUTPUT_DIR);
  ensureDir(PAGES_DIR);
  ensureDir(PDF_DIR);

  console.log('Bergsstaten legal downloader');
  console.log(`Root: ${ROOT_URL}`);
  console.log(`Output: ${OUTPUT_DIR}`);

  const pagesToFetch = new Map<string, string>();
  const pages: SavedPage[] = [];
  const pdfs: SavedPdf[] = [];

  const homepageHtml = await fetchText(ROOT_URL);
  pagesToFetch.set(ROOT_URL, 'Bergsstaten startsida');

  const seedUrls = extractRelevantPageUrls(homepageHtml);
  for (const url of seedUrls) {
    pagesToFetch.set(url, inferTitleFromUrl(url));
  }

  const noticeListingUrls = [
    `${BASE_URL}/bergsstaten/om-bergsstaten/kungorelser/`,
    `${BASE_URL}/bergsstaten/om-bergsstaten/nyheter/`,
    `${BASE_URL}/bergsstaten/om-bergsstaten/aktuellt-diarium/`,
  ];

  for (const listUrl of noticeListingUrls) {
    try {
      const html = listUrl === ROOT_URL ? homepageHtml : await fetchText(listUrl);
      pagesToFetch.set(listUrl, inferTitleFromUrl(listUrl));
      for (const entry of extractNoticeItemUrls(html)) {
        if (pagesToFetch.size >= MAX_NOTICE_PAGES) {
          break;
        }
        pagesToFetch.set(entry, inferTitleFromUrl(entry));
      }
    } catch {
      // Ignore individual listing failures and continue with available sources.
    }
  }

  console.log(`Page candidates: ${pagesToFetch.size}`);

  const downloadedPdfUrls = new Set<string>();

  for (const [url, fallbackTitle] of pagesToFetch) {
    try {
      const html = url === ROOT_URL ? homepageHtml : await fetchText(url);
      const title = extractHtmlTitle(html) || fallbackTitle;
      const savedAs = savePage(url, html);
      pages.push({
        title,
        sourceUrl: url,
        normalizedUrl: url,
        savedAs,
        fetchedAt: new Date().toISOString(),
      });

      const pdfUrls = extractPdfUrls(html);
      for (const pdfUrl of pdfUrls) {
        if (downloadedPdfUrls.has(pdfUrl)) {
          continue;
        }

        downloadedPdfUrls.add(pdfUrl);
        try {
          const fileName = buildPdfFileName(title, pdfUrl);
          const absPath = path.join(PDF_DIR, fileName);

          if (!fs.existsSync(absPath)) {
            const buffer = await fetchPdf(pdfUrl);
            fs.writeFileSync(absPath, buffer);
            console.log(`  + pdf/${fileName} (${Math.round(buffer.byteLength / 1024)} KB)`);
          }

          const stat = fs.statSync(absPath);
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
          // Keep crawling even if one PDF fails.
        }
      }

      await sleep(FETCH_DELAY_MS);
    } catch {
      // Keep crawling even when a page fails.
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

function extractRelevantPageUrls(html: string): string[] {
  const urls = new Set<string>();
  const linkRegex = /<a[^>]+href="([^"]+)"[^>]*>/gi;

  let match: RegExpExecArray | null = linkRegex.exec(html);
  while (match) {
    const href = match[1] || '';
    if (!href) {
      match = linkRegex.exec(html);
      continue;
    }

    const absolute = toAbsoluteUrl(href);
    if (!absolute.startsWith(`${BASE_URL}/bergsstaten/`)) {
      match = linkRegex.exec(html);
      continue;
    }

    if (
      /\/bergsstaten\/om-bergsstaten\/(kartvisaren-mineralrattigheter|aktuellt-diarium|kungorelser|nyheter)/i.test(
        absolute,
      ) ||
      /\/bergsstaten\/(undersokningstillstand|blanketter|gruvor\/gamla-gruvkartor)/i.test(absolute)
    ) {
      urls.add(absolute);
    }

    match = linkRegex.exec(html);
  }

  return [...urls];
}

function extractNoticeItemUrls(html: string): string[] {
  const urls = new Set<string>();
  const regex = /href="([^"]*\/bergsstaten\/om-bergsstaten\/(kungorelser|nyheter)\/[^"#]+)"/gi;

  let match: RegExpExecArray | null = regex.exec(html);
  while (match) {
    urls.add(toAbsoluteUrl(match[1] || ''));
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
  if (!m?.[1]) {
    return '';
  }

  return stripTags(decodeHtml(m[1])).trim();
}

function savePage(url: string, html: string): string {
  const relative = normalizePathFromUrl(url);
  const fileName = `${relative}.html`;
  const absPath = path.join(PAGES_DIR, fileName);
  ensureDir(path.dirname(absPath));
  fs.writeFileSync(absPath, html, 'utf8');
  return `pages/${fileName.replace(/\\/g, '/')}`;
}

function normalizePathFromUrl(url: string): string {
  const pathname = new URL(url).pathname.replace(/\/+$/, '');
  const cleaned = pathname
    .replace(/^\/+/g, '')
    .replace(/^bergsstaten\//, '')
    .replace(/[^a-zA-Z0-9/_-]+/g, '-');

  if (!cleaned) {
    return 'startsida';
  }

  return cleaned.replace(/\//g, '__').toLowerCase();
}

function buildPdfFileName(title: string, pdfUrl: string): string {
  const base = toSlug(title).slice(0, 80) || 'bergsstaten-dokument';
  const idPart = inferIdFromUrl(pdfUrl);
  return `${base}__${idPart}.pdf`;
}

function inferIdFromUrl(url: string): string {
  const candidate = url.split('/').pop() || 'pdf';
  return candidate
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
  if (!url) {
    return ROOT_URL;
  }

  if (/^https?:\/\//i.test(url)) {
    return url;
  }
  if (url.startsWith('//')) {
    return `https:${url}`;
  }

  return new URL(url, BASE_URL).toString();
}

function inferTitleFromUrl(url: string): string {
  const pathname = new URL(url).pathname;
  const last = pathname.split('/').filter(Boolean).pop() || 'bergsstaten';
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
  console.error('Bergsstaten downloader failed:', error);
  process.exitCode = 1;
});
