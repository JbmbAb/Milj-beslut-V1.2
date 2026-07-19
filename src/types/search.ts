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

export interface SearchResultItem {
  documentId: string;
  score: number;
  snippet: string;
  whyMatched: string;
  citations?: Array<{
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
  };
}

export interface SearchQueryRequest {
  projectId?: string;
  query: string;
  mode: SearchMode;
  topK?: number;
  strictEvidence?: boolean;
  filters?: SearchFilters;
}

export interface SearchQueryResponse {
  mode: SearchMode;
  scope: 'project' | 'global';
  elapsedMs: number;
  totalCandidates: number;
  guardrails?: {
    strictEvidence: boolean;
    evidenceFilteredOut: number;
    citationCoveragePct: number;
    semanticEngine?: 'pgvector' | 'json-fallback' | 'disabled';
    draftWatermark: string;
  };
  results: SearchResultItem[];
}

export interface SearchStatusBucket {
  status: string;
  count: number;
}

export interface SearchStatusResponse {
  documents: SearchStatusBucket[];
  jobs: SearchStatusBucket[];
  summary?: {
    documentsTotal: number;
    metadataOnlyDocuments: number;
    textExtractedDocuments: number;
    embeddedDocuments: number;
    failedDocuments: number;
    jobsPending: number;
    jobsRunning: number;
    jobsDone: number;
    jobsFailed: number;
    staleRunningJobs: number;
    totalChunks: number;
    embeddedChunks: number;
    chunkEmbeddingCoveragePct: number;
  };
}

