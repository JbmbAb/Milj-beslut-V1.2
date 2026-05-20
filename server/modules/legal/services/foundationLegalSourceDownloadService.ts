import {
  FOUNDATION_DOWNLOAD_SOURCES,
  type DownloadableLegalSourceDefinition,
} from '../catalogs/curatedLegalDownloadSources';
import { downloadLegalSources } from './legalSourceDownloadService';
import { resolveKnowledgeBasePath } from '../../../services/importPathService';

export interface DownloadedFoundationLegalSource {
  definitionId: string;
  externalId: string;
  title: string;
  sourceUrl: string;
  contentType: string;
  bytes: number;
  savedAs: string;
  savedAt: string;
}

export interface DownloadFoundationLegalSourcesResult {
  processed: number;
  outputDir: string;
  manifestPath: string;
  downloads: DownloadedFoundationLegalSource[];
}

interface DownloadFoundationLegalSourcesOptions {
  definitions?: readonly DownloadableLegalSourceDefinition[];
  outputDir?: string;
  fetchImpl?: Parameters<typeof downloadLegalSources>[0]['fetchImpl'];
  now?: () => Date;
}

export async function downloadFoundationLegalSources(
  options: DownloadFoundationLegalSourcesOptions = {},
): Promise<DownloadFoundationLegalSourcesResult> {
  const definitions = options.definitions ?? FOUNDATION_DOWNLOAD_SOURCES;
  const outputDir = options.outputDir ?? resolveFoundationLegalSourceDownloadDirectory();
  const result = await downloadLegalSources({
    definitions,
    outputDir,
    fetchImpl: options.fetchImpl,
    now: options.now,
  });

  return {
    processed: result.downloads.length,
    outputDir,
    manifestPath: result.manifestPath,
    downloads: result.downloads.map((download) => ({
      definitionId: download.definitionIds[0] ?? 'unknown',
      externalId: download.externalIds[0] ?? 'unknown',
      title: download.titles[0] ?? 'unknown',
      sourceUrl: download.sourceUrl,
      contentType: download.contentType,
      bytes: download.bytes,
      savedAs: download.savedAs,
      savedAt: download.savedAt,
    })),
  };
}

export function resolveFoundationLegalSourceDownloadDirectory(): string {
  return resolveKnowledgeBasePath('legal', 'foundation-sources');
}
