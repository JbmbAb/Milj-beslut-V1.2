import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { resolveKnowledgeBasePath } from '../server/services/importPathService.ts';

dotenv.config();

const BASE_URL = 'https://www.naturvardsverket.se';
const PUBLICATIONS_URL = `${BASE_URL}/publikationer/`;
const KNOWLEDGE_DIR = resolveKnowledgeBasePath('naturvardsverket');
const BROCHURES_DIR = path.join(KNOWLEDGE_DIR, 'broschyrer-site');
const MANIFEST_PATH = path.join(BROCHURES_DIR, 'manifest.json');
const MAX_LIST_PAGES = Number.parseInt(process.env.NVV_SITE_MAX_PAGES || '80', 10);
const FETCH_DELAY_MS = Number.parseInt(process.env.NVV_SITE_DELAY_MS || '250', 10);
const MAX_STALE_PAGES = Number.parseInt(process.env.NVV_SITE_MAX_STALE_PAGES || '5', 10);
const SITEMAP_URL = `${BASE_URL}/sitemap.xml`;
const MAX_SITEMAP_PUBLICATIONS = Number.parseInt(process.env.NVV_SITE_MAX_SITEMAP_PUBLICATIONS || '2000', 10);

const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'sv-SE,sv;q=0.9,en;q=0.8',
};

export const NVV_PUBLICATIONS_SITE_LEGACY_CLASSIFICATION = 'LEGACY_NON_AUTHORITATIVE' as const;
export const LEGACY_NVV_PUBLICATIONS_SITE_ACQUISITION_BLOCKED =
  'P2-AUTH-03E2-A BLOCKED: the Naturvardsverket publication website crawler cannot perform ' +
  'live acquisition. Exact document channels require separate signed source definitions.';

function rejectLegacyNvvPublicationsSiteAcquisition(): never {
  throw new Error(LEGACY_NVV_PUBLICATIONS_SITE_ACQUISITION_BLOCKED);
}

type Publication = {
  title: string;
  detailUrl: string;
};

type DownloadEntry = {
  title: string;
  sourceUrl: string;
  normalizedUrl: string;
  detailUrl: string;
  savedAs: string;
  contentType: 'application/pdf';
  bytes: number;
  savedAt: string;
};

async function main(): Promise<void> {
  rejectLegacyNvvPublicationsSiteAcquisition();

  ensureDir(BROCHURES_DIR);

  console.log('NVV site publications downloader');
  console.log(`Root: ${PUBLICATIONS_URL}`);
  console.log(`Output: ${BROCHURES_DIR}`);

  const publicationMap = new Map<string, Publication>();
  let stalePages = 0;

  for (let page = 1; page <= MAX_LIST_PAGES; page++) {
    const pageUrl = page === 1 ? PUBLICATIONS_URL : `${PUBLICATIONS_URL}?page=${page}`;
    const html = await fetchText(pageUrl);
    const items = parsePublicationLinks(html);
    if (items.length === 0) {
      console.log(`- Page ${page}: no publication links, stopping`);
      break;
    }

    const before = publicationMap.size;
    for (const item of items) {
      publicationMap.set(item.detailUrl, item);
    }
    const added = publicationMap.size - before;

    if (added === 0) {
      stalePages += 1;
    } else {
      stalePages = 0;
    }

    console.log(`- Page ${page}: +${added} new (raw ${items.length}, total ${publicationMap.size})`);
    if (stalePages >= MAX_STALE_PAGES) {
      console.log(`- Page ${page}: ${stalePages} stale pages in a row, stopping`);
      break;
    }
    await sleep(FETCH_DELAY_MS);
  }

  const publications = [...publicationMap.values()];

  const sitemapPublications = await discoverPublicationsFromSitemap();
  for (const item of sitemapPublications) {
    if (!publicationMap.has(item.detailUrl)) {
      publicationMap.set(item.detailUrl, item);
    }
  }

  const mergedPublications = [...publicationMap.values()];
  console.log(
    `Merged publication pages: ${mergedPublications.length} (listing ${publications.length} + sitemap ${sitemapPublications.length})`,
  );

  const downloads: DownloadEntry[] = [];
  const failures: Array<{ detailUrl: string; message: string }> = [];

  for (const publication of mergedPublications) {
    try {
      const detailHtml = await fetchText(publication.detailUrl);
      const pdfUrl = parsePdfLink(detailHtml);
      if (!pdfUrl) {
        continue;
      }

      const normalizedPdfUrl = toAbsoluteUrl(pdfUrl);
      const fileName = buildFileName(publication.title, normalizedPdfUrl);
      const absPath = path.join(BROCHURES_DIR, fileName);

      if (fs.existsSync(absPath)) {
        const stat = fs.statSync(absPath);
        downloads.push({
          title: publication.title,
          sourceUrl: normalizedPdfUrl,
          normalizedUrl: normalizedPdfUrl,
          detailUrl: publication.detailUrl,
          savedAs: `broschyrer-site/${fileName}`,
          contentType: 'application/pdf',
          bytes: stat.size,
          savedAt: new Date(stat.mtime).toISOString(),
        });
        continue;
      }

      const buffer = await fetchPdf(normalizedPdfUrl);
      fs.writeFileSync(absPath, buffer);

      downloads.push({
        title: publication.title,
        sourceUrl: normalizedPdfUrl,
        normalizedUrl: normalizedPdfUrl,
        detailUrl: publication.detailUrl,
        savedAs: `broschyrer-site/${fileName}`,
        contentType: 'application/pdf',
        bytes: buffer.byteLength,
        savedAt: new Date().toISOString(),
      });

      console.log(`  + ${fileName} (${Math.round(buffer.byteLength / 1024)} KB)`);
      await sleep(FETCH_DELAY_MS);
    } catch (error) {
      failures.push({
        detailUrl: publication.detailUrl,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const manifest = {
    generatedAt: new Date().toISOString(),
    source: PUBLICATIONS_URL,
    processed: downloads.length,
    scannedPublications: mergedPublications.length,
    failures,
    downloads,
  };

  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2), 'utf8');

  console.log(`Done. PDFs: ${downloads.length}, failures: ${failures.length}`);
  console.log(`Manifest: ${MANIFEST_PATH}`);
}

async function discoverPublicationsFromSitemap(): Promise<Publication[]> {
  try {
    const xml = await fetchText(SITEMAP_URL);
    const publications = parsePublicationLinksFromSitemap(xml);
    console.log(`- Sitemap discovery: +${publications.length} candidates from ${SITEMAP_URL}`);
    return publications;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`- Sitemap discovery failed: ${message}`);
    return [];
  }
}

function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
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

function parsePublicationLinks(html: string): Publication[] {
  const links = new Map<string, Publication>();

  const regex =
    /<a[^>]+href="(https?:\/\/www\.naturvardsverket\.se\/publikationer\/[^"]+|\/publikationer\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null = regex.exec(html);

  while (match) {
    const href = match[1] || '';
    const title = decodeHtml(stripTags((match[2] || '').trim()));

    if (href && title && !href.includes('#') && /\/publikationer\//i.test(href)) {
      const detailUrl = toAbsoluteUrl(href);
      links.set(detailUrl, { title, detailUrl });
    }

    match = regex.exec(html);
  }

  return [...links.values()];
}

