import * as fs from 'node:fs/promises';
import path from 'node:path';

import type { Prisma } from '@prisma/client';

import { prisma } from '../../../db/prisma';
import { upsertJudgment } from '../../../repositories/judgmentRepository';
import { upsertLegalSourceRecord } from '../../../repositories/legalSourceRepository';
import type { LegalSourceSeedInput, LegalStorageTarget } from '../../../services/legalSourceIngestService';
import { resolveKnowledgeBaseRoot } from '../../../services/importPathService';
import { normalizeExternalText, normalizeSearchToken } from '../../../utils/textEncoding';
import { extractCorpusContent } from './legalCorpusTextExtractor';
import { XMLParser } from 'fast-xml-parser';

type JsonObject = Record<string, unknown>;

interface JudgmentUpsertInput {
  guid: string;
  title: string;
  link: string;
  description?: string;
  pubDate: Date;
}

export interface StructuredLegalCorpusRecord {
  recordKey: string;
  canonicalKey: string;
  sourceFamily: string;
  sourceType: string;
  sourceSystem: string;
  sourcePath: string;
  title: string;
  summary?: string;
  externalId?: string;
  authorityName?: string;
  authorityType?: string;
  providerId?: string;
  providerLabel?: string;
  court?: string;
  courtLevel?: string;
  municipality?: string;
  legalArea?: string;
  language?: string;
  mimeType?: string;
  formatHint?: string;
  sourceUrl?: string;
  normalizedUrl?: string;
  publishedAt?: Date;
  decisionDate?: Date;
  year?: number;
  caseNumber?: string;
  documentText?: string;
  searchText: string;
  metadata: JsonObject;
  tags: string[];
  contentHash?: string;
  byteSize?: number;
  storageTargetOverride?: LegalStorageTarget;
  postgisSchemaOverride?: string;
  postgisTableOverride?: string;
  judgmentInput?: JudgmentUpsertInput;
}

export interface CollectDownloadedLegalCorpusOptions {
  rootDir?: string;
  extractPdfText?: boolean;
}

export interface ImportDownloadedLegalCorpusOptions extends CollectDownloadedLegalCorpusOptions {
  limit?: number;
}

export interface ImportDownloadedLegalCorpusResult {
  rootDir: string;
  collected: number;
  processed: number;
  createdOrUpdatedCorpusRecords: number;
  legalSourceRecordsUpserted: number;
  judgmentRecordsUpserted: number;
  recordKeys: string[];
}

interface DomstolFeedItem {
  guid: string;
  title: string;
  link: string;
  description?: string;
  pubDate?: Date;
}

interface ManifestDownload {
  externalId?: string;
  externalIds?: string[];
  title?: string;
  titles?: string[];
  sourceUrl: string;
  contentType?: string;
  bytes?: number;
  savedAs: string;
  authorityName?: string;
  authorityNames?: string[];
  sourceSystem?: string;
  sourceSystems?: string[];
  sourceType?: string;
  sourceTypes?: string[];
  definitionId?: string;
  definitionIds?: string[];
  collections?: string[];
}

export async function collectDownloadedLegalCorpus(
  options: CollectDownloadedLegalCorpusOptions = {},
): Promise<StructuredLegalCorpusRecord[]> {
  const rootDir = options.rootDir ?? resolveKnowledgeBaseDirectory();

  const groups = await Promise.all([
    collectFoundationRecords(rootDir, options),
    collectCuratedRecords(rootDir, options),
    collectDomstolRecords(rootDir, options),
    collectDomstolHistoryRecords(rootDir, options),
    collectModCorpusRecords(rootDir, options),
    collectMmdCorpusRecords(rootDir, options),
    collectLansstyrelserRecords(rootDir, options),
    collectNaturvardsverketRecords(rootDir, options),
    collectNaturvardsverketPdfRecords(rootDir, options),
    collectNaturvardsverketSitePdfRecords(rootDir, options),
    collectBergsstatenRecords(rootDir, options),
    collectSguAnvandarstodRecords(rootDir, options),
    collectSguPortalRecords(rootDir, options),
    collectDivaRecords(rootDir, options),
    collectOpenSourceSweepRecords(rootDir, options),
    collectBoverketRecords(rootDir, options),
  ]);

  return groups
    .flat()
    .filter((r): r is StructuredLegalCorpusRecord => !!r)
    .sort((a, b) => a.recordKey.localeCompare(b.recordKey));
}

export async function importDownloadedLegalCorpus(
  options: ImportDownloadedLegalCorpusOptions = {},
): Promise<ImportDownloadedLegalCorpusResult> {
  const rootDir = options.rootDir ?? resolveKnowledgeBaseDirectory();
  const records = await collectDownloadedLegalCorpus(options);
  const selected = options.limit ? records.slice(0, options.limit) : records;

  let createdOrUpdatedCorpusRecords = 0;
  let legalSourceRecordsUpserted = 0;
  let judgmentRecordsUpserted = 0;

  for (const record of selected) {
    let judgmentId: string | undefined;
    if (record.judgmentInput) {
      const judgment = await upsertJudgment(record.judgmentInput);
      judgmentId = judgment.id;
      judgmentRecordsUpserted += 1;
    }

    const legalSource = await upsertLegalSourceRecord(buildLegalSourceSeed(record), judgmentId);
    if (legalSource) {
      legalSourceRecordsUpserted += 1;
    }

    await prisma.legalCorpusRecord.upsert({
      where: { recordKey: record.recordKey },
      create: mapCorpusRecordForWrite(record, legalSource?.id, judgmentId),
      update: mapCorpusRecordForWrite(record, legalSource?.id, judgmentId),
    });
    createdOrUpdatedCorpusRecords += 1;
  }

  return {
    rootDir,
    collected: records.length,
    processed: selected.length,
    createdOrUpdatedCorpusRecords,
    legalSourceRecordsUpserted,
    judgmentRecordsUpserted,
    recordKeys: selected.map((record) => record.recordKey),
  };
}

export function resolveKnowledgeBaseDirectory(): string {
  return resolveKnowledgeBaseRoot();
}

function buildLegalSourceSeed(record: StructuredLegalCorpusRecord): LegalSourceSeedInput {
  return {
    sourceSystem: record.sourceSystem,
    sourceType: record.sourceType,
    externalId: record.externalId || record.canonicalKey,
    title: record.title,
    summary: record.summary,
    sourceUrl: record.sourceUrl || absoluteFileUrl(record.sourcePath),
    normalizedUrl: record.normalizedUrl || record.sourceUrl || absoluteFileUrl(record.sourcePath),
    providerId: record.providerId,
    providerLabel: record.providerLabel,
    authorityName: record.authorityName,
    authorityType: record.authorityType,
    municipality: record.municipality,
    legalArea: record.legalArea,
    mimeType: record.mimeType,
    formatHint: record.formatHint,
    decisionDate: record.decisionDate,
    publishedAt: record.publishedAt,
    storageTargetOverride: record.storageTargetOverride,
    postgisSchemaOverride: record.postgisSchemaOverride,
    postgisTableOverride: record.postgisTableOverride,
    payload: {
      canonicalKey: record.canonicalKey,
      recordKey: record.recordKey,
      sourcePath: record.sourcePath,
      court: record.court,
      courtLevel: record.courtLevel,
      caseNumber: record.caseNumber,
      tags: record.tags,
      corpusMetadata: record.metadata,
    },
  };
}

