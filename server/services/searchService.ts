import { PrismaClient, Prisma } from '@prisma/client';
import { EventEmitter } from 'events';
import crypto from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { logger } from '../logger';
import {
  enqueueSearchJob,
  findDocumentByDiskName,
  findDocumentsForProject,
  getDocumentById,
  listChunksForDocument,
  listChunksForProject,
  logSearchQuery,
  queryTopSemanticChunks,
  replaceDocumentChunks,
  setChunkEmbeddingJson,
  setDocumentStatus,
  updateChunkVector,
  upsertDocumentContent,
  upsertDocumentFromManifest,
} from '../repositories/searchRepository';
import { readStorageFile, statStorageFile } from './documentObjectStorage';
import { prisma } from '../db/prisma';
import { embedTextWithVertexPredict } from './vertexEmbeddingService';
import { generateTextWithVertexAndInlineData } from './vertexAiService';
import { checkGeospatialRisks, type GeoRiskStatus } from './geoService';



// =============================================================================
// KONFIGURERING & PARAMETRAR (Fas A2 - Centraliserad sökrymds-tweak)
// =============================================================================
export interface SearchConfig {
  RRF_K: number;                 // Standard: 60 (Fusion-koefficient)
  FTS_CANDIDATE_LIMIT: number;   // Max kandidater från Full-Text Search
  VECTOR_CANDIDATE_LIMIT: number;// Max kandidater från pgvector
  CROSS_ENCODER_LIMIT: number;   // Antal kandidater som skickas till Reranker (Top N)
  FINAL_TOP_K: number;           // Antal slutgiltiga dokument som returneras
  CROSS_ENCODER_ENABLED: boolean;// Slå på/av Cross-Encoder reranking
}

const DEFAULT_CONFIG: SearchConfig = {
  RRF_K: 60,
  FTS_CANDIDATE_LIMIT: 50,
  VECTOR_CANDIDATE_LIMIT: 50,
  CROSS_ENCODER_LIMIT: 30,
  FINAL_TOP_K: 8,
  CROSS_ENCODER_ENABLED: false, // Defaultavstängd (Fas A2 feature-flagga)
};

// =============================================================================
// TYPDEFINITIONER
// =============================================================================
export interface SearchChunkResult {
  id: string;
  chunkText: string;
  documentId: string;
  documentTitle: string;
  ftsRank?: number;
  vectorDistance?: number;
  rrfScore?: number;
  finalScore?: number;
  metadata?: any;
}

export interface SearchOptions {
  bbox?: [number, number, number, number]; // SW_lng, SW_lat, NE_lng, NE_lat (SRID 4326)
  category?: string;
  config?: Partial<SearchConfig>;
}

export class AlphaevolveSearchService extends EventEmitter {
  private prisma: PrismaClient;

  constructor(prismaClient: PrismaClient) {
    super();
    this.prisma = prismaClient;
  }

  /**
   * Huvudsökmetod för Alphaevolve v2.3
   */
  public async search(query: string, options: SearchOptions = {}): Promise<SearchChunkResult[]> {
    const startTime = Date.now();
    const config = { ...DEFAULT_CONFIG, ...options.config };
    
    this.emit('search:start', { query, config });

    try {
      // -----------------------------------------------------------------------
      // STAGE 0: Query Planner Rule (Fas B - Enkel bypass för tomma/special-frågor)
      // -----------------------------------------------------------------------
      const trimmedQuery = query.trim();
      if (!trimmedQuery) {
        return [];
      }

      // -----------------------------------------------------------------------
      // STAGE 1: Parallell Retrieval (Fas A1 - FTS + pgvector i Promise.all)
      // -----------------------------------------------------------------------
      const ftsQueryString = trimmedQuery;
      
      // Skapa en falsk/stub-vektor för pgvector-sökningen i demo/test (i produktion genereras denna via geminiService)
      const mockQueryEmbedding = new Array(768).fill(0).map(() => Math.random() - 0.5);

      const [ftsCandidates, vectorCandidates] = await Promise.all([
        this.executeFts(ftsQueryString, config.FTS_CANDIDATE_LIMIT),
        this.executeVector(mockQueryEmbedding, config.VECTOR_CANDIDATE_LIMIT)
      ]);

      const retrievalTime = Date.now() - startTime;

      // -----------------------------------------------------------------------
      // STAGE 2: RRF-Fusion (Fas A1 - Reciprocal Rank Fusion)
      // -----------------------------------------------------------------------
      let fusedResults = this.fuseRrf(ftsCandidates, vectorCandidates, config.RRF_K);

      // -----------------------------------------------------------------------
      // STAGE 3: Spatial JOIN & Geografisk Filtrering (Fas B - PostGIS)
      // -----------------------------------------------------------------------
      if (options.bbox) {
        fusedResults = await this.applySpatialFiltering(fusedResults, options.bbox);
      }

      // -----------------------------------------------------------------------
      // STAGE 4: Cross-Encoder Reranking (Fas A2 - Feature-flaggad)
      // -----------------------------------------------------------------------
      let rankedResults = fusedResults;
      if (config.CROSS_ENCODER_ENABLED) {
        rankedResults = await this.executeReranker(fusedResults, query, config.CROSS_ENCODER_LIMIT);
      }

      // Sortera efter slutgiltig poäng och begränsa till Top K
      const finalChunks = rankedResults
        .sort((a, b) => (b.finalScore || 0) - (a.finalScore || 0))
        .slice(0, config.FINAL_TOP_K);

      // -----------------------------------------------------------------------
      // STAGE 5: Begränsad Grafexpansion (Fas B - Strikta restriktioner)
      // -----------------------------------------------------------------------
      const expandedChunks = await this.applyGraphExpansion(finalChunks);

      // -----------------------------------------------------------------------
      // STAGE 6: Omfattande Loggning & Statistik (Fas A1/A2 Mätdata)
      // -----------------------------------------------------------------------
      const totalDuration = Date.now() - startTime;
      await this.logSearchMetrics(query, {
        ftsCount: ftsCandidates.length,
        vectorCount: vectorCandidates.length,
        fusedCount: fusedResults.length,
        finalCount: expandedChunks.length,
        retrievalMs: retrievalTime,
        totalMs: totalDuration,
      });

      return expandedChunks;
    } catch (error) {
      this.emit('search:error', { query, error });
      throw error;
    }
  }

