import { normalizeExternalText, normalizeSearchToken } from '../utils/textEncoding';
import type { FoundationLegalSourceDefinition } from '../modules/legal/catalogs/foundationLegalSources';

export type LegalStorageTarget = 'PRISMA' | 'POSTGIS' | 'FILESYSTEM' | 'REVIEW_QUEUE';

export interface MatrixProjection {
  shouldProject: boolean;
  category?: string;
  ruleText?: string;
  sourceText?: string;
  comments?: string;
}

const NON_PROJECTING_SOURCE_TYPES = new Set([
  'FOUNDATION_LAW',
  'FOUNDATION_ORDINANCE',
  'MUNICIPAL_DIARY_INDEX',
]);

export interface LegalSourceSeedInput {
  sourceSystem: string;
  sourceType: string;
  externalId: string;
  title: string;
  summary?: string | null;
  sourceUrl: string;
  normalizedUrl?: string | null;
  providerId?: string | null;
  providerLabel?: string | null;
  authorityName?: string | null;
  authorityType?: string | null;
  municipality?: string | null;
  diarienummer?: string | null;
  legalArea?: string | null;
  mimeType?: string | null;
  formatHint?: string | null;
  decisionDate?: Date | null;
  publishedAt?: Date | null;
  storageTargetOverride?: LegalStorageTarget;
  postgisSchemaOverride?: string | null;
  postgisTableOverride?: string | null;
  payload?: Record<string, unknown>;
}

export interface NormalizedLegalSourceInput {
  sourceSystem: string;
  sourceType: string;
  externalId: string;
  title: string;
  summary?: string | null;
  sourceUrl: string;
  normalizedUrl?: string | null;
  providerId?: string | null;
  providerLabel?: string | null;
  authorityName?: string | null;
  authorityType?: string | null;
  municipality?: string | null;
  diarienummer?: string | null;
  legalArea?: string | null;
  mimeType?: string | null;
  formatHint?: string | null;
  decisionDate?: Date | null;
  publishedAt?: Date | null;
  storageTarget: LegalStorageTarget;
  postgisSchema?: string;
  postgisTable?: string;
  matrixCategory?: string;
  matrixSuggested: boolean;
  payload: Record<string, unknown>;
}

function sanitizeSegment(value: string): string {
  const normalized = normalizeSearchToken(value)
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return normalized || 'dataset';
}

function extractFileExtension(input: string): string {
  try {
    const url = new URL(input);
    const match = url.pathname.toLowerCase().match(/\.([a-z0-9]+)$/);
    return match?.[1] || '';
  } catch {
    return '';
  }
}

function inferStorageTarget(input: LegalSourceSeedInput): LegalStorageTarget {
  if (input.storageTargetOverride) {
    return input.storageTargetOverride;
  }

  const normalizedUrl = String(input.normalizedUrl || input.sourceUrl || '').toLowerCase();
  const formatHint = String(input.formatHint || '').toLowerCase();
  const mimeType = String(input.mimeType || '').toLowerCase();
  const title = normalizeSearchToken(input.title);
  const summary = normalizeSearchToken(input.summary);

  const spatialSignals = [
    formatHint,
    mimeType,
    extractFileExtension(normalizedUrl),
    normalizedUrl,
    title,
    summary,
  ].join(' ');

  if (
    /(gpkg|geojson|geopackage|shp|shape-zip|wfs|wms|featureserver|arcgis|geodata|geometry|raster|geotiff|tiff|marktacke|markfuktighet|objekthojd|objekttackning|laserdata|wetness)/.test(
      spatialSignals,
    )
  ) {
    return 'POSTGIS';
  }

  if (/(pdf|docx|doc|xlsx|xls|csv|zip)/.test(spatialSignals)) {
    return 'FILESYSTEM';
  }

  if (input.sourceType === 'MUNICIPAL_DIARY_INDEX') {
    return 'REVIEW_QUEUE';
  }

  return 'PRISMA';
}

