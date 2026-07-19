import { randomUUID } from 'node:crypto';
import { upsertJudgment } from '../repositories/judgmentRepository';
import { upsertLegalSourceWithMatrix } from '../repositories/legalSourceRepository';
import { buildJudgmentLegalSourceSeed } from './legalSourceIngestService';
import { normalizeExternalText } from '../utils/textEncoding';
import { prisma } from '../db/prisma';
import { XMLParser } from 'fast-xml-parser';

const RSS_FEED_URL = 'https://www.domstol.se/feed/15972/?scope=decision&searchPageId=15972';

async function triggerRagIngest(input: {
  id: string;
  title: string;
  content: string;
  sourceType: 'JUDGMENT';
  metadata: Record<string, string>;
}): Promise<void> {
  const ragModule = await import('./ragSearchService');
  const ingestDocumentForRag = (ragModule as { ingestDocumentForRag?: (arg: typeof input) => Promise<void> })
    .ingestDocumentForRag;

  if (typeof ingestDocumentForRag !== 'function') {
    console.warn('domstolRssService: ingestDocumentForRag saknas i ragSearchService, hoppar over RAG-ingest.');
    return;
  }

  await ingestDocumentForRag(input);
}

interface RssItem {
  guid: { '#text': string; '@_isPermaLink': string };
  link: string;
  title: string;
  description: string;
  pubDate: string; // "Mon, 10 Mar 2025 00:00:00 +0100"
  'a10:updated': string; // "2025-03-10T12:34:09+01:00"
}

async function logPipelineRun(params: {
  runId: string;
  status: 'RUNNING' | 'SUCCESS' | 'FAILED';
  newCount?: number;
  updatedCount?: number;
  errorCount?: number;
  errorMessage?: string;
  finish?: boolean;
}): Promise<void> {
  try {
    if (params.status === 'RUNNING') {
      await prisma.pipelineRun.create({
        data: {
          runId: params.runId,
          runType: 'domstol-rss-ingest',
          stageName: 'ingest',
          status: params.status,
        },
      });
    } else {
      await prisma.pipelineRun.update({
        where: { runId: params.runId },
        data: {
          status: params.status,
          finishedAt: params.finish ? new Date() : undefined,
          processedCount: (params.newCount ?? 0) + (params.updatedCount ?? 0),
          errorCount: params.errorCount ?? 0,
          notes: params.errorMessage ?? null,
          configSnapshot: {
            new: params.newCount ?? 0,
            updated: params.updatedCount ?? 0,
            feedUrl: RSS_FEED_URL,
          },
        },
      });
    }
  } catch (err) {
    // PipelineRun-loggning får inte blockera huvudflödet.
    console.warn('domstolRssService: kunde inte logga pipeline-körning', err);
  }
}

export async function ingestDomstolRssFeed(): Promise<{ newJudgments: number; updatedJudgments: number }> {
  const runId = `domstol-rss-${Date.now()}-${randomUUID().slice(0, 8)}`;
  await logPipelineRun({ runId, status: 'RUNNING' });

  try {
    console.log(`Fetching RSS feed from: ${RSS_FEED_URL}`);
    const response = await fetch(RSS_FEED_URL);
    if (!response.ok) {
      throw new Error(`Failed to fetch RSS feed: ${response.statusText}`);
    }
    const xmlText = await response.text();

    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      textNodeName: '#text',
      ignoreDeclaration: true,
      parseTagValue: false,
      trimValues: true,
    });
    const jsonObj = parser.parse(xmlText);

    const rawItems = jsonObj.rss.channel.item;
    const items: RssItem[] = Array.isArray(rawItems)
      ? rawItems
      : rawItems != null
        ? [rawItems]
        : [];

    if (items.length === 0) {
      console.warn('RSS feed did not contain any items.');
      await logPipelineRun({ runId, status: 'SUCCESS', finish: true });
      return { newJudgments: 0, updatedJudgments: 0 };
    }

    let newJudgments = 0;
    let updatedJudgments = 0;
    let errorCount = 0;

    for (const item of items) {
      try {
        const guid = item.guid['#text'];
        const title = normalizeExternalText(item.title) || item.title;
        const link = item.link;
        const description = normalizeExternalText(item.description) || item.description;
        const pubDate = new Date(item.pubDate);

        // ... (in the loop)
        const result = await upsertJudgment({
          guid,
          title,
          link,
          description,
          pubDate,
        });

        // Trigger asynkron RAG-vektorisering
        triggerRagIngest({
          id: result.id,
          title,
          content: description,
          sourceType: 'JUDGMENT',
          metadata: { link, guid, source: 'DOMSTOL_RSS' }
        }).catch(err => console.error('RAG ingest failed', err));
        await upsertLegalSourceWithMatrix(
          buildJudgmentLegalSourceSeed({
            guid,
            title,
            link,
            description,
            pubDate,
            sourceFeed: RSS_FEED_URL,
          }),
          result.id,
        );

        if (result.createdAt.getTime() === result.updatedAt.getTime()) {
          newJudgments++;
        } else {
          updatedJudgments++;
        }
      } catch (error) {
        errorCount++;
        console.error(`Error processing RSS item ${item.guid['#text']}:`, error);
      }
    }

    await logPipelineRun({
      runId,
      status: 'SUCCESS',
      newCount: newJudgments,
      updatedCount: updatedJudgments,
      errorCount,
      finish: true,
    });
    return { newJudgments, updatedJudgments };
  } catch (error) {
    await logPipelineRun({
      runId,
      status: 'FAILED',
      errorMessage: error instanceof Error ? error.message : String(error),
      errorCount: 1,
      finish: true,
    });
    throw error;
  }
}