function parsePublicationLinksFromSitemap(xml: string): Publication[] {
  const links = new Map<string, Publication>();
  const regex = /<loc>([^<]+)<\/loc>/gi;

  let match: RegExpExecArray | null = regex.exec(xml);
  while (match) {
    const raw = decodeHtml((match[1] || '').trim());
    const detailUrl = toAbsoluteUrl(raw);

    if (isPublicationDetailUrl(detailUrl)) {
      links.set(detailUrl, {
        title: inferTitleFromPublicationUrl(detailUrl),
        detailUrl,
      });
      if (links.size >= MAX_SITEMAP_PUBLICATIONS) {
        break;
      }
    }

    match = regex.exec(xml);
  }

  return [...links.values()];
}

function isPublicationDetailUrl(url: string): boolean {
  if (!url.startsWith(`${BASE_URL}/publikationer/`)) {
    return false;
  }

  const pathname = new URL(url).pathname.replace(/\/+$/, '');
  const parts = pathname.split('/').filter(Boolean);
  if (parts.length < 3 || parts[0] !== 'publikationer') {
    return false;
  }

  return true;
}

function inferTitleFromPublicationUrl(url: string): string {
  const pathname = new URL(url).pathname.replace(/\/+$/, '');
  const parts = pathname.split('/').filter(Boolean);
  const slug = parts[parts.length - 1] || 'publikation';

  return decodeURIComponent(slug).replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function parsePdfLink(html: string): string | null {
  const regex = /href="([^"]+\.pdf(?:\?[^"]*)?)"/i;
  const match = regex.exec(html);
  return match?.[1] || null;
}

function buildFileName(title: string, url: string): string {
  const idPart = inferPublicationId(url);
  const slug = toSlug(title).slice(0, 80) || 'naturvardsverket-publikation';
  return `${slug}__${idPart}.pdf`;
}

function inferPublicationId(url: string): string {
  const mIsbn = url.match(/(97[89]-[0-9-]+)/i);
  if (mIsbn?.[1]) return sanitizeId(mIsbn[1]);

  const mDiva = url.match(/diva2:(\d+)/i);
  if (mDiva?.[1]) return `diva2-${mDiva[1]}`;

  const fallback = url.split('/').pop() || 'pdf';
  return sanitizeId(fallback.replace(/\.pdf$/i, ''));
}

function sanitizeId(value: string): string {
  return value
    .replace(/[^a-zA-Z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
}

function toSlug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[åä]/g, 'a')
    .replace(/ö/g, 'o')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function toAbsoluteUrl(url: string): string {
  if (/^https?:\/\//i.test(url)) {
    return url;
  }
  if (url.startsWith('//')) {
    return `https:${url}`;
  }
  return new URL(url, BASE_URL).toString();
}

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();
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
  console.error('NVV site downloader failed:', error);
  process.exitCode = 1;
});