function inferPostgisTarget(input: LegalSourceSeedInput): { postgisSchema?: string; postgisTable?: string } {
  if (inferStorageTarget(input) !== 'POSTGIS') return {};

  if (input.postgisSchemaOverride || input.postgisTableOverride) {
    return {
      postgisSchema: input.postgisSchemaOverride || undefined,
      postgisTable: input.postgisTableOverride || undefined,
    };
  }

  const providerId = normalizeSearchToken(input.providerId);
  const datasetSeed = sanitizeSegment(input.title || input.externalId);

  if (providerId === 'raa') {
    return { postgisSchema: 'culture', postgisTable: `raa_${datasetSeed}` };
  }
  if (providerId === 'smhi') {
    return { postgisSchema: 'climate', postgisTable: `smhi_${datasetSeed}` };
  }
  if (providerId === 'lantmateriet') {
    return { postgisSchema: 'env', postgisTable: `lm_${datasetSeed}` };
  }
  if (providerId === 'naturvardsverket' || providerId === 'nv') {
    return { postgisSchema: 'env', postgisTable: `nv_${datasetSeed}` };
  }

  return { postgisSchema: 'legal', postgisTable: datasetSeed };
}

export function inferMatrixProjection(input: LegalSourceSeedInput): MatrixProjection {
  if (NON_PROJECTING_SOURCE_TYPES.has(input.sourceType)) {
    return { shouldProject: false };
  }

  const haystack = [
    input.sourceType,
    input.title,
    input.summary,
    input.legalArea,
    input.authorityName,
    input.authorityType,
  ]
    .map((value) => normalizeSearchToken(value))
    .join(' ');

  const matrixKeywords =
    /(dom|avgorande|avgörande|beslut|praxis|villkor|forelaggande|föreläggande|tillstand|tillstånd|miljo|miljö)/;
  if (!matrixKeywords.test(haystack)) {
    return { shouldProject: false };
  }

  const category =
    input.sourceType === 'JUDGMENT' || haystack.includes('dom') || haystack.includes('praxis')
      ? 'Praxis och domar'
      : 'Beslut och diarier';

  const ruleText =
    normalizeExternalText(input.title) || normalizeExternalText(input.summary) || input.externalId;
  const sourceText = normalizeExternalText(input.summary);
  const comments = [
    normalizeExternalText(input.authorityName),
    normalizeExternalText(input.municipality),
    normalizeExternalText(input.diarienummer),
  ]
    .filter(Boolean)
    .join(' | ');

  return {
    shouldProject: Boolean(ruleText),
    category,
    ruleText,
    sourceText,
    comments: comments || undefined,
  };
}


export function normalizeLegalSource(input: LegalSourceSeedInput): NormalizedLegalSourceInput {
  const storageTarget = inferStorageTarget(input);
  const matrix = inferMatrixProjection(input);
  const normalizedUrl = normalizeExternalText(input.normalizedUrl || input.sourceUrl);
  const postgisTarget = inferPostgisTarget(input);

  return {
    sourceSystem: input.sourceSystem,
    sourceType: input.sourceType,
    externalId: input.externalId,
    title: normalizeExternalText(input.title) || input.externalId,
    summary: normalizeExternalText(input.summary),
    sourceUrl: normalizeExternalText(input.sourceUrl) || input.sourceUrl,
    normalizedUrl,
    providerId: normalizeExternalText(input.providerId),
    providerLabel: normalizeExternalText(input.providerLabel),
    authorityName: normalizeExternalText(input.authorityName),
    authorityType: normalizeExternalText(input.authorityType),
    municipality: normalizeExternalText(input.municipality),
    diarienummer: normalizeExternalText(input.diarienummer),
    legalArea: normalizeExternalText(input.legalArea),
    mimeType: normalizeExternalText(input.mimeType),
    formatHint: normalizeExternalText(input.formatHint),
    decisionDate: input.decisionDate,
    publishedAt: input.publishedAt,
    storageTarget,
    postgisSchema: postgisTarget.postgisSchema,
    postgisTable: postgisTarget.postgisTable,
    matrixCategory: matrix.category,
    matrixSuggested: matrix.shouldProject,
    payload: input.payload || {},
  };
}

