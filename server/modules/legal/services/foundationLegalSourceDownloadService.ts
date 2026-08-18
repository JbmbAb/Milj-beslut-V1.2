import type { DownloadableLegalSourceDefinition } from '../catalogs/curatedLegalDownloadSources';
import { rejectLegacyLegalAcquisition, type DownloadLegalSourcesOptions } from './legalSourceDownloadService';
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
  fetchImpl?: DownloadLegalSourcesOptions['fetchImpl'];
  now?: () => Date;
}

export async function downloadFoundationLegalSources(
  _options: DownloadFoundationLegalSourcesOptions = {},
): Promise<DownloadFoundationLegalSourcesResult> {
  return rejectLegacyLegalAcquisition('foundationLegalSourceDownloadService');
}

/** Read-only location of already downloaded legacy material; no writer remains. */
export function resolveFoundationLegalSourceDownloadDirectory(): string {
  return resolveKnowledgeBasePath('legal', 'foundation-sources');
}