function mapCorpusRecordForWrite(
  record: StructuredLegalCorpusRecord,
  legalSourceId?: string,
  judgmentId?: string,
) {
  return {
    recordKey: record.recordKey,
    canonicalKey: record.canonicalKey,
    sourceFamily: record.sourceFamily,
    sourceType: record.sourceType,
    sourceSystem: record.sourceSystem,
    externalId: record.externalId,
    title: record.title,
    summary: record.summary,
    authorityName: record.authorityName,
    authorityType: record.authorityType,
    court: record.court,
    courtLevel: record.courtLevel,
    municipality: record.municipality,
    legalArea: record.legalArea,
    language: record.language || 'sv',
    mimeType: record.mimeType,
    formatHint: record.formatHint,
    sourceUrl: record.sourceUrl,
    normalizedUrl: record.normalizedUrl,
    sourcePath: record.sourcePath,
    publishedAt: record.publishedAt,
    decisionDate: record.decisionDate,
    year: record.year,
    caseNumber: record.caseNumber,
    documentText: record.documentText,
    searchText: record.searchText,
    metadata: toSerializableValue(record.metadata) as Prisma.InputJsonValue,
    tags: toSerializableValue(record.tags) as Prisma.InputJsonValue,
    contentHash: record.contentHash,
    byteSize: record.byteSize,
    legalSourceId: legalSourceId || null,
    judgmentId: judgmentId || null,
  };
}

async function collectFoundationRecords(
  rootDir: string,
  options: CollectDownloadedLegalCorpusOptions,
): Promise<StructuredLegalCorpusRecord[]> {
  const manifestPath = path.join(rootDir, 'legal', 'foundation-sources', 'manifest.json');
  const manifest = await readJsonFile<{ downloads?: ManifestDownload[] }>(manifestPath);
  if (!manifest) return [];
  const downloads = manifest.downloads || [];

  const results = await Promise.all(
    downloads.map((download) =>
      materializeStructuredRecord(
        rootDir,
        {
          sourceFamily: 'FOUNDATION',
          sourceSystem: 'SFS',
          sourceType: inferFoundationType(download.title || ''),
          sourcePath: path.join('legal', 'foundation-sources', download.savedAs),
          recordKey: toKey('foundation', download.savedAs),
          canonicalKey: toKey('sfs', download.externalId || download.savedAs),
          externalId: download.externalId,
          title: download.title || fileStem(download.savedAs),
          summary: normalizeExternalText(download.title),
          sourceUrl: download.sourceUrl,
          normalizedUrl: download.sourceUrl,
          authorityName: inferFoundationAuthority(download.title || ''),
          authorityType: inferFoundationAuthorityType(download.title || ''),
          legalArea: inferLegalArea(download.title || ''),
          mimeType: download.contentType,
          metadata: {
            download,
          },
          tags: ['foundation', 'sfs'],
        },
        options,
      ),
    ),
  );
  return results.filter((r): r is StructuredLegalCorpusRecord => r !== null);
}

async function collectCuratedRecords(
  rootDir: string,
  options: CollectDownloadedLegalCorpusOptions,
): Promise<StructuredLegalCorpusRecord[]> {
  const manifestPath = path.join(rootDir, 'legal', 'curated-downloads', 'manifest.json');
  const manifest = await readJsonFile<{ downloads?: ManifestDownload[] }>(manifestPath);
  if (!manifest) return [];
  const downloads = manifest.downloads || [];

  const results = await Promise.all(
    downloads.map((download) => {
      const title = firstNonEmpty(download.titles) || download.title || fileStem(download.savedAs);
      const authorityName = firstNonEmpty(download.authorityNames);
      const sourceSystem =
        firstNonEmpty(download.sourceSystems) || inferSourceSystemFromUrl(download.sourceUrl);
      const sourceType = firstNonEmpty(download.sourceTypes) || inferSourceTypeFromUrl(download.sourceUrl);
      const externalId = firstNonEmpty(download.externalIds) || download.externalId || download.savedAs;

      return materializeStructuredRecord(
        rootDir,
        {
          sourceFamily: 'CURATED',
          sourceSystem,
          sourceType,
          sourcePath: path.join('legal', 'curated-downloads', download.savedAs),
          recordKey: toKey('curated', download.savedAs),
          canonicalKey: toKey(sourceSystem, externalId),
          externalId,
          title,
          summary: normalizeExternalText(title),
          sourceUrl: download.sourceUrl,
          normalizedUrl: download.sourceUrl,
          authorityName,
          authorityType: inferAuthorityType(authorityName, title),
          legalArea: inferLegalArea(title),
          mimeType: download.contentType,
          metadata: {
            download,
          },
          tags: ['curated', ...(download.collections || []).map((item) => normalizeSearchToken(item))],
        },
        options,
      );
    }),
  );
  return results.filter((r): r is StructuredLegalCorpusRecord => r !== null);
}

async function collectDomstolRecords(
  rootDir: string,
  options: CollectDownloadedLegalCorpusOptions,
): Promise<StructuredLegalCorpusRecord[]> {
  const itemsPath = path.join(rootDir, 'legal', 'domstol-rss', 'items.json');
  const feedPath = path.join(rootDir, 'legal', 'domstol-rss', 'feed.xml');
  const manifest = await readJsonFile<{
    items?: Array<{ guid: string; title: string; link: string; savedAs: string }>;
  }>(itemsPath);
  const feedEntries = await readDomstolFeed(feedPath);

  const results = await Promise.all(
    (manifest.items || []).map((item) => {
      const feed = feedEntries.get(item.guid);
      const title = normalizeExternalText(feed?.title || item.title) || item.title;
      const summary = normalizeExternalText(feed?.description);
      const pubDate = feed?.pubDate;
      const caseNumber = extractCaseNumber(title);

      return materializeStructuredRecord(
        rootDir,
        {
          sourceFamily: 'JUDGMENT',
          sourceSystem: 'DOMSTOL_RSS',
          sourceType: 'JUDGMENT',
          sourcePath: path.join('legal', 'domstol-rss', 'pages', item.savedAs),
          recordKey: toKey('domstol-rss', item.savedAs),
          canonicalKey: toKey('domstol', item.guid),
          externalId: item.guid,
          title,
          summary,
          sourceUrl: item.link,
          normalizedUrl: item.link,
          authorityName: 'Mark- och miljööverdomstolen',
          authorityType: 'Domstol',
          court: 'Mark- och miljööverdomstolen',
          courtLevel: 'OVERDOMSTOL',
          legalArea: 'Miljö',
          publishedAt: pubDate,
          decisionDate: pubDate,
          caseNumber,
          metadata: {
            item,
            feed,
          },
          tags: ['judgment', 'mod', 'domstol-rss'],
          judgmentInput: {
            guid: item.guid,
            title,
            link: item.link,
            description: summary,
            pubDate: pubDate || new Date(),
          },
        },
        options,
      );
    }),
  );
  return results.filter((r): r is StructuredLegalCorpusRecord => r !== null);
}

async function collectDomstolHistoryRecords(
  rootDir: string,
  options: CollectDownloadedLegalCorpusOptions,
): Promise<StructuredLegalCorpusRecord[]> {
  const manifestPath = path.join(rootDir, 'legal', 'domstol-history', 'items.json');
  let manifest: any;
  try {
    manifest = await readJsonFile<{
      items?: Array<{ guid: string; title: string; link: string; savedAs: string }>;
    }>(manifestPath);
  } catch (e) {
    return []; // No history downloaded yet
  }

  if (!manifest) {
    return [];
  }

  const results = await Promise.all(
    (manifest.items || []).map(async (manifestItem: any) => {
      const sourcePath = path.join('legal', 'domstol-history', 'pages', manifestItem.savedAs);
      const fullPath = path.join(rootDir, sourcePath);
      let item: any = {};
      try {
        item = await readJsonFile<any>(fullPath);
      } catch (e) {
        console.warn(`[legalCorpusImportService] Missing or unreadable JSON file: ${fullPath}`);
        return null;
      }

      const isEnvironmental = (item.rattsomradeLista || []).some((r: string) => 
        r.toLowerCase().includes('miljö') || r.toLowerCase().includes('mark') || r.toLowerCase().includes('vatten')
      ) || (item.domstolLista || []).some((d: string) => 
        d.toLowerCase().includes('miljö') || d.toLowerCase().includes('mark')
      ) || (item.nyckelordLista || []).some((n: string) => 
        n.toLowerCase().includes('miljö') || n.toLowerCase().includes('pbl')
      );

      const title = item.malNummerLista?.[0] ? `Avgörande ${item.malNummerLista[0]}` : manifestItem.title;
      const summary = item.sammanfattning || title;
      const caseNumber = item.malNummerLista?.[0] || extractCaseNumber(title);
      const pubDate = item.avgorandedatum ? new Date(item.avgorandedatum) : new Date();

      return materializeStructuredRecord(
        rootDir,
        {
          sourceFamily: 'JUDGMENT',
          sourceSystem: 'DOMSTOL_RSS',
          sourceType: 'JUDGMENT',
          sourcePath,
          recordKey: toKey('domstol-history', manifestItem.savedAs),
          canonicalKey: toKey('domstol', item.id),
          externalId: item.id,
          title,
          summary,
          documentText: summary,
          sourceUrl: manifestItem.link,
          normalizedUrl: manifestItem.link,
          authorityName: item.domstolLista?.[0] || 'Sveriges Domstolar',
          authorityType: 'Domstol',
          court: item.domstolLista?.[0] || 'Sveriges Domstolar',
          courtLevel: 'OVERDOMSTOL',
          legalArea: item.rattsomradeLista?.[0] || 'Miljö',
          caseNumber,
          decisionDate: pubDate,
          publishedAt: pubDate,
          metadata: {
            item,
            isRelevantForAi: isEnvironmental
          },
          tags: ['judgment', 'domstol-history', isEnvironmental ? 'environmental' : 'other'],
          judgmentInput: {
            guid: item.id,
            title,
            link: manifestItem.link,
            description: summary,
            pubDate: pubDate,
          },
        },
        options,
      );
    }),
  );
  return results.filter((r): r is StructuredLegalCorpusRecord => r !== null);
}

