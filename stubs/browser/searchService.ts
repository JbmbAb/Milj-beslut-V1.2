/**
 * Browser-build stub: ersätter `server/services/searchService` i Vite så att
 * backend-beroenden (fs, crypto, pg, vertex-ai etc.) inte bundlas till klienten.
 * Verkliga sök- och indexeringsanrop körs enbart under Node/Express.
 */

export type SearchMode = 'semantic' | 'lexical' | 'hybrid';

export interface SearchFilters {
  municipality?: string;
  decisionType?: string;
  wasteType?: string;
  status?: string;
  legalStatus?: string;
  hazardousFlag?: boolean;
  dateFrom?: string;
  dateTo?: string;
}

export interface SearchResultRow {
  documentId: string;
  score: number;
  snippet: string;
  whyMatched: string;
  citations: Array<{
    citationId: string;
    chunkIndex: number | null;
    quote: string;
    sourceLabel: string;
    confidence: number;
  }>;
  metadata: {
    projectId: string | null;
    projectName: string | null;
    organisationName: string | null;
    subject: string;
    originalName: string;
    receivedTime: string | null;
    municipality: string | null;
    decisionType: string | null;
    wasteType: string | null;
    hazardousFlag: boolean | null;
    legalStatus: string | null;
    status: string;
    geoRisk?: any | null;
  };
}

export interface SearchQueryResult {
  mode: SearchMode;
  scope: 'project' | 'global';
  elapsedMs: number;
  totalCandidates: number;
  guardrails: {
    strictEvidence: boolean;
    evidenceFilteredOut: number;
    citationCoveragePct: number;
    semanticEngine?: 'pgvector' | 'json-fallback' | 'disabled';
    draftWatermark: string;
  };
  results: SearchResultRow[];
}

export interface ManifestSyncResult {
  manifestPath: string;
  totalRows: number;
  inserted: number;
  updated: number;
  ignored: number;
  elapsedMs: number;
}

function clientBundleError(): never {
  throw new Error(
    'SearchService-funktioner får endast anropas från serverprocessen, inte från Vite-klientbundlen.',
  );
}

export function getSearchConfig(): any {
  return clientBundleError();
}

export async function runGeminiOcr(): Promise<any> {
  return clientBundleError();
}

export async function loadPdfText(): Promise<any> {
  return clientBundleError();
}

export function encryptContent(): any {
  return clientBundleError();
}

export function cosineSimilarity(): any {
  return clientBundleError();
}

export async function embedText(): Promise<any> {
  return clientBundleError();
}

export async function syncManifestMetadata(): Promise<any> {
  return clientBundleError();
}

export async function extractDocumentTextAndChunk(): Promise<any> {
  return clientBundleError();
}

export async function embedDocumentChunks(): Promise<any> {
  return clientBundleError();
}

export async function runSearchQuery(): Promise<any> {
  return clientBundleError();
}

export interface SearchChunkResult {
  id: string;
  chunkText: string;
  documentId: string;
  documentTitle: string;
  ftsRank?: number;
  vectorDistance?: number;
  rrfScore?: number;
  finalScore?: number;
  category?: string;
  documentReference?: string;
}

export class AlphaevolveSearchService {
  constructor(_prisma?: unknown) {}

  on(): this {
    return this;
  }

  async search(): Promise<SearchChunkResult[]> {
    return clientBundleError();
  }
}