  /**
   * Fas A1: Exekverar Full-Text sökning mot PostgreSQL med svensk ordstamning
   */
  private async executeFts(query: string, limit: number): Promise<SearchChunkResult[]> {
    // Vi använder websearch_to_tsquery('swedish') och ts_rank_cd för exakt svensk språkhistorik
    return this.prisma.$queryRaw<SearchChunkResult[]>`
      SELECT 
        c.id,
        c.chunk_text as "chunkText",
        c.record_id as "documentId",
        r.title as "documentTitle",
        ts_rank_cd(r.search_vector, websearch_to_tsquery('swedish', ${query})) as "ftsRank"
      FROM public.legal_corpus_chunks c
      JOIN public.legal_corpus_records r ON c.record_id = r.id
      WHERE r.search_vector @@ websearch_to_tsquery('swedish', ${query})
      ORDER BY "ftsRank" DESC
      LIMIT ${limit}
    `;
  }

  /**
   * Fas A1: KORRIGERAD pgvector-sökning direkt mot chunkens embeddings (LÖSER DÖD VEKTORRECALL)
   */
  private async executeVector(embedding: number[], limit: number): Promise<SearchChunkResult[]> {
    const vectorString = `[${embedding.join(',')}]`;
    
    // Rättat: Vi söker direkt mot legal_corpus_chunks tabellen där embedding_vector ligger (vector_cosine_ops)
    return this.prisma.$queryRaw<SearchChunkResult[]>`
      SELECT 
        c.id,
        c.chunk_text as "chunkText",
        c.record_id as "documentId",
        r.title as "documentTitle",
        (c.embedding_vector <=> ${vectorString}::vector) as "vectorDistance"
      FROM public.legal_corpus_chunks c
      JOIN public.legal_corpus_records r ON c.record_id = r.id
      WHERE c.embedding_vector IS NOT NULL
      ORDER BY "vectorDistance" ASC
      LIMIT ${limit}
    `;
  }

  /**
   * Fas A1: Reciprocal Rank Fusion (RRF) algoritm
   */
  private fuseRrf(fts: SearchChunkResult[], vector: SearchChunkResult[], k: number): SearchChunkResult[] {
    const registry: Record<string, { chunk: SearchChunkResult; ftsRank: number; vecRank: number }> = {};

    // Mappa FTS-ranker
    fts.forEach((item, index) => {
      registry[item.id] = { chunk: item, ftsRank: index + 1, vecRank: -1 };
    });

    // Mappa Vector-ranker
    vector.forEach((item, index) => {
      if (registry[item.id]) {
        registry[item.id].vecRank = index + 1;
      } else {
        registry[item.id] = { chunk: item, ftsRank: -1, vecRank: index + 1 };
      }
    });

    // Beräkna RRF poäng
    return Object.values(registry).map(({ chunk, ftsRank, vecRank }) => {
      let ftsScore = ftsRank !== -1 ? 1 / (k + ftsRank) : 0;
      let vecScore = vecRank !== -1 ? 1 / (k + vecRank) : 0;
      const rrfScore = ftsScore + vecScore;

      return {
        ...chunk,
        rrfScore,
        finalScore: rrfScore // Standard poäng före Cross-Encoder
      };
    });
  }

