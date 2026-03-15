/**
 * demoSearchService.ts
 * Lightweight wrapper around runSearchQuery for the demo endpoints.
 * Adds municipality-normalized filtering and metadata evidence from the backfill.
 */
import { runSearchQuery, type SearchResultRow } from './searchService';
import { prisma } from '../db/prisma';

export interface DemoSearchResult {
    documentId: string;
    title: string;
    municipality: string | null;
    municipalityNormalized: string | null;
    decisionType: string | null;
    wasteType: string | null;
    legalStatus: string | null;
    snippet: string;
    score: number;
    confidence: string; // AUTO | NEEDS_REVIEW | VERIFIED | LOCKED
    citations: Array<{ citationId: string; quote: string; confidence: number }>;
}

export interface DemoSearchResponse {
    query: string;
    mode: string;
    elapsedMs: number;
    totalCandidates: number;
    results: DemoSearchResult[];
    semanticEngine: string;
    watermark: string;
}

export async function demoSearch(input: {
    projectId: string;
    userId: string;
    query: string;
    mode?: 'semantic' | 'lexical' | 'hybrid';
    topK?: number;
    municipality?: string;
    decisionType?: string;
    wasteType?: string;
}): Promise<DemoSearchResponse> {
    const raw = await runSearchQuery({
        projectId: input.projectId,
        userId: input.userId,
        query: input.query,
        mode: input.mode || 'hybrid',
        topK: input.topK || 10,
        strictEvidence: false,
        filters: {
            municipality: input.municipality,
            decisionType: input.decisionType,
            wasteType: input.wasteType,
        },
    });

    // Enrich with backfill metadata (municipalityNormalized, confidence status)
    const docIds = raw.results.map((r) => r.documentId);
    const metaRows = docIds.length > 0
        ? await prisma.documentRecord.findMany({
            where: { id: { in: docIds } },
            select: {
                id: true,
                municipalityNormalized: true,
                municipalityConfidence: true,
                metadataReviewStatus: true,
                decisionType: true,
                wasteType: true,
                legalStatus: true,
                subject: true,
                originalName: true,
            },
        })
        : [];

    const metaByDocId = new Map(metaRows.map((r) => [r.id, r]));

    const results: DemoSearchResult[] = raw.results.map((r: SearchResultRow) => {
        const meta = metaByDocId.get(r.documentId);
        const title = meta?.subject || r.metadata.subject || meta?.originalName || r.metadata.originalName || r.documentId;
        return {
            documentId: r.documentId,
            title,
            municipality: meta?.municipalityNormalized || r.metadata.municipality,
            municipalityNormalized: meta?.municipalityNormalized || null,
            decisionType: meta?.decisionType || r.metadata.decisionType,
            wasteType: meta?.wasteType || r.metadata.wasteType,
            legalStatus: meta?.legalStatus || r.metadata.legalStatus,
            snippet: r.snippet || r.citations[0]?.quote || '',
            score: r.score,
            confidence: meta?.metadataReviewStatus || 'AUTO',
            citations: r.citations.map((c) => ({
                citationId: c.citationId,
                quote: c.quote,
                confidence: c.confidence,
            })),
        };
    });

    return {
        query: input.query,
        mode: raw.mode,
        elapsedMs: raw.elapsedMs,
        totalCandidates: raw.totalCandidates,
        results,
        semanticEngine: raw.guardrails.semanticEngine,
        watermark: raw.guardrails.draftWatermark,
    };
}

/**
 * Pull top RAG hits for a given query and project – used by classification and permit/generate
 * to attach source citations from the actual document database.
 */
export async function getRagCitations(input: {
    projectId: string;
    userId: string;
    query: string;
    topK?: number;
}): Promise<Array<{ source: string; snippet: string; municipality: string | null; documentId: string }>> {
    const result = await demoSearch({ ...input, mode: 'hybrid', topK: input.topK || 5 });
    return result.results.map((r) => ({
        source: `DocumentRecord:${r.documentId}`,
        snippet: r.snippet.slice(0, 300),
        municipality: r.municipalityNormalized,
        documentId: r.documentId,
    }));
}