export function buildDataportalLegalSourceSeed(record: {
  sourceSystem?: string;
  sourceType?: string;
  distributionKey: string;
  datasetTitle?: string;
  datasetDescription?: string;
  sourceUrl: string;
  normalizedUrl?: string;
  providerId?: string;
  providerLabel?: string;
  authorityName?: string;
  authorityType?: string;
  municipality?: string;
  diarienummer?: string;
  mimeType?: string;
  formatHint?: string;
  storageTargetOverride?: LegalStorageTarget;
  postgisSchemaOverride?: string;
  postgisTableOverride?: string;
  payload?: Record<string, unknown>;
}): LegalSourceSeedInput {
  return {
    sourceSystem: record.sourceSystem || 'DATAPORTAL_V2',
    sourceType: record.sourceType || 'DATASET_DISTRIBUTION',
    externalId: record.distributionKey,
    title: record.datasetTitle || record.distributionKey,
    summary: record.datasetDescription,
    sourceUrl: record.sourceUrl,
    normalizedUrl: record.normalizedUrl || record.sourceUrl,
    providerId: record.providerId,
    providerLabel: record.providerLabel,
    authorityName: record.authorityName,
    authorityType: record.authorityType,
    municipality: record.municipality,
    diarienummer: record.diarienummer,
    mimeType: record.mimeType,
    formatHint: record.formatHint,
    storageTargetOverride: record.storageTargetOverride,
    postgisSchemaOverride: record.postgisSchemaOverride,
    postgisTableOverride: record.postgisTableOverride,
    payload: record.payload,
  };
}

export function buildMunicipalDiaryLegalSourceSeed(row: {
  kommun: string;
  kommunWebb: string;
  diarieUrl?: string;
  notes?: string;
  sourceUrl?: string;
}): LegalSourceSeedInput {
  return {
    sourceSystem: 'MUNICIPAL_DIARIES',
    sourceType: 'MUNICIPAL_DIARY_INDEX',
    externalId: `${row.kommun}::${row.kommunWebb}`,
    title: `${row.kommun} diarier`,
    summary: row.notes || 'Kommunal diariekälla som kräver manuell komplettering eller verifiering.',
    sourceUrl: row.diarieUrl || row.kommunWebb,
    normalizedUrl: row.diarieUrl || row.kommunWebb,
    authorityName: row.kommun,
    authorityType: 'Kommun',
    municipality: row.kommun,
    payload: {
      kommunWebb: row.kommunWebb,
      sourceUrl: row.sourceUrl,
    },
  };
}

export function buildJudgmentLegalSourceSeed(input: {
  guid: string;
  title: string;
  link: string;
  description?: string | null;
  pubDate: Date;
  sourceFeed?: string;
}): LegalSourceSeedInput {
  return {
    sourceSystem: 'DOMSTOL_RSS',
    sourceType: 'JUDGMENT',
    externalId: input.guid,
    title: input.title,
    summary: input.description,
    sourceUrl: input.link,
    normalizedUrl: input.link,
    authorityType: 'Domstol',
    legalArea: 'Miljö',
    publishedAt: input.pubDate,
    decisionDate: input.pubDate,
    payload: {
      guid: input.guid,
      sourceFeed: input.sourceFeed || 'DOMSTOL_RSS',
    },
  };
}

export function buildFoundationLegalSourceSeed(input: FoundationLegalSourceDefinition): LegalSourceSeedInput {
  return {
    sourceSystem: 'SFS',
    sourceType: input.instrumentType === 'LAW' ? 'FOUNDATION_LAW' : 'FOUNDATION_ORDINANCE',
    externalId: input.externalId,
    title: input.title,
    summary: input.summary,
    sourceUrl: input.sourceUrl,
    normalizedUrl: input.sourceUrl,
    providerId: 'sfs',
    providerLabel: 'Svensk författningssamling',
    authorityName: input.authorityName,
    authorityType: input.authorityType,
    legalArea: input.legalArea,
    storageTargetOverride: 'PRISMA',
    payload: {
      catalogId: input.id,
      shortTitle: input.shortTitle,
      instrumentType: input.instrumentType,
      keywords: input.keywords,
      readyForImport: true,
    },
  };
}
