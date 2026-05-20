import {
  FOUNDATION_LEGAL_SOURCES,
  type FoundationLegalSourceDefinition,
} from './foundationLegalSources';
import { SEWAGE_EVIDENCE_SOURCES, type SewageEvidenceSource } from './sewageEvidenceSources';

export type CuratedLegalDownloadCollection = 'FOUNDATION' | 'SEWAGE_EVIDENCE';

export interface DownloadableLegalSourceDefinition {
  id: string;
  externalId: string;
  title: string;
  authorityName: string;
  sourceSystem: string;
  sourceType: string;
  sourceUrl: string;
  fileSlug: string;
  collection: CuratedLegalDownloadCollection;
}

export const FOUNDATION_DOWNLOAD_SOURCES: readonly DownloadableLegalSourceDefinition[] =
  FOUNDATION_LEGAL_SOURCES.map(mapFoundationSource);

export const CURATED_LEGAL_DOWNLOAD_SOURCES: readonly DownloadableLegalSourceDefinition[] = [
  ...FOUNDATION_DOWNLOAD_SOURCES,
  ...SEWAGE_EVIDENCE_SOURCES.map(mapSewageSource),
];

function mapFoundationSource(
  definition: FoundationLegalSourceDefinition,
): DownloadableLegalSourceDefinition {
  return {
    id: definition.id,
    externalId: definition.externalId,
    title: definition.title,
    authorityName: definition.authorityName,
    sourceSystem: 'SFS',
    sourceType: definition.instrumentType === 'LAW' ? 'FOUNDATION_LAW' : 'FOUNDATION_ORDINANCE',
    sourceUrl: definition.sourceUrl,
    fileSlug: toFileSlug(definition.externalId),
    collection: 'FOUNDATION',
  };
}

function mapSewageSource(source: SewageEvidenceSource): DownloadableLegalSourceDefinition {
  return {
    id: source.id,
    externalId: inferSewageExternalId(source),
    title: source.title,
    authorityName: source.authorityName,
    sourceSystem: source.sourceSystem,
    sourceType: source.sourceType,
    sourceUrl: source.sourceUrl,
    fileSlug: inferSewageFileSlug(source),
    collection: 'SEWAGE_EVIDENCE',
  };
}

function inferSewageExternalId(source: SewageEvidenceSource): string {
  switch (source.id) {
    case 'sewage.mb':
      return 'SFS:1998:808';
    case 'sewage.fmh':
      return 'SFS:1998:899';
    case 'sewage.hvmfs':
      return 'HVMFS:2016:17';
    case 'sewage.domstolsverket':
      return 'DOMSTOL_RSS:15972';
    case 'sewage.mod':
      return 'MOD:PRACTICE';
    case 'sewage.lansstyrelsen':
      return 'LANSSTYRELSEN:ENSKILT_AVLOPP';
    case 'sewage.dataportal':
      return 'DATAPORTAL:ENSKILT_AVLOPP';
    default:
      return `${source.sourceSystem}:${source.id.toUpperCase()}`;
  }
}

function inferSewageFileSlug(source: SewageEvidenceSource): string {
  switch (source.id) {
    case 'sewage.mb':
      return 'sfs-1998-808';
    case 'sewage.fmh':
      return 'sfs-1998-899';
    case 'sewage.hvmfs':
      return 'hvmfs-2016-17';
    case 'sewage.domstolsverket':
      return 'domstolsverket-miljoavgoranden-rss';
    case 'sewage.mod':
      return 'mark-och-miljooverdomstolen';
    case 'sewage.lansstyrelsen':
      return 'lansstyrelsen-enskilt-avlopp';
    case 'sewage.dataportal':
      return 'dataportal-enskilt-avlopp';
    default:
      return toFileSlug(source.id);
  }
}

function toFileSlug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
