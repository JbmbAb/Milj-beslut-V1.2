import * as fs from 'node:fs/promises';
import path from 'node:path';
import { resolveKnowledgeBasePath } from '../../../services/importPathService';

export interface ModCorpusResult {
  outputDir: string;
  manifestPath: string;
  processed: number;
}

interface ModCorpusOptions {
  sourceDir?: string;
  outputDir?: string;
  now?: () => Date;
}

interface DomstolRssItem {
  guid: string;
  title: string;
  link: string;
  savedAs: string;
  savedAt: string;
}

interface DomstolRssManifest {
  feedUrl: string;
  fetchedAt: string;
  processed: number;
  items: DomstolRssItem[];
}

export async function buildModCorpus(options: ModCorpusOptions = {}): Promise<ModCorpusResult> {
  const sourceDir = options.sourceDir ?? resolveDomstolRssDirectory();
  const outputDir = options.outputDir ?? resolveModCorpusDirectory();
  const now = options.now ?? (() => new Date());

  const manifestRaw = await fs.readFile(path.join(sourceDir, 'items.json'), 'utf8');
  const manifest = JSON.parse(manifestRaw) as DomstolRssManifest;
  const pagesDir = path.join(sourceDir, 'pages');
  const targetPagesDir = path.join(outputDir, 'pages');

  await fs.rm(outputDir, { recursive: true, force: true });
  await fs.mkdir(targetPagesDir, { recursive: true });

  const matchedItems = manifest.items.filter(isModItem);

  for (const item of matchedItems) {
    await fs.copyFile(path.join(pagesDir, item.savedAs), path.join(targetPagesDir, item.savedAs));
  }

  const manifestPath = path.join(outputDir, 'manifest.json');
  await fs.writeFile(
    manifestPath,
    JSON.stringify(
      {
        sourceFeedUrl: manifest.feedUrl,
        sourceFetchedAt: manifest.fetchedAt,
        extractedAt: now().toISOString(),
        processed: matchedItems.length,
        items: matchedItems,
      },
      null,
      2,
    ),
    'utf8',
  );

  return {
    outputDir,
    manifestPath,
    processed: matchedItems.length,
  };
}

export function resolveDomstolRssDirectory(): string {
  return resolveKnowledgeBasePath('legal', 'domstol-rss');
}

export function resolveModCorpusDirectory(): string {
  return resolveKnowledgeBasePath('legal', 'mod-corpus');
}

function isModItem(item: DomstolRssItem): boolean {
  return /mark--och-miljooverdomstolen/i.test(item.link);
}