async function collectModCorpusRecords(
  rootDir: string,
  options: CollectDownloadedLegalCorpusOptions,
): Promise<StructuredLegalCorpusRecord[]> {
  const manifestPath = path.join(rootDir, 'legal', 'mod-corpus', 'manifest.json');
  const manifest = await readJsonFile<{
    items?: Array<{ guid: string; title: string; link: string; savedAs: string }>;
  }>(manifestPath);

  const results = await Promise.all(
    (manifest.items || []).map((item) =>
      materializeStructuredRecord(
        rootDir,
        {
          sourceFamily: 'MÖD_CORPUS',
          sourceSystem: 'DOMSTOL_RSS',
          sourceType: 'JUDGMENT_CURATED_COPY',
          sourcePath: path.join('legal', 'mod-corpus', 'pages', item.savedAs),
          recordKey: toKey('mod-corpus', item.savedAs),
          canonicalKey: toKey('domstol', item.guid),
          externalId: item.guid,
          title: item.title,
          summary: item.title,
          sourceUrl: item.link,
          normalizedUrl: item.link,
          authorityName: 'Mark- och miljööverdomstolen',
          authorityType: 'Domstol',
          court: 'Mark- och miljööverdomstolen',
          courtLevel: 'OVERDOMSTOL',
          legalArea: 'Miljö',
          caseNumber: extractCaseNumber(item.title),
          metadata: {
            item,
            corpus: 'mod',
          },
          tags: ['judgment', 'mod', 'corpus-copy'],
        },
        options,
      ),
    ),
  );
  return results.filter((r): r is StructuredLegalCorpusRecord => r !== null);
}