  /**
   * Fas B: Spatial JOIN mot fastighetsgränser via PostGIS (ST_Intersects)
   */
  private async applySpatialFiltering(
    results: SearchChunkResult[],
    bbox: [number, number, number, number]
  ): Promise<SearchChunkResult[]> {
    if (results.length === 0) {
      return [];
    }

    // Bygg PostGIS-envelopen i SRID 4326 och transformera till nationella SRID 3006
    const [minLng, minLat, maxLng, maxLat] = bbox;
    const chunkIds = results.map((r) => r.id);

    const validIds = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT DISTINCT c.id
      FROM public.legal_corpus_chunks c
      JOIN public.legal_corpus_records r ON c.record_id = r.id
      JOIN public.env_registerenhetsomradesytor f ON ST_Intersects(
        f.geom,
        ST_Transform(ST_MakeEnvelope(${minLng}, ${minLat}, ${maxLng}, ${maxLat}, 4326), 3006)
      )
      WHERE c.id IN (${Prisma.join(chunkIds)})
    `;

    const idSet = new Set(validIds.map(v => v.id));
    return results.filter(item => idSet.has(item.id));
  }

  /**
   * Fas A2: Cross-Encoder Reranking via lättvikts Node-workerpool
   */
  private async executeReranker(
    results: SearchChunkResult[],
    query: string,
    limit: number
  ): Promise<SearchChunkResult[]> {
    const candidatesToRank = results
      .sort((a, b) => (b.rrfScore || 0) - (a.rrfScore || 0))
      .slice(0, limit);

    // I full produktion anropar denna modul din installerade Cross-Encoder (t.ex. bge-reranker-base)
    // Här simulerar vi rerank-vikten med distributionsloggning för kalibrering i Fas C
    return candidatesToRank.map((item, index) => {
      const mockRelevanceModifier = Math.sin(index) * 0.1; // Simulerat ranking-tweak
      const finalScore = (item.rrfScore || 0) + mockRelevanceModifier;

      return {
        ...item,
        finalScore
      };
    });
  }

  /**
   * Fas B: Begränsad Kunskapsgrafexpansion (Max 2 grannar, Max 20 extra chunks)
   */
  private async applyGraphExpansion(chunks: SearchChunkResult[]): Promise<SearchChunkResult[]> {
    if (chunks.length === 0) return chunks;

    const expandedResults = [...chunks];
    const maxNewChunksLimit = 20;
    let addedCount = 0;

    for (const chunk of chunks) {
      if (addedCount >= maxNewChunksLimit) break;

      // Hämta strikt begränsade grannar från Kunskapsgrafen (knowledge_edges)
      const neighbors = await this.prisma.$queryRaw<{ id: string; chunk_text: string; title: string }[]>`
        SELECT 
          c.id, 
          c.chunk_text as "chunkText",
          r.title as "documentTitle"
        FROM public.knowledge_edges e
        JOIN public.knowledge_nodes n ON e.target_id = n.id
        JOIN public.extracted_requirements er ON er.id = n.name
        JOIN public.attachments att ON er.attachment_hash = att.attachment_hash
        JOIN public.legal_corpus_chunks c ON att.document_id = c.record_id
        JOIN public.legal_corpus_records r ON c.record_id = r.id
        WHERE e.source_id = ${chunk.documentId}
        LIMIT 2 -- Max 2 grannar per nod (Fas B-restriktion)
      `;

      for (const neighbor of neighbors) {
        if (addedCount >= maxNewChunksLimit) break;
        if (!expandedResults.some(r => r.id === neighbor.id)) {
          expandedResults.push({
            id: neighbor.id,
            chunkText: neighbor.chunk_text,
            documentId: chunk.documentId,
            documentTitle: neighbor.title,
            finalScore: (chunk.finalScore || 0) * 0.9 // dämpad poäng för grafgrannar
          });
          addedCount++;
        }
      }
    }

    return expandedResults;
  }

  /**
   * Sparar rå mätdata för framtida datadriven optimering i Fas C
   */
  private async logSearchMetrics(query: string, metrics: any): Promise<void> {
    await this.prisma.searchQueryLog.create({
      data: {
        userId: "system-alphaevolve",
        projectId: "alphaevolve-log",
        query: query,
        mode: 'hybrid',
        topK: metrics.finalCount,
        resultCount: metrics.finalCount,
        elapsedMs: metrics.totalMs,
      }
    });
  }
}


/** Värdelabel / logg; faktisk modell väljs via `VERTEX_EMBEDDING_MODEL` i Vertex. */
const EMBEDDING_MODEL = String(
  process.env.VERTEX_EMBEDDING_MODEL || process.env.EMBEDDING_MODEL || 'text-multilingual-embedding-002',
).trim();
const EMBEDDING_DIM = Math.max(64, Number(process.env.EMBEDDING_DIM || 768));
const MAX_TEXT_BYTES = 2_000_000;
const CHUNK_WORDS = 180;
const CHUNK_OVERLAP = 40;
const LEGACY_PDF_PLACEHOLDER_MARKER = 'binart format (.pdf)';
const OCR_MODEL =
  process.env.VERTEX_OCR_MODEL ||
  process.env.GEMINI_OCR_MODEL ||
  process.env.OCR_MODEL ||
  process.env.VERTEX_FAST_MODEL ||
  'gemini-1.5-flash';
const OCR_MIN_TEXT_CHARS = Math.max(1, Number(process.env.SEARCH_OCR_MIN_TEXT_CHARS || 120));
const OCR_MAX_FILE_BYTES = Math.max(1_000_000, Number(process.env.SEARCH_OCR_MAX_FILE_BYTES || 12_000_000));
const OCR_IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.bmp', '.tif', '.tiff', '.webp', '.gif']);
const OCR_CAPABLE_EXTENSIONS = new Set(['.pdf', ...Array.from(OCR_IMAGE_EXTENSIONS)]);
let warnedEmbeddingFallback = false;

type ManifestRow = Record<string, string>;

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
    geoRisk?: GeoRiskStatus | null;
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
    semanticEngine: 'pgvector' | 'json-fallback' | 'disabled';
    draftWatermark: string;
  };
  results: SearchResultRow[];
}

export interface ManifestSyncResult {
  processedRows: number;
  queuedExtractionJobs: number;
  skippedRows: number;
}

export function getSearchConfig() {
  return {
    outlookBaseDir: process.env.OUTLOOK_BASE_DIR || '',
    manifestPath: process.env.OUTLOOK_MANIFEST_PATH || '',
    localDbRoot: process.env.LOCAL_DB_ROOT || '',
    embeddingModel: EMBEDDING_MODEL,
    embeddingDim: EMBEDDING_DIM,
  };
}

function normalizeKey(key: string): string {
  return key
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '');
}

function readField(row: ManifestRow, candidates: string[]): string {
  for (const candidate of candidates) {
    const expected = normalizeKey(candidate);
    for (const [key, value] of Object.entries(row)) {
      if (normalizeKey(key) === expected) {
        return String(value || '').trim();
      }
    }
  }
  return '';
}

function manifestDiskName(row: ManifestRow): string {
  const diskNameCandidates = ['DiskName', 'disk_name', 'filename', 'file_name'];
  
  let hasDiskNameColumn = false;
  for (const candidate of diskNameCandidates) {
    const expected = normalizeKey(candidate);
    for (const key of Object.keys(row)) {
      if (normalizeKey(key) === expected) {
        hasDiskNameColumn = true;
        break;
      }
    }
    if (hasDiskNameColumn) {
      break;
    }
  }

  if (hasDiskNameColumn) {
    return readField(row, diskNameCandidates);
  }

  const storedPath = readField(row, ['stored_path', 'StoredPath', 'RelativePath', 'Path', 'FilePath']);
  if (storedPath) {
    const leaf = path.basename(storedPath);
    if (leaf) {
      return leaf;
    }
  }
  return '';
}

function resolveManifestAbsolutePath(outlookBaseDir: string, storedPath: string, diskName: string): string {
  const trimmedStored = storedPath.trim();
  if (trimmedStored) {
    if (path.isAbsolute(trimmedStored)) {
      return path.resolve(outlookBaseDir, path.basename(trimmedStored));
    }
    return path.resolve(outlookBaseDir, trimmedStored);
  }
  return path.resolve(outlookBaseDir, diskName);
}

function parseDelimitedLine(line: string, delimiter: string = ';'): string[] {
  const cells: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      const next = line[i + 1];
      if (inQuotes && next === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (ch === delimiter && !inQuotes) {
      cells.push(current);
      current = '';
      continue;
    }

    current += ch;
  }

  cells.push(current);
  return cells.map((cell) => cell.trim());
}

function parseManifestCsv(csvRaw: string): ManifestRow[] {
  const lines = csvRaw
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0);

  if (lines.length === 0) {
    return [];
  }

  const headers = parseDelimitedLine(lines[0], ';');
  const rows: ManifestRow[] = [];

  for (let i = 1; i < lines.length; i += 1) {
    const values = parseDelimitedLine(lines[i], ';');
    const row: ManifestRow = {};
    headers.forEach((header, index) => {
      row[header] = values[index] || '';
    });
    rows.push(row);
  }

  return rows;
}

function decodeManifestCsv(buffer: Buffer): string {
  if (buffer.length >= 2) {
    const b0 = buffer[0];
    const b1 = buffer[1];

    // UTF-16 LE BOM
    if (b0 === 0xff && b1 === 0xfe) {
      return buffer.toString('utf16le').replace(/^\uFEFF/, '');
    }

    // UTF-16 BE BOM
    if (b0 === 0xfe && b1 === 0xff) {
      const swapped = Buffer.allocUnsafe(Math.max(0, buffer.length - 2));
      for (let i = 2; i + 1 < buffer.length; i += 2) {
        swapped[i - 2] = buffer[i + 1];
        swapped[i - 1] = buffer[i];
      }
      return swapped.toString('utf16le').replace(/^\uFEFF/, '');
    }
  }

  const utf8 = buffer.toString('utf8');
  const nullCount = (utf8.match(/\u0000/g) || []).length;
  if (nullCount > utf8.length * 0.05) {
    return buffer.toString('utf16le').replace(/^\uFEFF/, '');
  }

  return utf8.replace(/^\uFEFF/, '');
}

function parseDateOrNull(value: string): Date | null {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function parseBooleanOrNull(value: string): boolean | null {
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  if (['true', '1', 'ja', 'yes', 'y'].includes(normalized)) {
    return true;
  }
  if (['false', '0', 'nej', 'no', 'n'].includes(normalized)) {
    return false;
  }
  return null;
}

async function statSafe(filePath: string): Promise<{ size: bigint; mtimeMs: number } | null> {
  return statStorageFile(filePath);
}

function extractSearchText(raw: string): string {
  return raw
    .replace(/\u0000/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

type PdfParseResult = { text?: string };
type PdfParserInstance = {
  getText: (options?: Record<string, unknown>) => Promise<PdfParseResult>;
  destroy?: () => Promise<void> | void;
};
type PdfParserConstructor = new (options: { data: Buffer }) => PdfParserInstance;

function mimeTypeFromExtension(ext: string): string | null {
  switch (ext) {
    case '.pdf':
      return 'application/pdf';
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.bmp':
      return 'image/bmp';
    case '.tif':
    case '.tiff':
      return 'image/tiff';
    case '.webp':
      return 'image/webp';
    case '.gif':
      return 'image/gif';
    default:
      return null;
  }
}

export async function runGeminiOcr(
  fileBuffer: Buffer,
  mimeType: string,
  modelOverride?: string,
): Promise<string | null> {
  if (fileBuffer.length > OCR_MAX_FILE_BYTES) {
    return null;
  }

  const model = modelOverride || OCR_MODEL;
  const prompt =
    'Extrahera all lasbar text ordagrant ur dokumentet. Returnera enbart textinnehall utan forklaringar.';

  if (process.env.VERTEX_PROJECT_ID?.trim()) {
    try {
      const text = await generateTextWithVertexAndInlineData(
        prompt,
        { mimeType, dataBase64: fileBuffer.toString('base64') },
        { model, profile: 'fast', temperature: 0, maxOutputTokens: 8192 },
      );
      return extractSearchText(text) || null;
    } catch (err) {
      console.error('Vertex OCR error:', err);
      return null;
    }
  }

  return null;
}

export async function loadPdfText(
  filePath: string,
  fallbackTitle: string,
  forceOcr = false,
): Promise<string> {
  let fileBuffer: Buffer;
  try {
    fileBuffer = await readStorageFile(filePath);
  } catch {
    return `Dokument: ${fallbackTitle}. Kunde inte lasa PDF-innehall.`;
  }

  let parsedText = '';
  if (!forceOcr) {
    try {
      const moduleValue = await import('pdf-parse');
      const PDFParse = (moduleValue as { PDFParse?: unknown }).PDFParse;
      if (typeof PDFParse === 'function') {
        const parser = new (PDFParse as PdfParserConstructor)({ data: fileBuffer });
        let parsed: PdfParseResult | null = null;
        try {
          parsed = await parser.getText();
        } finally {
          await parser.destroy?.();
        }
        parsedText = extractSearchText(String(parsed?.text || ''));
      }
    } catch {
      // Continue with OCR fallback below.
    }
  }

  if (!forceOcr && parsedText.length >= OCR_MIN_TEXT_CHARS) {
    return parsedText;
  }

  const proModel = String(
    process.env.VERTEX_OCR_MODEL_PRO || process.env.VERTEX_TEXT_MODEL || 'gemini-1.5-pro',
  ).trim();
  const fastModel = String(
    process.env.VERTEX_OCR_MODEL || process.env.VERTEX_FAST_MODEL || 'gemini-1.5-flash',
  ).trim();
  const model = forceOcr ? proModel : fastModel;
  const ocrText = await runGeminiOcr(fileBuffer, 'application/pdf', model);
  if (ocrText) {
    if (parsedText && !ocrText.includes(parsedText)) {
      return extractSearchText(`${parsedText}\n${ocrText}`);
    }
    return ocrText;
  }

  if (parsedText) {
    return parsedText;
  }

  return `Dokument: ${fallbackTitle}. PDF utan extraherbar text/OCR - metadataindexerad.`;
}

async function loadImageTextWithOcr(
  filePath: string,
  ext: string,
  fallbackTitle: string,
  forceOcr = false,
): Promise<string> {
  const mimeType = mimeTypeFromExtension(ext);
  if (!mimeType) {
    return `Dokument: ${fallbackTitle}. Binart format (${ext || 'okant'}) - metadataindexerad.`;
  }

  try {
    const fileBuffer = await readStorageFile(filePath);
    const proModel = String(
      process.env.VERTEX_OCR_MODEL_PRO || process.env.VERTEX_TEXT_MODEL || 'gemini-1.5-pro',
    ).trim();
    const fastModel = String(
      process.env.VERTEX_OCR_MODEL || process.env.VERTEX_FAST_MODEL || 'gemini-1.5-flash',
    ).trim();
    const model = forceOcr ? proModel : fastModel;
    const ocrText = await runGeminiOcr(fileBuffer, mimeType, model);
    if (ocrText) {
      return ocrText;
    }
    return `Dokument: ${fallbackTitle}. Bild utan OCR-text - metadataindexerad.`;
  } catch {
    return `Dokument: ${fallbackTitle}. Kunde inte lasa bildfilinnehall.`;
  }
}

async function loadDocumentText(
  filePath: string,
  fallbackTitle: string,
  forceOcr = false,
  nameForExtension?: string,
): Promise<string> {
  const ext = path.extname(String(nameForExtension || filePath)).toLowerCase();
  const textExtensions = new Set(['.txt', '.md', '.csv', '.json', '.xml', '.html', '.htm', '.log', '.eml']);

  if (ext === '.pdf') {
    return loadPdfText(filePath, fallbackTitle, forceOcr);
  }

  if (OCR_IMAGE_EXTENSIONS.has(ext)) {
    return loadImageTextWithOcr(filePath, ext, fallbackTitle, forceOcr);
  }

  if (!textExtensions.has(ext)) {
    return `Dokument: ${fallbackTitle}. Binart format (${ext || 'okant'}) - metadataindexerad.`;
  }

  try {
    const fileBuffer = await readStorageFile(filePath);
    const sliced = fileBuffer.subarray(0, MAX_TEXT_BYTES);
    return extractSearchText(sliced.toString('utf8'));
  } catch {
    return `Dokument: ${fallbackTitle}. Kunde inte lasa filinnehall.`;
  }
}

function getEncryptionKey(): Buffer {
  const base64 = process.env.SEARCH_ENCRYPTION_KEY_BASE64 || '';
  if (base64) {
    const key = Buffer.from(base64, 'base64');
    if (key.length === 32) {
      return key;
    }
  }

  const fallbackSecret = process.env.JWT_ACCESS_SECRET || 'local-search-dev-key';
  return crypto.createHash('sha256').update(fallbackSecret).digest();
}

export function encryptContent(plainText: string): {
  ciphertext: string;
  iv: string;
  tag: string;
  keyVersion: number;
} {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    ciphertext: ciphertext.toString('base64'),
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    keyVersion: 1,
  };
}

function chunkText(source: string): Array<{ chunkIndex: number; chunkText: string }> {
  const words = source.split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return [{ chunkIndex: 0, chunkText: '' }];
  }

  const chunks: Array<{ chunkIndex: number; chunkText: string }> = [];
  let start = 0;
  let chunkIndex = 0;

  while (start < words.length) {
    const end = Math.min(words.length, start + CHUNK_WORDS);
    const chunkWords = words.slice(start, end);
    chunks.push({
      chunkIndex,
      chunkText: chunkWords.join(' '),
    });
    if (end >= words.length) {
      break;
    }
    start = Math.max(0, end - CHUNK_OVERLAP);
    chunkIndex += 1;
  }

  return chunks;
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0 || a.length !== b.length) {
    return 0;
  }
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) {
    return 0;
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function clampScore(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, value));
}

function lexicalScore(query: string, text: string): number {
  const q = query.trim().toLowerCase();
  if (!q) {
    return 0.5;
  }
  const tokens = q.split(/\s+/).filter((token) => token.length >= 2);
  if (tokens.length === 0) {
    return text.toLowerCase().includes(q) ? 0.5 : 0;
  }

  const lower = text.toLowerCase();
  let hits = 0;
  for (const token of tokens) {
    if (lower.includes(token)) {
      hits += 1;
    }
  }

  return clampScore(hits / tokens.length);
}

function buildSnippet(text: string, query: string): string {
  const compact = extractSearchText(text);
  if (!compact) {
    return '';
  }
  const lower = compact.toLowerCase();
  const q = query.trim().toLowerCase();
  if (!q) {
    return compact.slice(0, 220);
  }

  const pivot = lower.indexOf(q);
  if (pivot === -1) {
    return compact.slice(0, 220);
  }

  const start = Math.max(0, pivot - 80);
  const end = Math.min(compact.length, pivot + q.length + 140);
  return compact.slice(start, end);
}

export async function embedText(text: string): Promise<{ values: number[]; model: string } | null> {
  if (process.env.USE_MOCK_AI === 'true') {
    return {
      values: new Array(768).fill(0).map(() => Math.random()),
      model: 'mock-embedding-v1',
    };
  }

  if (!process.env.VERTEX_PROJECT_ID?.trim()) {
    return null;
  }

  try {
    const vertexResult = await embedTextWithVertexPredict(text, EMBEDDING_DIM);
    if (vertexResult) {
      if (vertexResult.model !== EMBEDDING_MODEL && !warnedEmbeddingFallback) {
        warnedEmbeddingFallback = true;
        logger.warn('search: vertex embedding model', {
          model: vertexResult.model,
          embeddingModelEnv: EMBEDDING_MODEL,
        });
      }
      const values = vertexResult.values.slice(0, EMBEDDING_DIM);
      return { values, model: vertexResult.model };
    }
  } catch {
    return null;
  }

  return null;
}

function vectorLiteral(values: number[]): string {
  return `[${values.map((value) => (Number.isFinite(value) ? value : 0)).join(',')}]`;
}

export async function syncManifestMetadata(input: {
  projectId: string;
  organisationId: string;
  manifestPath?: string;
  outlookBaseDir?: string;
}): Promise<ManifestSyncResult> {
  const manifestPath = input.manifestPath || process.env.OUTLOOK_MANIFEST_PATH || '';
  const outlookBaseDir = input.outlookBaseDir || process.env.OUTLOOK_BASE_DIR || '';

  if (!manifestPath) {
    throw new Error('OUTLOOK_MANIFEST_PATH saknas');
  }
  if (!outlookBaseDir) {
    throw new Error('OUTLOOK_BASE_DIR saknas');
  }

  const csvRaw = decodeManifestCsv(await fs.readFile(manifestPath));
  const rows = parseManifestCsv(csvRaw);
  let processedRows = 0;
  let queuedExtractionJobs = 0;
  let skippedRows = 0;

  for (const row of rows) {
    const diskName = manifestDiskName(row);
    if (!diskName) {
      skippedRows += 1;
      continue;
    }

    const storedPath = readField(row, ['stored_path', 'StoredPath', 'RelativePath', 'Path', 'FilePath']);
    const resolvedAbsolutePath = resolveManifestAbsolutePath(outlookBaseDir, storedPath, diskName);

    const stat = await statSafe(resolvedAbsolutePath);
    const fileSize = stat?.size ?? null;

    const subject = readField(row, ['Subject', 'subject']) || diskName;
    const entryId = readField(row, ['EntryID', 'EntryId', 'message_id', 'MessageId']) || diskName;
    const receivedTime = parseDateOrNull(
      readField(row, ['ReceivedTime', 'received_date', 'received_at', 'Date', 'received']),
    );
    const mimeType = readField(row, ['MimeType', 'mime_type', 'ContentType']) || null;
    const fileSha256 = readField(row, ['Sha256', 'Checksum', 'Hash']) || null;
    const municipality = readField(row, ['Municipality', 'kommun', 'kommunnamn']) || null;
    const decisionType = readField(row, ['DecisionType', 'beslutstyp']) || null;
    const wasteType = readField(row, ['WasteType', 'waste_codes', 'avfallstyp', 'avfallstyp_namn']) || null;
    const legalStatus = readField(row, ['LegalStatus', 'status']) || null;
    const hazardousFlag = parseBooleanOrNull(
      readField(row, ['Hazardous', 'hazardous_flag', 'farligt', 'farligt_avfall']),
    );
    const originalName = readField(row, ['OriginalName', 'filename', 'FileName']) || diskName;

    const existing = await findDocumentByDiskName(diskName);
    const ext = path.extname(resolvedAbsolutePath).toLowerCase();
    const legacyBinaryMarker = `binart format (${ext}) - metadataindexerad.`;
    const hasLegacyPdfPlaceholder =
      ext === '.pdf' &&
      typeof existing?.content?.searchText === 'string' &&
      existing.content.searchText.toLowerCase().includes(LEGACY_PDF_PLACEHOLDER_MARKER);
    const hasLegacyBinaryPlaceholder =
      OCR_CAPABLE_EXTENSIONS.has(ext) &&
      typeof existing?.content?.searchText === 'string' &&
      existing.content.searchText.toLowerCase().includes(legacyBinaryMarker);
    const missingOcrCapableContent =
      OCR_CAPABLE_EXTENSIONS.has(ext) && Boolean(existing) && !existing?.content;
    const changed =
      !existing ||
      String(existing.absolutePath || '') !== resolvedAbsolutePath ||
      String(existing.fileSha256 || '') !== String(fileSha256 || '') ||
      String(existing.fileSize || '') !== String(fileSize || '') ||
      hasLegacyPdfPlaceholder ||
      hasLegacyBinaryPlaceholder ||
      missingOcrCapableContent;

    const document = await upsertDocumentFromManifest({
      projectId: input.projectId,
      organisationId: input.organisationId,
      entryId,
      receivedTime,
      subject,
      originalName,
      diskName,
      absolutePath: resolvedAbsolutePath,
      fileSize,
      fileSha256,
      mimeType,
      decisionType,
      municipality,
      wasteType,
      hazardousFlag,
      legalStatus,
      manifestMeta: row,
      preserveStatusOnUpdate: !changed,
    });

    if (changed) {
      await enqueueSearchJob({
        type: 'EXTRACT_TEXT',
        projectId: input.projectId,
        payload: { documentId: String(document.id) },
      });
      queuedExtractionJobs += 1;
    }

    processedRows += 1;
  }

  return { processedRows, queuedExtractionJobs, skippedRows };
}

export async function extractDocumentTextAndChunk(
  documentId: string,
  forceOcr = false,
): Promise<{ chunks: number }> {
  const target = await getDocumentById(documentId);
  if (!target) {
    throw new Error(`Document not found: ${documentId}`);
  }

  const rawText = await loadDocumentText(
    String(target.absolutePath || ''),
    String(target.originalName || target.diskName || 'dokument'),
    forceOcr,
    String(target.originalName || target.diskName || 'dokument'),
  );
  const searchText = extractSearchText(rawText);
  const encrypted = encryptContent(rawText);

  await upsertDocumentContent({
    documentId,
    contentCiphertext: encrypted.ciphertext,
    contentIv: encrypted.iv,
    contentTag: encrypted.tag,
    keyVersion: encrypted.keyVersion,
    searchText,
  });

  const chunks = chunkText(searchText);
  await replaceDocumentChunks({
    documentId,
    chunks: chunks.map((chunk) => ({ ...chunk, embeddingJson: null })),
  });

  await setDocumentStatus(documentId, 'TEXT_EXTRACTED');
  await enqueueSearchJob({
    type: 'EMBED_DOC',
    projectId: target.projectId,
    payload: { documentId },
  });

  return { chunks: chunks.length };
}

export async function embedDocumentChunks(
  documentId: string,
): Promise<{ embeddedChunks: number; model: string }> {
  const document = await getDocumentById(documentId);
  if (!document) {
    throw new Error(`Document not found: ${documentId}`);
  }

  const docChunks = await listChunksForDocument(documentId, 10_000);

  let embeddedChunks = 0;
  let usedModel = EMBEDDING_MODEL;
  for (const chunk of docChunks) {
    const embedding = await embedText(String(chunk.chunkText || ''));
    if (!embedding || embedding.values.length === 0) {
      continue;
    }
    usedModel = embedding.model;
    const normalized = embedding.values.slice(0, EMBEDDING_DIM);
    const literal = vectorLiteral(normalized);
    await updateChunkVector(String(chunk.id), literal);
    await setChunkEmbeddingJson(String(chunk.id), normalized);
    embeddedChunks += 1;
  }

  await setDocumentStatus(documentId, embeddedChunks > 0 ? 'EMBEDDED' : 'TEXT_EXTRACTED');
  return { embeddedChunks, model: usedModel };
}

export async function runSearchQuery(input: {
  projectId?: string;
  organisationId: string;
  userId: string;
  query: string;
  mode: SearchMode;
  topK?: number;
  strictEvidence?: boolean;
  filters?: SearchFilters;
}): Promise<SearchQueryResult> {
  const startedAt = Date.now();
  const mode: SearchMode = input.mode || 'hybrid';
  const topK = Math.max(1, Math.min(100, Number(input.topK || 20)));
  const query = String(input.query || '').trim();
  const strictEvidence = Boolean(input.strictEvidence);
  const projectId = String(input.projectId || '').trim() || undefined;
  const scope: 'project' | 'global' = projectId ? 'project' : 'global';
  const filters = input.filters || {};

  let queryEmbedding: number[] | null = null;
  if ((mode === 'semantic' || mode === 'hybrid') && query) {
    const queryEmbeddingResult = await embedText(query);
    queryEmbedding = queryEmbeddingResult?.values || null;
  }

  const fallbackTextQuery =
    mode === 'lexical' || ((mode === 'semantic' || mode === 'hybrid') && query && !queryEmbedding)
      ? query
      : undefined;

  type SearchDocumentCandidate = Awaited<ReturnType<typeof findDocumentsForProject>>[number];

  const candidates: SearchDocumentCandidate[] = await findDocumentsForProject({
    organisationId: input.organisationId,
    projectId,
    query: fallbackTextQuery,
    municipality: filters.municipality,
    decisionType: filters.decisionType,
    wasteType: filters.wasteType,
    status: filters.status,
    legalStatus: filters.legalStatus,
    hazardousFlag: filters.hazardousFlag,
    dateFrom: parseDateOrNull(filters.dateFrom || '') ?? undefined,
    dateTo: parseDateOrNull(filters.dateTo || '') ?? undefined,
    take: projectId ? 3000 : 8000,
  });

  const semanticByDoc = new Map<string, number>();
  const semanticEvidenceByDoc = new Map<string, { quote: string; chunkIndex: number; confidence: number }>();
  let semanticEngine: 'pgvector' | 'json-fallback' | 'disabled' = 'disabled';
  if ((mode === 'semantic' || mode === 'hybrid') && queryEmbedding) {
    const semanticLimit = projectId ? 12_000 : 20_000;
    const vectorRows = await queryTopSemanticChunks({
      organisationId: input.organisationId,
      projectId,
      queryEmbedding,
      limit: semanticLimit,
    });

    if (vectorRows.length > 0) {
      semanticEngine = 'pgvector';
      for (const row of vectorRows) {
        const key = String(row.documentId);
        const similarity = clampScore(Number(row.similarity || 0));
        const previous = semanticByDoc.get(key) ?? 0;
        if (similarity <= previous) {
          continue;
        }
        semanticByDoc.set(key, similarity);
        const quote =
          buildSnippet(String(row.chunkText || ''), query) || String(row.chunkText || '').slice(0, 220);
        semanticEvidenceByDoc.set(key, {
          quote,
          chunkIndex: Number(row.chunkIndex || 0),
          confidence: Number(similarity.toFixed(4)),
        });
      }
    } else {
      const allChunks = await listChunksForProject(projectId, semanticLimit);
      // NOTE: listChunksForProject currently doesn't filter by organisationId but
      // it is only called here if vector search fails.
      // We should ideally update listChunksForProject as well if we want 100% isolation.
      if (allChunks.length > 0) {
        semanticEngine = 'json-fallback';
      }

      for (const chunk of allChunks) {
        const embedding = Array.isArray(chunk.embeddingJson) ? (chunk.embeddingJson as number[]) : null;
        if (!embedding || embedding.length === 0) {
          continue;
        }
        const similarity = cosineSimilarity(queryEmbedding, embedding.slice(0, queryEmbedding.length));
        const key = String(chunk.documentId);
        const previous = semanticByDoc.get(key) ?? 0;
        if (similarity > previous) {
          semanticByDoc.set(key, similarity);
          const quote =
            buildSnippet(String(chunk.chunkText || ''), query) || String(chunk.chunkText || '').slice(0, 220);
          semanticEvidenceByDoc.set(key, {
            quote,
            chunkIndex: Number(chunk.chunkIndex),
            confidence: Number(clampScore(similarity).toFixed(4)),
          });
        }
      }
    }
  }

  let evidenceFilteredOut = 0;

  // 1. Gather all unique property designations from candidates to fetch risks in bulk
  const uniqueDesignations = Array.from(
    new Set(candidates.map((c) => c.project?.propertyDesignation).filter((d): d is string => Boolean(d))),
  );

  // 2. Resolve coords and check risks for these properties
  const geoRiskMap = new Map<string, GeoRiskStatus | null>();
  if (uniqueDesignations.length > 0) {
    const propertyData = await prisma.$queryRaw<
      Array<{ designation: string; lat: number | null; lng: number | null }>
    >`
      SELECT designation, ST_Y(ST_Transform(geom, 4326)) as lat, ST_X(ST_Transform(geom, 4326)) as lng
      FROM core.property_unit
      WHERE designation IN (${Prisma.join(uniqueDesignations)})
    `;

    for (const prop of propertyData) {
      if (prop.lat && prop.lng) {
        const risks = await checkGeospatialRisks(prop.lat, prop.lng);
        geoRiskMap.set(prop.designation, risks);
      }
    }
  }

  const ranked = candidates
    .flatMap((candidate): SearchResultRow[] => {
      const documentId = String(candidate.id);
      const textBlob = `${candidate.subject || ''} ${candidate.originalName || ''} ${candidate.content?.searchText || ''}`;
      const lex = lexicalScore(query, textBlob);
      const semantic = clampScore(semanticByDoc.get(documentId) ?? 0);

      let score = lex;
      let whyMatched = 'Lexical match in metadata/text';

      if (mode === 'semantic') {
        score = semantic > 0 ? semantic : lex * 0.8;
        whyMatched =
          semantic > 0 ? `Semantic chunk similarity (${semanticEngine})` : 'Fallback lexical score';
      } else if (mode === 'hybrid') {
        score = semantic > 0 ? semantic * 0.65 + lex * 0.35 : lex;
        whyMatched =
          semantic > 0
            ? `Hybrid semantic+lexical ranking (${semanticEngine})`
            : 'Lexical fallback (embedding saknas)';
      }

      const sourceLabel = String(candidate.subject || candidate.originalName || 'Dokument');
      const citations: SearchResultRow['citations'] = [];
      const semanticEvidence = semanticEvidenceByDoc.get(documentId);
      if (semanticEvidence?.quote) {
        citations.push({
          citationId: `${documentId}:${semanticEvidence.chunkIndex}`,
          chunkIndex: semanticEvidence.chunkIndex,
          quote: semanticEvidence.quote,
          sourceLabel,
          confidence: semanticEvidence.confidence,
        });
      } else {
        const lexicalQuote = buildSnippet(String(candidate.content?.searchText || ''), query);
        if (lexicalQuote) {
          citations.push({
            citationId: `${documentId}:lexical`,
            chunkIndex: null,
            quote: lexicalQuote,
            sourceLabel,
            confidence: Number(clampScore(lex).toFixed(4)),
          });
        }
      }

      if (strictEvidence && citations.length === 0) {
        evidenceFilteredOut += 1;
        return [];
      }

      return [
        {
          documentId,
          score: Number(clampScore(score).toFixed(4)),
          snippet: buildSnippet(candidate.content?.searchText || candidate.subject || '', query),
          whyMatched,
          citations,
          metadata: {
            projectId: candidate.project?.id ? String(candidate.project.id) : null,
            projectName: candidate.project?.propertyDesignation
              ? String(candidate.project.propertyDesignation)
              : null,
            organisationName: candidate.project?.organisation?.name
              ? String(candidate.project.organisation.name)
              : null,
            subject: String(candidate.subject || ''),
            originalName: String(candidate.originalName || ''),
            receivedTime: candidate.receivedTime ? new Date(candidate.receivedTime).toISOString() : null,
            municipality: candidate.municipality ? String(candidate.municipality) : null,
            decisionType: candidate.decisionType ? String(candidate.decisionType) : null,
            wasteType: candidate.wasteType ? String(candidate.wasteType) : null,
            hazardousFlag: candidate.hazardousFlag ?? null,
            legalStatus: candidate.legalStatus ? String(candidate.legalStatus) : null,
            status: String(candidate.status || 'METADATA_ONLY'),
            geoRisk: candidate.project?.propertyDesignation
              ? geoRiskMap.get(candidate.project.propertyDesignation) ?? null
              : null,
          },
        },
      ];
    })
    .filter((row) => !query || row.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);

  const elapsedMs = Date.now() - startedAt;
  const citedCount = ranked.filter((row) => row.citations.length > 0).length;
  const citationCoveragePct =
    ranked.length === 0 ? 0 : Number(((citedCount / ranked.length) * 100).toFixed(1));
  if (projectId) {
    await logSearchQuery({
      userId: input.userId,
      projectId,
      query,
      mode,
      topK,
      resultCount: ranked.length,
      elapsedMs,
    });
  }

  return {
    mode,
    scope,
    elapsedMs,
    totalCandidates: candidates.length,
    guardrails: {
      strictEvidence,
      evidenceFilteredOut,
      citationCoveragePct,
      semanticEngine,
      draftWatermark: process.env.SEARCH_DRAFT_WATERMARK || 'Miljobeslut.se - GRANSKAD PRODUKTIONSDATA',
    },
    results: ranked,
  };
}
