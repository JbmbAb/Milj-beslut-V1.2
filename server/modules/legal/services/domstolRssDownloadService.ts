import * as fs from 'node:fs/promises';
import path from 'node:path';
import { XMLParser } from 'fast-xml-parser';
import { resolveKnowledgeBasePath } from '../../../services/importPathService';

const DOMSTOL_RSS_FEED_URL = 'https://www.domstol.se/feed/15972/?scope=decision&searchPageId=15972';

type FetchResponseLike = {
  ok: boolean;
  status: number;
  statusText: string;
  text(): Promise<string>;
};

type FetchLike = (input: string, init?: RequestInit) => Promise<FetchResponseLike>;

interface ParsedRssItem {
  guid: { '#text'?: string } | string;
  link: string;
  title: string;
  description?: string;
  pubDate?: string;
  'a10:updated'?: string;
}

export interface DownloadedDomstolRssItem {
  guid: string;
  title: string;
  link: string;
  savedAs: string;
  savedAt: string;
}

export interface DownloadDomstolRssResult {
  feedUrl: string;
  outputDir: string;
  rawFeedPath: string;
  itemsManifestPath: string;
  processed: number;
  items: DownloadedDomstolRssItem[];
}

interface DownloadDomstolRssOptions {
  outputDir?: string;
  fetchImpl?: FetchLike;
  now?: () => Date;
}

export async function downloadDomstolRssFeed(
  options: DownloadDomstolRssOptions = {},
): Promise<DownloadDomstolRssResult> {
  const outputDir = options.outputDir ?? resolveDomstolRssDownloadDirectory();
  const fetchImpl = options.fetchImpl ?? ((input: string, init?: RequestInit) => fetch(input, init));
  const now = options.now ?? (() => new Date());

  const pagesDir = path.join(outputDir, 'pages');
  await fs.rm(outputDir, { recursive: true, force: true });
  await fs.mkdir(pagesDir, { recursive: true });

  const feedResponse = await fetchImpl(DOMSTOL_RSS_FEED_URL, {
    headers: {
      Accept: 'application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.1',
      'User-Agent': 'Miljobeslut Domstol RSS Downloader/1.0',
    },
  });

  if (!feedResponse.ok) {
    throw new Error(`Kunde inte hämta Domstolsverkets RSS-feed (${feedResponse.status} ${feedResponse.statusText})`);
  }

  const xmlText = await feedResponse.text();
  const rawFeedPath = path.join(outputDir, 'feed.xml');
  await fs.writeFile(rawFeedPath, xmlText, 'utf8');

  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    textNodeName: '#text',
    ignoreDeclaration: true,
    parseTagValue: false,
    trimValues: true,
  });

  const jsonObj = parser.parse(xmlText) as { rss?: { channel?: { item?: ParsedRssItem[] | ParsedRssItem } } };
  const parsedItems = jsonObj.rss?.channel?.item;
  const items = Array.isArray(parsedItems) ? parsedItems : parsedItems ? [parsedItems] : [];

  const downloads: DownloadedDomstolRssItem[] = [];

  for (const item of items) {
    const guid = resolveGuid(item);
    const link = item.link;
    const pageResponse = await fetchImpl(link, {
      headers: {
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.1',
        'User-Agent': 'Miljobeslut Domstol RSS Downloader/1.0',
      },
    });

    if (!pageResponse.ok) {
      throw new Error(`Kunde inte hämta Domstolssida ${link} (${pageResponse.status} ${pageResponse.statusText})`);
    }

    const savedAt = now().toISOString();
    const fileName = `${toFileSlug(guid || item.title || link)}.html`;
    await fs.writeFile(path.join(pagesDir, fileName), await pageResponse.text(), 'utf8');

    downloads.push({
      guid,
      title: item.title,
      link,
      savedAs: fileName,
      savedAt,
    });
  }

  const itemsManifestPath = path.join(outputDir, 'items.json');
  await fs.writeFile(
    itemsManifestPath,
    JSON.stringify(
      {
        feedUrl: DOMSTOL_RSS_FEED_URL,
        fetchedAt: now().toISOString(),
        processed: downloads.length,
        items: downloads,
      },
      null,
      2,
    ),
    'utf8',
  );

  return {
    feedUrl: DOMSTOL_RSS_FEED_URL,
    outputDir,
    rawFeedPath,
    itemsManifestPath,
    processed: downloads.length,
    items: downloads,
  };
}

export function resolveDomstolRssDownloadDirectory(): string {
  return resolveKnowledgeBasePath('legal', 'domstol-rss');
}

function resolveGuid(item: ParsedRssItem): string {
  if (typeof item.guid === 'string') {
    return item.guid;
  }

  return item.guid?.['#text'] || item.link || item.title;
}

function toFileSlug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
