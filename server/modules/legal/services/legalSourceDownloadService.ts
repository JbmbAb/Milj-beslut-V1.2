import type { DownloadableLegalSourceDefinition } from '../catalogs/curatedLegalDownloadSources';
import { resolveKnowledgeBasePath } from '../../../services/importPathService';

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

export interface DownloadLegalSourcesOptions {
  definitions: readonly DownloadableLegalSourceDefinition[];
  outputDir: string;
  fetchImpl?: unknown;
  now?: () => Date;
}

export const LEGACY_LEGAL_ACQUISITION_BLOCKED =
  'P2-AUTH-03D3 BLOCKED: curated/foundation legal acquisition is superseded by the verified ' +
  'SourceRegistry and governed P2 download path. Existing files remain read-only ' +
  'LEGACY_NON_AUTHORITATIVE material.';

/**
 * P2-AUTH-03D3 — the legacy acquisition capability has been removed, not modernized.
 *
 * The parameter is retained only so old callers fail at this boundary without silently changing
 * call shape. There is no fetch, archive writer or manifest writer left in this module.
 */
export async function downloadLegalSources(
  _options: DownloadLegalSourcesOptions,
): Promise<DownloadLegalSourcesResult> {
  return rejectLegacyLegalAcquisition('legalSourceDownloadService');
}

export function rejectLegacyLegalAcquisition(surface: string): never {
  throw new Error(`${LEGACY_LEGAL_ACQUISITION_BLOCKED} Surface: ${surface}.`);
}

/** Read-only location of already downloaded legacy material; no writer remains. */
export function resolveCuratedLegalDownloadDirectory(): string {
  return resolveKnowledgeBasePath('legal', 'curated-downloads');
}