async function collectMmdCorpusRecords(
  rootDir: string,
  options: CollectDownloadedLegalCorpusOptions,
): Promise<StructuredLegalCorpusRecord[]> {
  const manifestPath = path.join(rootDir, 'legal', 'mmd-corpus', 'manifest.json');
  const manifest = await readJsonFile<{
    courts?: Array<{ id: string; title: string; url: string; savedAs: string }>;
  }>(manifestPath);

  const records: StructuredLegalCorpusRecord[] = [];
  const overview = await materializeStructuredRecord(
    rootDir,
    {
      sourceFamily: 'MMD',
      sourceSystem: 'DOMSTOL_MMD',
      sourceType: 'COURT_OVERVIEW',
      sourcePath: path.join('legal', 'mmd-corpus', 'overview.html'),
      recordKey: toKey('mmd-overview', 'overview.html'),
      canonicalKey: toKey('domstol-mmd', 'overview'),
      title: 'Mark- och miljödomstolarna - översikt',
      summary: 'Översiktssida för mark- och miljödomstolarna.',
      sourceUrl:
        'https://www.domstol.se/amnen/mark-och-miljo/introduktion-till-mark--och-miljodomstolen/har-finns-vi/',
      normalizedUrl:
        'https://www.domstol.se/amnen/mark-och-miljo/introduktion-till-mark--och-miljodomstolen/har-finns-vi/',
      authorityName: 'Sveriges Domstolar',
      authorityType: 'Domstol',
      courtLevel: 'INSTANSOVERSIKT',
      legalArea: 'Miljö',
      metadata: {
        type: 'overview',
      },
      tags: ['mmd', 'court-overview'],
    },
    options,
  );
  if (overview) records.push(overview);

  for (const court of manifest.courts || []) {
    const record = await materializeStructuredRecord(
      rootDir,
      {
        sourceFamily: 'MMD',
        sourceSystem: 'DOMSTOL_MMD',
        sourceType: 'COURT_PAGE',
        sourcePath: path.join('legal', 'mmd-corpus', court.savedAs.replace(/\//g, path.sep)),
        recordKey: toKey('mmd', court.savedAs),
        canonicalKey: toKey('domstol-mmd', court.id),
        externalId: court.id,
        title: court.title,
        summary: court.title,
        sourceUrl: court.url,
        normalizedUrl: court.url,
        authorityName: court.title,
        authorityType: 'Domstol',
        court: court.title,
        courtLevel: 'MMD',
        legalArea: 'Miljö',
        metadata: {
          court,
        },
        tags: ['mmd', 'court-page'],
      },
      options,
    );
    if (record) records.push(record);
  }

  return records;
}

async function collectLansstyrelserRecords(
  rootDir: string,
  options: CollectDownloadedLegalCorpusOptions,
): Promise<StructuredLegalCorpusRecord[]> {
  const manifestPath = path.join(rootDir, 'lansstyrelserna', 'manifest.json');
  const manifest = await readJsonFile<{
    counties?: Array<{ id: string; title: string; url: string; savedAs: string }>;
  }>(manifestPath);

  const records: StructuredLegalCorpusRecord[] = [];
  const homepage = await materializeStructuredRecord(
    rootDir,
    {
      sourceFamily: 'LANSSTYRELSEN',
      sourceSystem: 'LANSSTYRELSEN',
      sourceType: 'PORTAL_HOME',
      sourcePath: path.join('lansstyrelserna', 'homepage.html'),
      recordKey: toKey('lansstyrelsen-home', 'homepage.html'),
      canonicalKey: toKey('lansstyrelsen', 'home'),
      title: 'Länsstyrelserna',
      summary: 'Startsida för Länsstyrelserna.',
      sourceUrl: 'https://www.lansstyrelsen.se/',
      normalizedUrl: 'https://www.lansstyrelsen.se/',
      authorityName: 'Länsstyrelserna',
      authorityType: 'Länsstyrelse',
      legalArea: 'Miljö',
      metadata: {
        type: 'homepage',
      },
      tags: ['lansstyrelsen', 'homepage'],
    },
    options,
  );
  if (homepage) records.push(homepage);

  for (const county of manifest.counties || []) {
    const record = await materializeStructuredRecord(
      rootDir,
      {
        sourceFamily: 'LANSSTYRELSEN',
        sourceSystem: 'LANSSTYRELSEN',
        sourceType: 'COUNTY_PAGE',
        sourcePath: path.join('lansstyrelserna', county.savedAs.replace(/\//g, path.sep)),
        recordKey: toKey('lansstyrelsen', county.savedAs),
        canonicalKey: toKey('lansstyrelsen', county.id),
        externalId: county.id,
        title: county.title,
        summary: county.title,
        sourceUrl: county.url,
        normalizedUrl: county.url,
        authorityName: county.title,
        authorityType: 'Länsstyrelse',
        municipality: county.title,
        legalArea: 'Miljö',
        metadata: {
          county,
        },
        tags: ['lansstyrelsen', 'county-page'],
      },
      options,
    );
    if (record) records.push(record);
  }

  return records;
}

async function collectNaturvardsverketRecords(
  rootDir: string,
  options: CollectDownloadedLegalCorpusOptions,
): Promise<StructuredLegalCorpusRecord[]> {
  const manifestPath = path.join(rootDir, 'naturvardsverket', 'manifest.json');
  const manifest = await readJsonFile<JsonObject>(manifestPath);

  const results = await Promise.all([
    materializeStructuredRecord(
      rootDir,
      {
        sourceFamily: 'NATURVARDSVERKET',
        sourceSystem: 'NATURVARDSVERKET',
        sourceType: 'OPEN_DATA_PORTAL',
        sourcePath: path.join('naturvardsverket', 'oppnadata.html'),
        recordKey: toKey('naturvardsverket', 'oppnadata.html'),
        canonicalKey: toKey('naturvardsverket', 'oppnadata'),
        title: 'Naturvårdsverket - öppna data',
        summary: 'Naturvårdsverkets öppna data-portal.',
        sourceUrl: 'https://oppnadata.naturvardsverket.se/',
        normalizedUrl: 'https://oppnadata.naturvardsverket.se/',
        authorityName: 'Naturvårdsverket',
        authorityType: 'Myndighet',
        legalArea: 'Miljö',
        metadata: { manifest, file: 'oppnadata.html' },
        tags: ['naturvardsverket', 'open-data'],
      },
      options,
    ),
    materializeStructuredRecord(
      rootDir,
      {
        sourceFamily: 'NATURVARDSVERKET',
        sourceSystem: 'NATURVARDSVERKET',
        sourceType: 'GEODATA_CATALOG',
        sourcePath: path.join('naturvardsverket', 'geodatakatalogen.html'),
        recordKey: toKey('naturvardsverket', 'geodatakatalogen.html'),
        canonicalKey: toKey('naturvardsverket', 'geodatakatalogen'),
        title: 'Naturvårdsverket - geodatakatalog',
        summary: 'Naturvårdsverkets geodatakatalog.',
        sourceUrl: 'https://geodatakatalogen.naturvardsverket.se/',
        normalizedUrl: 'https://geodatakatalogen.naturvardsverket.se/',
        authorityName: 'Naturvårdsverket',
        authorityType: 'Myndighet',
        legalArea: 'Miljö',
        metadata: { manifest, file: 'geodatakatalogen.html' },
        tags: ['naturvardsverket', 'geodata'],
      },
      options,
    ),
    materializeStructuredRecord(
      rootDir,
      {
        sourceFamily: 'NATURVARDSVERKET',
        sourceSystem: 'NATURVARDSVERKET',
        sourceType: 'WFS_CAPABILITIES',
        sourcePath: path.join('naturvardsverket', 'naturvardsregistret-wfs-capabilities.xml'),
        recordKey: toKey('naturvardsverket', 'naturvardsregistret-wfs-capabilities.xml'),
        canonicalKey: toKey('naturvardsverket', 'naturvardsregistret-wfs-capabilities'),
        title: 'Naturvårdsregistret WFS GetCapabilities',
        summary: 'WFS-kapabiliteter för Naturvårdsregistret.',
        sourceUrl:
          'https://geodata.naturvardsverket.se/naturvardsregistret/wfs?service=WFS&request=GetCapabilities',
        normalizedUrl:
          'https://geodata.naturvardsverket.se/naturvardsregistret/wfs?service=WFS&request=GetCapabilities',
        authorityName: 'Naturvårdsverket',
        authorityType: 'Myndighet',
        legalArea: 'Miljö',
        postgisSchemaOverride: 'env',
        postgisTableOverride: 'nv_naturvardsregistret_capabilities',
        metadata: { manifest, file: 'naturvardsregistret-wfs-capabilities.xml' },
        tags: ['naturvardsverket', 'wfs', 'geodata'],
      },
      options,
    ),
  ]);
  return results.filter((r): r is StructuredLegalCorpusRecord => r !== null);
}

async function collectNaturvardsverketPdfRecords(
  rootDir: string,
  options: CollectDownloadedLegalCorpusOptions,
): Promise<StructuredLegalCorpusRecord[]> {
  const manifestPath = path.join(rootDir, 'naturvardsverket', 'broschyrer', 'manifest.json');
  if (!(await fileExists(manifestPath))) {
    return [];
  }

  const manifest = await readJsonFile<{
    downloads?: Array<{ title: string; sourceUrl: string; savedAs: string }>;
  }>(manifestPath);
  const downloads = manifest.downloads || [];

  const results = await Promise.all(
    downloads.map((download) =>
      materializeStructuredRecord(
        rootDir,
        {
          sourceFamily: 'NATURVARDSVERKET',
          sourceSystem: 'NATURVARDSVERKET',
          sourceType: 'NATURVARDSVERKET_PDF_PUBLICATION',
          sourcePath: path.join('naturvardsverket', download.savedAs),
          recordKey: toKey('naturvardsverket-pdf', download.savedAs),
          canonicalKey: toKey('naturvardsverket', download.savedAs),
          externalId: download.savedAs,
          title: download.title,
          summary: download.title,
          sourceUrl: download.sourceUrl,
          normalizedUrl: download.sourceUrl,
          authorityName: 'Naturvårdsverket',
          authorityType: 'Myndighet',
          legalArea: 'Miljö',
          mimeType: 'application/pdf',
          formatHint: 'pdf',
          metadata: {
            download,
          },
          tags: ['naturvardsverket', 'pdf', 'publikation'],
        },
        options,
      ),
    ),
  );

  return results.filter((r): r is StructuredLegalCorpusRecord => r !== null);
}

async function collectNaturvardsverketSitePdfRecords(
  rootDir: string,
  options: CollectDownloadedLegalCorpusOptions,
): Promise<StructuredLegalCorpusRecord[]> {
  const manifestPath = path.join(rootDir, 'naturvardsverket', 'broschyrer-site', 'manifest.json');
  if (!(await fileExists(manifestPath))) {
    return [];
  }

  const manifest = await readJsonFile<{
    downloads?: Array<{ title: string; sourceUrl: string; savedAs: string; detailUrl?: string }>;
  }>(manifestPath);
  const downloads = manifest.downloads || [];

  const results = await Promise.all(
    downloads.map((download) =>
      materializeStructuredRecord(
        rootDir,
        {
          sourceFamily: 'NATURVARDSVERKET',
          sourceSystem: 'NATURVARDSVERKET',
          sourceType: 'NATURVARDSVERKET_PDF_PUBLICATION',
          sourcePath: path.join('naturvardsverket', download.savedAs),
          recordKey: toKey('naturvardsverket-pdf-site', download.savedAs),
          canonicalKey: toKey('naturvardsverket', download.savedAs),
          externalId: download.savedAs,
          title: download.title,
          summary: download.title,
          sourceUrl: download.sourceUrl,
          normalizedUrl: download.sourceUrl,
          authorityName: 'Naturvårdsverket',
          authorityType: 'Myndighet',
          legalArea: 'Miljö',
          mimeType: 'application/pdf',
          formatHint: 'pdf',
          metadata: {
            download,
          },
          tags: ['naturvardsverket', 'pdf', 'publikation', 'site'],
        },
        options,
      ),
    ),
  );

  return results.filter((r): r is StructuredLegalCorpusRecord => r !== null);
}

async function collectOpenSourceSweepRecords(
  rootDir: string,
  options: CollectDownloadedLegalCorpusOptions,
): Promise<StructuredLegalCorpusRecord[]> {
  const manifestPath = path.join(rootDir, 'open-source-sweep', 'manifest.json');
  const manifest = await readJsonFile<{ entries?: Array<{ id: string; url: string; fileName: string }> }>(
    manifestPath,
  );
  if (!manifest) {
    return [];
  }

  const results = await Promise.all(
    (manifest.entries || []).map((entry) =>
      materializeStructuredRecord(
        rootDir,
        {
          sourceFamily: 'OPEN_SOURCE_SWEEP',
          sourceSystem: inferSourceSystemFromId(entry.id),
          sourceType: inferSourceTypeFromUrl(entry.url),
          sourcePath: path.join('open-source-sweep', entry.fileName),
          recordKey: toKey('open-source-sweep', entry.fileName),
          canonicalKey: toKey('open-source', entry.id),
          externalId: entry.id,
          title: humanizeIdentifier(entry.id),
          summary: entry.url,
          sourceUrl: entry.url,
          normalizedUrl: entry.url,
          authorityName: inferAuthorityNameFromId(entry.id),
          authorityType: inferAuthorityType(inferAuthorityNameFromId(entry.id), entry.id),
          legalArea: inferLegalArea(entry.id),
          metadata: {
            entry,
          },
          tags: ['open-source-sweep', normalizeSearchToken(entry.id)],
          postgisSchemaOverride: /wfs|wms/i.test(entry.url) ? 'env' : undefined,
          postgisTableOverride: /wfs|wms/i.test(entry.url) ? sanitizeDatabaseIdentifier(entry.id) : undefined,
        },
        options,
      ),
    ),
  );
  return results.filter((r): r is StructuredLegalCorpusRecord => r !== null);
}

async function collectBergsstatenRecords(
  rootDir: string,
  options: CollectDownloadedLegalCorpusOptions,
): Promise<StructuredLegalCorpusRecord[]> {
  const manifestPath = path.join(rootDir, 'bergsstaten', 'manifest.json');
  if (!(await fileExists(manifestPath))) {
    return [];
  }

  const manifest = await readJsonFile<{
    pages?: Array<{ title: string; sourceUrl: string; savedAs: string; normalizedUrl?: string }>;
    pdfs?: Array<{
      title: string;
      sourceUrl: string;
      normalizedUrl?: string;
      parentUrl?: string;
      savedAs: string;
      bytes?: number;
    }>;
  }>(manifestPath);

  const pageRecords = await Promise.all(
    (manifest.pages || []).map((page) =>
      materializeStructuredRecord(
        rootDir,
        {
          sourceFamily: 'BERGSSTATEN',
          sourceSystem: 'BERGSSTATEN',
          sourceType: 'BERGSSTATEN_PAGE',
          sourcePath: path.join('bergsstaten', page.savedAs.replace(/\//g, path.sep)),
          recordKey: toKey('bergsstaten-page', page.savedAs),
          canonicalKey: toKey('bergsstaten', page.savedAs),
          externalId: page.savedAs,
          title: page.title,
          summary: page.title,
          sourceUrl: page.sourceUrl,
          normalizedUrl: page.normalizedUrl || page.sourceUrl,
          authorityName: 'Bergsstaten (SGU)',
          authorityType: 'Myndighet',
          legalArea: 'Miljöprövning',
          metadata: {
            page,
          },
          tags: ['bergsstaten', 'page'],
        },
        options,
      ),
    ),
  );

  const pdfRecords = await Promise.all(
    (manifest.pdfs || []).map((pdf) =>
      materializeStructuredRecord(
        rootDir,
        {
          sourceFamily: 'BERGSSTATEN',
          sourceSystem: 'BERGSSTATEN',
          sourceType: 'BERGSSTATEN_PDF_DOCUMENT',
          sourcePath: path.join('bergsstaten', pdf.savedAs.replace(/\//g, path.sep)),
          recordKey: toKey('bergsstaten-pdf', pdf.savedAs),
          canonicalKey: toKey('bergsstaten', pdf.savedAs),
          externalId: pdf.savedAs,
          title: pdf.title,
          summary: pdf.title,
          sourceUrl: pdf.sourceUrl,
          normalizedUrl: pdf.normalizedUrl || pdf.sourceUrl,
          authorityName: 'Bergsstaten (SGU)',
          authorityType: 'Myndighet',
          legalArea: 'Miljöprövning',
          mimeType: 'application/pdf',
          formatHint: 'pdf',
          metadata: {
            pdf,
            parentUrl: pdf.parentUrl,
          },
          tags: ['bergsstaten', 'pdf', 'kungorelse', 'mineralratt'],
        },
        options,
      ),
    ),
  );

  return [...pageRecords, ...pdfRecords].filter((r): r is StructuredLegalCorpusRecord => r !== null);
}

async function collectSguAnvandarstodRecords(
  rootDir: string,
  options: CollectDownloadedLegalCorpusOptions,
): Promise<StructuredLegalCorpusRecord[]> {
  const manifestPath = path.join(rootDir, 'sgu-anvandarstod', 'manifest.json');
  if (!(await fileExists(manifestPath))) {
    return [];
  }

  const manifest = await readJsonFile<{
    pages?: Array<{ title: string; sourceUrl: string; savedAs: string; normalizedUrl?: string }>;
    pdfs?: Array<{
      title: string;
      sourceUrl: string;
      normalizedUrl?: string;
      parentUrl?: string;
      savedAs: string;
    }>;
  }>(manifestPath);

  const pageRecords = await Promise.all(
    (manifest.pages || []).map((page) =>
      materializeStructuredRecord(
        rootDir,
        {
          sourceFamily: 'SGU',
          sourceSystem: 'SGU_ANVANDARSTOD',
          sourceType: 'SGU_GUIDANCE_PAGE',
          sourcePath: path.join('sgu-anvandarstod', page.savedAs.replace(/\//g, path.sep)),
          recordKey: toKey('sgu-anvandarstod-page', page.savedAs),
          canonicalKey: toKey('sgu-anvandarstod', page.savedAs),
          externalId: page.savedAs,
          title: page.title,
          summary: page.title,
          sourceUrl: page.sourceUrl,
          normalizedUrl: page.normalizedUrl || page.sourceUrl,
          authorityName: 'Sveriges geologiska undersokning (SGU)',
          authorityType: 'Myndighet',
          legalArea: 'Geologi och miljo',
          metadata: {
            page,
          },
          tags: ['sgu', 'anvandarstod', 'guidance'],
        },
        options,
      ),
    ),
  );

  const pdfRecords = await Promise.all(
    (manifest.pdfs || []).map((pdf) =>
      materializeStructuredRecord(
        rootDir,
        {
          sourceFamily: 'SGU',
          sourceSystem: 'SGU_ANVANDARSTOD',
          sourceType: 'SGU_GUIDANCE_PDF',
          sourcePath: path.join('sgu-anvandarstod', pdf.savedAs.replace(/\//g, path.sep)),
          recordKey: toKey('sgu-anvandarstod-pdf', pdf.savedAs),
          canonicalKey: toKey('sgu-anvandarstod', pdf.savedAs),
          externalId: pdf.savedAs,
          title: pdf.title,
          summary: pdf.title,
          sourceUrl: pdf.sourceUrl,
          normalizedUrl: pdf.normalizedUrl || pdf.sourceUrl,
          authorityName: 'Sveriges geologiska undersokning (SGU)',
          authorityType: 'Myndighet',
          legalArea: 'Geologi och miljo',
          mimeType: 'application/pdf',
          formatHint: 'pdf',
          metadata: {
            pdf,
            parentUrl: pdf.parentUrl,
          },
          tags: ['sgu', 'anvandarstod', 'pdf'],
        },
        options,
      ),
    ),
  );

  return [...pageRecords, ...pdfRecords].filter((r): r is StructuredLegalCorpusRecord => r !== null);
}

async function collectSguPortalRecords(
  rootDir: string,
  options: CollectDownloadedLegalCorpusOptions,
): Promise<StructuredLegalCorpusRecord[]> {
  const manifestPath = path.join(rootDir, 'sgu-portal', 'manifest.json');
  if (!(await fileExists(manifestPath))) {
    return [];
  }

  const manifest = await readJsonFile<{
    pages?: Array<{ title: string; sourceUrl: string; savedAs: string; normalizedUrl?: string }>;
    pdfs?: Array<{
      title: string;
      sourceUrl: string;
      normalizedUrl?: string;
      parentUrl?: string;
      savedAs: string;
    }>;
  }>(manifestPath);

  const pageRecords = await Promise.all(
    (manifest.pages || []).map((page) =>
      materializeStructuredRecord(
        rootDir,
        {
          sourceFamily: 'SGU',
          sourceSystem: 'SGU_PORTAL',
          sourceType: 'SGU_PORTAL_PAGE',
          sourcePath: path.join('sgu-portal', page.savedAs.replace(/\//g, path.sep)),
          recordKey: toKey('sgu-portal-page', page.savedAs),
          canonicalKey: toKey('sgu-portal', page.savedAs),
          externalId: page.savedAs,
          title: page.title,
          summary: page.title,
          sourceUrl: page.sourceUrl,
          normalizedUrl: page.normalizedUrl || page.sourceUrl,
          authorityName: 'Sveriges geologiska undersokning (SGU)',
          authorityType: 'Myndighet',
          legalArea: 'Geologi och miljo',
          metadata: {
            page,
          },
          tags: ['sgu', 'portal', 'geodata'],
        },
        options,
      ),
    ),
  );

  const pdfRecords = await Promise.all(
    (manifest.pdfs || []).map((pdf) =>
      materializeStructuredRecord(
        rootDir,
        {
          sourceFamily: 'SGU',
          sourceSystem: 'SGU_PORTAL',
          sourceType: 'SGU_PORTAL_PDF',
          sourcePath: path.join('sgu-portal', pdf.savedAs.replace(/\//g, path.sep)),
          recordKey: toKey('sgu-portal-pdf', pdf.savedAs),
          canonicalKey: toKey('sgu-portal', pdf.savedAs),
          externalId: pdf.savedAs,
          title: pdf.title,
          summary: pdf.title,
          sourceUrl: pdf.sourceUrl,
          normalizedUrl: pdf.normalizedUrl || pdf.sourceUrl,
          authorityName: 'Sveriges geologiska undersokning (SGU)',
          authorityType: 'Myndighet',
          legalArea: 'Geologi och miljo',
          mimeType: 'application/pdf',
          formatHint: 'pdf',
          metadata: {
            pdf,
            parentUrl: pdf.parentUrl,
          },
          tags: ['sgu', 'portal', 'pdf'],
        },
        options,
      ),
    ),
  );

  return [...pageRecords, ...pdfRecords].filter((r): r is StructuredLegalCorpusRecord => r !== null);
}

async function collectDivaRecords(
  rootDir: string,
  options: CollectDownloadedLegalCorpusOptions,
): Promise<StructuredLegalCorpusRecord[]> {
  const topEntries = await fs.readdir(rootDir, { withFileTypes: true });
  const divaDirs = topEntries.filter((entry) => entry.isDirectory() && /^diva-/i.test(entry.name));

  if (!divaDirs.length) {
    return [];
  }

  const allRecords: StructuredLegalCorpusRecord[] = [];

  for (const dir of divaDirs) {
    const domain = dir.name.replace(/^diva-/i, '').trim().toLowerCase() || 'unknown';
    const manifestPath = path.join(rootDir, dir.name, 'manifest.json');
    if (!(await fileExists(manifestPath))) {
      continue;
    }

    const manifest = await readJsonFile<{
      domain?: string;
      records?: Array<{
        id: string;
        title: string;
        sourceUrl: string;
        normalizedUrl?: string;
        savedAs: string;
        metadataPrefix?: string;
        setSpec?: string;
      }>;
      pdfs?: Array<{
        id: string;
        sourceUrl: string;
        normalizedUrl?: string;
        parentId?: string;
        savedAs: string;
        bytes?: number;
      }>;
    }>(manifestPath);

    const manifestDomain = (manifest.domain || domain).trim().toLowerCase();

    const metadataRecords = await Promise.all(
      (manifest.records || []).map((entry) =>
        materializeStructuredRecord(
          rootDir,
          {
            sourceFamily: 'DIVA',
            sourceSystem: 'DIVA_OAI_PMH',
            sourceType: 'DIVA_METADATA_RECORD',
            sourcePath: path.join(dir.name, entry.savedAs.replace(/\//g, path.sep)),
            recordKey: toKey('diva-record', `${manifestDomain}__${entry.id}`),
            canonicalKey: toKey('diva', `${manifestDomain}__${entry.id}`),
            externalId: entry.id,
            title: entry.title,
            summary: `DiVA ${manifestDomain} ${entry.metadataPrefix || ''} ${entry.setSpec || ''}`
              .trim()
              .replace(/\s+/g, ' '),
            sourceUrl: entry.sourceUrl,
            normalizedUrl: entry.normalizedUrl || entry.sourceUrl,
            authorityName: `DiVA (${manifestDomain})`,
            authorityType: 'Universitetsarkiv',
            legalArea: 'Forskning och miljo',
            formatHint: 'json',
            metadata: {
              domain: manifestDomain,
              oai: {
                metadataPrefix: entry.metadataPrefix,
                setSpec: entry.setSpec,
              },
              record: entry,
            },
            tags: ['diva', 'oai-pmh', 'metadata', manifestDomain],
          },
          options,
        ),
      ),
    );

    const pdfRecords = await Promise.all(
      (manifest.pdfs || []).map((entry) =>
        materializeStructuredRecord(
          rootDir,
          {
            sourceFamily: 'DIVA',
            sourceSystem: 'DIVA_OAI_PMH',
            sourceType: 'DIVA_FULLTEXT_PDF',
            sourcePath: path.join(dir.name, entry.savedAs.replace(/\//g, path.sep)),
            recordKey: toKey('diva-pdf', `${manifestDomain}__${entry.id}`),
            canonicalKey: toKey('diva', `${manifestDomain}__${entry.parentId || entry.id}`),
            externalId: entry.id,
            title: `DiVA PDF ${entry.parentId || entry.id}`,
            summary: entry.sourceUrl,
            sourceUrl: entry.sourceUrl,
            normalizedUrl: entry.normalizedUrl || entry.sourceUrl,
            authorityName: `DiVA (${manifestDomain})`,
            authorityType: 'Universitetsarkiv',
            legalArea: 'Forskning och miljo',
            mimeType: 'application/pdf',
            formatHint: 'pdf',
            byteSize: entry.bytes,
            metadata: {
              domain: manifestDomain,
              pdf: entry,
            },
            tags: ['diva', 'pdf', 'fulltext', manifestDomain],
          },
          options,
        ),
      ),
    );

    allRecords.push(
      ...metadataRecords.filter((r): r is StructuredLegalCorpusRecord => r !== null),
      ...pdfRecords.filter((r): r is StructuredLegalCorpusRecord => r !== null),
    );
  }

  return allRecords;
}

async function collectBoverketRecords(
  rootDir: string,
  options: CollectDownloadedLegalCorpusOptions,
): Promise<StructuredLegalCorpusRecord[]> {
  const boverketRoot = path.join(rootDir, 'boverket');
  const metadataDir = path.join(boverketRoot, 'forfattningar', 'metadata');
  const documentsDir = path.join(boverketRoot, 'forfattningar', 'dokument');
  const extraDir = path.join(boverketRoot, 'forfattningar', 'ovriga-dokument');

  const metadataFiles = await fs.readdir(metadataDir);
  const records: StructuredLegalCorpusRecord[] = [];

  for (const metadataFile of metadataFiles) {
    const metadataPath = path.join(metadataDir, metadataFile);
    const metadataJson = await readJsonFile<JsonObject>(metadataPath);
    const metadataId = String(metadataJson.id || fileStem(metadataFile));
    const canonicalKey = toKey('boverket', metadataId);
    const title =
      normalizeExternalText(String(metadataJson.titel || metadataJson.forfattning || metadataId)) ||
      metadataId;
    const summary = [
      normalizeExternalText(String(metadataJson.forfattning || '')),
      normalizeExternalText(String(metadataJson.forkortning || '')),
      normalizeExternalText(String(metadataJson.typ || '')),
    ]
      .filter(Boolean)
      .join(' | ');

    records.push(
      await materializeStructuredRecord(
        rootDir,
        {
          sourceFamily: 'BOVERKET',
          sourceSystem: 'BOVERKET',
          sourceType: 'BOVERKET_METADATA',
          sourcePath: path.join('boverket', 'forfattningar', 'metadata', metadataFile),
          recordKey: toKey('boverket-metadata', metadataFile),
          canonicalKey,
          externalId: metadataId,
          title,
          summary,
          sourceUrl: stringOrUndefined(metadataJson.dokumentlank),
          normalizedUrl: stringOrUndefined(metadataJson.dokumentlank),
          authorityName: 'Boverket',
          authorityType: 'Myndighet',
          legalArea: inferLegalArea(title),
          publishedAt: parseDateValue(metadataJson.trycklovad) || parseDateValue(metadataJson.beslutad),
          decisionDate: parseDateValue(metadataJson.beslutad),
          metadata: metadataJson,
          tags: ['boverket', 'metadata', normalizeSearchToken(String(metadataJson.typ || 'forfattning'))],
        },
        options,
      ),
    );

    const primaryDocumentPath = path.join(documentsDir, `${fileStem(metadataFile)}.pdf`);
    if (await fileExists(primaryDocumentPath)) {
      records.push(
        await materializeStructuredRecord(
          rootDir,
          {
            sourceFamily: 'BOVERKET',
            sourceSystem: 'BOVERKET',
            sourceType: 'BOVERKET_PRIMARY_DOCUMENT',
            sourcePath: path.join('boverket', 'forfattningar', 'dokument', `${fileStem(metadataFile)}.pdf`),
            recordKey: toKey('boverket-primary', `${fileStem(metadataFile)}.pdf`),
            canonicalKey,
            externalId: metadataId,
            title,
            summary,
            sourceUrl: stringOrUndefined(metadataJson.dokumentlank),
            normalizedUrl: stringOrUndefined(metadataJson.dokumentlank),
            authorityName: 'Boverket',
            authorityType: 'Myndighet',
            legalArea: inferLegalArea(title),
            publishedAt: parseDateValue(metadataJson.trycklovad) || parseDateValue(metadataJson.beslutad),
            decisionDate: parseDateValue(metadataJson.beslutad),
            metadata: {
              metadataId,
              type: 'primary-document',
            },
            tags: ['boverket', 'pdf', 'primary'],
          },
          options,
        ),
      );
    }
  }

  const extraFiles = await fs.readdir(extraDir);
  for (const extraFile of extraFiles) {
    const match = extraFile.match(/^([^_]+)__([0-9]{2})__(.+)\.pdf$/i);
    const baseId = match?.[1]?.toUpperCase() || fileStem(extraFile).toUpperCase();
    const attachmentLabel = humanizeIdentifier(match?.[3] || 'bilaga');
    records.push(
      await materializeStructuredRecord(
        rootDir,
        {
          sourceFamily: 'BOVERKET',
          sourceSystem: 'BOVERKET',
          sourceType: 'BOVERKET_ATTACHMENT',
          sourcePath: path.join('boverket', 'forfattningar', 'ovriga-dokument', extraFile),
          recordKey: toKey('boverket-attachment', extraFile),
          canonicalKey: toKey('boverket', baseId),
          externalId: `${baseId}::${match?.[2] || '00'}`,
          title: `${baseId} ${attachmentLabel}`,
          summary: `${baseId} ${attachmentLabel}`,
          authorityName: 'Boverket',
          authorityType: 'Myndighet',
          legalArea: 'Plan och bygg',
          metadata: {
            baseId,
            attachmentIndex: match?.[2],
            attachmentLabel,
          },
          tags: ['boverket', 'attachment', normalizeSearchToken(attachmentLabel)],
        },
        options,
      ),
    );
  }

  const topLevelFiles = [
    {
      fileName: 'forfattningssamling.json',
      sourceType: 'BOVERKET_CATALOG',
      title: 'Boverket forfattningssamling',
    },
    {
      fileName: 'termbank-api-info.html',
      sourceType: 'BOVERKET_TERMBANK_INFO',
      title: 'Boverket termbank API-info',
    },
    {
      fileName: 'termbank-source.json',
      sourceType: 'BOVERKET_TERMBANK_SOURCE',
      title: 'Boverket termbank källa',
    },
    {
      fileName: 'termbank-teknisk-beskrivning.pdf',
      sourceType: 'BOVERKET_TERMBANK_PDF',
      title: 'Boverket termbank teknisk beskrivning',
    },
    {
      fileName: 'bbr_bfs_2011_6.json',
      sourceType: 'BOVERKET_REFERENCE_JSON',
      title: 'Boverket BBR BFS 2011:6',
    },
  ];

  for (const topLevel of topLevelFiles) {
    const fullPath = path.join(boverketRoot, topLevel.fileName);
    if (!(await fileExists(fullPath))) {
      continue;
    }
    records.push(
      await materializeStructuredRecord(
        rootDir,
        {
          sourceFamily: 'BOVERKET',
          sourceSystem: 'BOVERKET',
          sourceType: topLevel.sourceType,
          sourcePath: path.join('boverket', topLevel.fileName),
          recordKey: toKey('boverket-top', topLevel.fileName),
          canonicalKey: toKey('boverket-top', topLevel.fileName),
          externalId: fileStem(topLevel.fileName),
          title: topLevel.title,
          summary: topLevel.title,
          authorityName: 'Boverket',
          authorityType: 'Myndighet',
          legalArea: 'Plan och bygg',
          metadata: {
            fileName: topLevel.fileName,
          },
          tags: ['boverket', 'catalog'],
        },
        options,
      ),
    );
  }

  return records;
}

async function materializeStructuredRecord(
  rootDir: string,
  seed: Omit<StructuredLegalCorpusRecord, 'searchText'> & { searchText?: string },
  options: CollectDownloadedLegalCorpusOptions,
): Promise<StructuredLegalCorpusRecord | null> {
  const fullPath = path.join(rootDir, seed.sourcePath);

  let extracted;
  try {
    extracted = await extractCorpusContent(fullPath, seed.mimeType, {
      extractPdfText: options.extractPdfText,
    });
  } catch (err) {
    console.warn(
      `[legalCorpusImportService] Hoppar över fil som saknas eller inte kan läsas: ${seed.sourcePath}`,
    );
    return null;
  }

  const title = normalizeExternalText(seed.title) || extracted.detectedTitle || fileStem(seed.sourcePath);
  const summary = normalizeExternalText(seed.summary) || extracted.detectedSummary;
  const documentText = normalizeExternalText(seed.documentText || extracted.documentText)?.replace(/\0/g, '');
  const sourceUrl = normalizeExternalText(seed.sourceUrl);
  const normalizedUrl = normalizeExternalText(seed.normalizedUrl || sourceUrl);
  const publishedAt = seed.publishedAt;
  const decisionDate = seed.decisionDate;
  const year = seed.year || inferYear(publishedAt, decisionDate, sourceUrl, seed.title, seed.sourcePath);
  const caseNumber = normalizeExternalText(
    seed.caseNumber || extractCaseNumber(title) || extractCaseNumber(documentText || ''),
  );
  const metadata = {
    ...seed.metadata,
    extraction: {
      sourcePath: seed.sourcePath,
      formatHint: seed.formatHint || extracted.formatHint,
      mimeType: seed.mimeType || extracted.mimeType,
    },
  } as JsonObject;

  const searchText = (
    seed.searchText ||
    normalizeExternalText(
      [title, summary, seed.authorityName, seed.court, caseNumber, seed.legalArea, documentText]
        .filter(Boolean)
        .join(' '),
    ) ||
    title
  )?.replace(/\0/g, '');

  return {
    ...seed,
    title,
    summary,
    sourceUrl,
    normalizedUrl,
    mimeType: seed.mimeType || extracted.mimeType,
    formatHint: seed.formatHint || extracted.formatHint,
    documentText,
    searchText,
    metadata: toSerializableValue(metadata) as JsonObject,
    caseNumber,
    year,
    language: seed.language || 'sv',
    contentHash: extracted.contentHash,
    byteSize: seed.byteSize ?? extracted.byteSize,
    tags: uniqueStrings(seed.tags),
  };
}

async function readDomstolFeed(feedPath: string): Promise<Map<string, DomstolFeedItem>> {
  const xml = await fs.readFile(feedPath, 'utf8');
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    textNodeName: '#text',
    ignoreDeclaration: true,
    parseTagValue: false,
    trimValues: true,
  });

  const parsed = parser.parse(xml) as {
    rss?: { channel?: { item?: Array<Record<string, unknown>> | Record<string, unknown> } };
  };
  const rawItems = parsed.rss?.channel?.item;
  const items = Array.isArray(rawItems) ? rawItems : rawItems ? [rawItems] : [];
  const map = new Map<string, DomstolFeedItem>();

  for (const item of items) {
    const guidValue = item.guid;
    const guid =
      typeof guidValue === 'string'
        ? guidValue
        : typeof guidValue === 'object' && guidValue && '#text' in guidValue
          ? String((guidValue as { '#text'?: string })['#text'] || '')
          : '';
    if (!guid) {
      continue;
    }
    map.set(guid, {
      guid,
      title: String(item.title || guid),
      link: String(item.link || ''),
      description: stringOrUndefined(item.description),
      pubDate: parseDateValue(item.pubDate),
    });
  }

  return map;
}

function inferFoundationType(title: string): string {
  const normalized = normalizeSearchToken(title);
  if (normalized.includes('lag') || normalized.includes('balk')) {
    return 'FOUNDATION_LAW';
  }
  return 'FOUNDATION_ORDINANCE';
}

function inferFoundationAuthority(title: string): string {
  return inferFoundationType(title) === 'FOUNDATION_LAW' ? 'Riksdagen' : 'Regeringen';
}

function inferFoundationAuthorityType(title: string): string {
  return inferFoundationType(title) === 'FOUNDATION_LAW' ? 'Lagstiftare' : 'Regering';
}

function inferLegalArea(input: string): string {
  const normalized = normalizeSearchToken(input);
  if (/(plan|bygg|pbl|pbf|boverket)/.test(normalized)) {
    return 'Plan och bygg';
  }
  if (/(miljo|miljooverdomstolen|naturvardsverket|hav|avlopp|avfalls|domstol)/.test(normalized)) {
    return 'Miljö';
  }
  if (/(geo|wfs|wms|lantmateriet|sgu|smhi|raa|msb)/.test(normalized)) {
    return 'Miljö och geodata';
  }
  return 'Miljö';
}

function inferAuthorityType(authorityName?: string, title?: string): string | undefined {
  const normalized = normalizeSearchToken(`${authorityName || ''} ${title || ''}`);
  if (!normalized) {
    return undefined;
  }
  if (normalized.includes('domstol')) {
    return 'Domstol';
  }
  if (normalized.includes('lan') && normalized.includes('styrelse')) {
    return 'Länsstyrelse';
  }
  if (normalized.includes('kommun')) {
    return 'Kommun';
  }
  if (
    normalized.includes('verket') ||
    normalized.includes('myndigheten') ||
    normalized.includes('boverket') ||
    normalized.includes('naturvardsverket')
  ) {
    return 'Myndighet';
  }
  return undefined;
}

function inferSourceSystemFromId(id: string): string {
  const normalized = normalizeSearchToken(id);
  if (normalized.startsWith('scb')) return 'SCB';
  if (normalized.startsWith('smhi')) return 'SMHI';
  if (normalized.startsWith('sgu')) return 'SGU';
  if (normalized.startsWith('raa')) return 'RAA';
  if (normalized.startsWith('msb')) return 'MSB';
  if (normalized.startsWith('lantmateriet')) return 'LANTMATERIET';
  if (normalized.startsWith('boverket')) return 'BOVERKET';
  if (normalized.startsWith('hav')) return 'HAV';
  if (normalized.startsWith('naturvardsverket')) return 'NATURVARDSVERKET';
  if (normalized.startsWith('lansstyrelsen')) return 'LANSSTYRELSEN';
  return 'OPEN_SOURCE';
}

function inferAuthorityNameFromId(id: string): string | undefined {
  const map: Record<string, string> = {
    scb: 'SCB',
    smhi: 'SMHI',
    sgu: 'SGU',
    raa: 'Riksantikvarieämbetet',
    msb: 'Myndigheten för samhällsskydd och beredskap',
    lantmateriet: 'Lantmäteriet',
    boverket: 'Boverket',
    hav: 'Havs- och vattenmyndigheten',
    naturvardsverket: 'Naturvårdsverket',
    lansstyrelsen: 'Länsstyrelsen',
    smp: 'Svenska miljörapporteringsportalen',
  };

  const normalized = normalizeSearchToken(id);
  for (const [prefix, label] of Object.entries(map)) {
    if (normalized.startsWith(prefix)) {
      return label;
    }
  }
  return humanizeIdentifier(id);
}

function inferSourceSystemFromUrl(url: string): string {
  const hostname = normalizeSearchToken(url);
  if (hostname.includes('domstol')) return 'DOMSTOL_RSS';
  if (hostname.includes('rkrattsbaser')) return 'SFS';
  if (hostname.includes('havochvatten')) return 'HAV';
  if (hostname.includes('lansstyrelsen')) return 'LANSSTYRELSEN';
  if (hostname.includes('boverket')) return 'BOVERKET';
  if (hostname.includes('naturvardsverket')) return 'NATURVARDSVERKET';
  if (hostname.includes('dataportal')) return 'DATAPORTAL';
  return inferSourceSystemFromId(url);
}

function inferSourceTypeFromUrl(url: string): string {
  const normalized = normalizeSearchToken(url);
  if (normalized.includes('wfs')) return 'WFS_CAPABILITIES';
  if (normalized.includes('wms')) return 'WMS_CAPABILITIES';
  if (normalized.includes('pdf')) return 'PDF_DOCUMENT';
  if (normalized.includes('rss') || normalized.includes('feed')) return 'RSS_FEED';
  if (normalized.includes('dataportal')) return 'DATASET_PORTAL';
  return 'REFERENCE_PAGE';
}

function extractCaseNumber(value: string): string | undefined {
  const match = String(value || '').match(
    /(?:mål:\s*)?([A-ZÅÄÖ]{1,3}\s?\d+(?:-\d+)?(?:,\s*[A-ZÅÄÖ]{1,3}\s?\d+(?:-\d+)?)*)/i,
  );
  return normalizeExternalText(match?.[1]);
}

function inferYear(
  publishedAt?: Date,
  decisionDate?: Date,
  sourceUrl?: string,
  title?: string,
  sourcePath?: string,
): number | undefined {
  const preferred = publishedAt || decisionDate;
  if (preferred) {
    return preferred.getUTCFullYear();
  }

  const candidates = [sourceUrl, title, sourcePath].filter(Boolean) as string[];
  for (const candidate of candidates) {
    const match = candidate.match(/(20\d{2}|19\d{2})/);
    if (match) {
      return Number(match[1]);
    }
  }

  return undefined;
}

function parseDateValue(value: unknown): Date | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function sanitizeDatabaseIdentifier(input: string): string {
  const normalized = normalizeSearchToken(input)
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return normalized || 'dataset';
}

function fileStem(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, '');
}

function toKey(prefix: string, value: string): string {
  return `${normalizeSearchToken(prefix)}:${normalizeSearchToken(value)}`;
}

function humanizeIdentifier(value: string): string {
  return normalizeExternalText(String(value || '').replace(/[_-]+/g, ' ')) || value;
}

function stringOrUndefined(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return normalizeExternalText(value);
  }
  return undefined;
}

function firstNonEmpty(values?: string[]): string | undefined {
  return values?.map((value) => normalizeExternalText(value)).find(Boolean);
}

function absoluteFileUrl(relativePath: string): string {
  return `file://${relativePath.replace(/\\/g, '/')}`;
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => normalizeExternalText(value)).filter(Boolean))) as string[];
}

async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8')) as T;
  } catch (error: any) {
    if (error?.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function toSerializableValue(value: unknown): unknown {
  if (value == null) {
    return value;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (Array.isArray(value)) {
    return value.map((item) => toSerializableValue(item));
  }
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, nested]) => [
        key,
        toSerializableValue(nested),
      ]),
    );
  }
  return value;
}
