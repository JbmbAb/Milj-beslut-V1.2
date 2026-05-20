import * as fs from 'node:fs/promises';
import path from 'node:path';
import type { DownloadableLegalSourceDefinition } from '../catalogs/curatedLegalDownloadSources';
import { resolveKnowledgeBasePath } from '../../../services/importPathService';

type FetchResponseLike = {
  ok: boolean;
  status: number;
  headers: {
    get(name: string): string | null;
  };
  arrayBuffer(): Promise<ArrayBuffer>;
};

type FetchLike = (input: string, init?: RequestInit) => Promise<FetchResponseLike>;

export interface DownloadedLegalSource {
  definitionIds: string[];
  externalIds: string[];
  titles: string[];
  authorityNames: string[];
  sourceSystems: string[];
  sourceTypes: string[];
  collections: string[];
  sourceUrl: string;
  contentType: string;
  bytes: number;
  savedAs: string;
  savedAt: string;
}

export interface DownloadLegalSourcesResult {
  processed: number;
  outputDir: string;
  manifestPath: string;
  downloads: DownloadedLegalSource[];
}

interface DownloadLegalSourcesOptions {
  definitions: readonly DownloadableLegalSourceDefinition[];
  outputDir: string;
  fetchImpl?: FetchLike;
  now?: () => Date;
}

export async function downloadLegalSources(
  options: DownloadLegalSourcesOptions,
): Promise<DownloadLegalSourcesResult> {
  const fetchImpl = options.fetchImpl ?? ((input: string, init?: RequestInit) => fetch(input, init));
  const now = options.now ?? (() => new Date());
  const groupedDefinitions = groupDefinitionsByUrl(options.definitions);
  const slugCounts = new Map<string, number>();

  await fs.mkdir(options.outputDir, { recursive: true });

  const downloads: DownloadedLegalSource[] = [];

  for (const definitions of groupedDefinitions) {
    const primaryDefinition = definitions[0];
    if (!primaryDefinition) {
      continue;
    }

    const response = await fetchImpl(primaryDefinition.sourceUrl, {
      headers: {
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.1',
        'User-Agent': 'Miljobeslut Legal Downloader/1.0',
      },
    });

    if (!response.ok) {
      throw new Error(
        `Kunde inte ladda ner ${primaryDefinition.externalId} från ${primaryDefinition.sourceUrl} (HTTP ${response.status})`,
      );
    }

    const savedAt = now().toISOString();
    const contentType = normalizeContentType(response.headers.get('content-type'));
    const extension = inferFileExtension(contentType);
    const fileName = buildUniqueFileName(primaryDefinition.fileSlug, extension, slugCounts);
    const absolutePath = path.join(options.outputDir, fileName);
    const body = Buffer.from(await response.arrayBuffer());

    await fs.writeFile(absolutePath, body);

    downloads.push({
      definitionIds: definitions.map((definition) => definition.id),
      externalIds: definitions.map((definition) => definition.externalId),
      titles: definitions.map((definition) => definition.title),
      authorityNames: definitions.map((definition) => definition.authorityName),
      sourceSystems: unique(definitions.map((definition) => definition.sourceSystem)),
      sourceTypes: unique(definitions.map((definition) => definition.sourceType)),
      collections: unique(definitions.map((definition) => definition.collection)),
      sourceUrl: primaryDefinition.sourceUrl,
      contentType,
      bytes: body.byteLength,
      savedAs: fileName,
      savedAt,
    });
  }

  const manifestPath = path.join(options.outputDir, 'manifest.json');
  await fs.writeFile(
    manifestPath,
    JSON.stringify(
      {
        generatedAt: now().toISOString(),
        processed: downloads.length,
        downloads,
      },
      null,
      2,
    ),
    'utf8',
  );

  return {
    processed: downloads.length,
    outputDir: options.outputDir,
    manifestPath,
    downloads,
  };
}

export function resolveCuratedLegalDownloadDirectory(): string {
  return resolveKnowledgeBasePath('legal', 'curated-downloads');
}

function groupDefinitionsByUrl(
  definitions: readonly DownloadableLegalSourceDefinition[],
): DownloadableLegalSourceDefinition[][] {
  const grouped = new Map<string, DownloadableLegalSourceDefinition[]>();

  for (const definition of definitions) {
    const current = grouped.get(definition.sourceUrl);
    if (current) {
      current.push(definition);
      continue;
    }

    grouped.set(definition.sourceUrl, [definition]);
  }

  return [...grouped.values()];
}

function normalizeContentType(contentType: string | null): string {
  return contentType?.split(';')[0]?.trim().toLowerCase() || 'application/octet-stream';
}

function inferFileExtension(contentType: string): string {
  switch (contentType) {
    case 'text/html':
    case 'application/xhtml+xml':
      return '.html';
    case 'application/json':
      return '.json';
    case 'application/xml':
    case 'text/xml':
      return '.xml';
    case 'text/plain':
      return '.txt';
    default:
      return '.bin';
  }
}

function buildUniqueFileName(baseSlug: string, extension: string, slugCounts: Map<string, number>): string {
  const nextCount = (slugCounts.get(baseSlug) ?? 0) + 1;
  slugCounts.set(baseSlug, nextCount);

  if (nextCount === 1) {
    return `${baseSlug}${extension}`;
  }

  return `${baseSlug}-${nextCount}${extension}`;
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}
