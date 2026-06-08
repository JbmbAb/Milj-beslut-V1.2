import { FunctionDeclaration, Type } from '@google/genai';
import { embedText } from '../../../../services/searchService';
import { prisma } from '../../../../db/prisma';

export const searchLegalCorpusDeclaration: FunctionDeclaration = {
  name: 'searchLegalCorpus',
  description: 'Söker efter relevanta miljödomar, prejudikat och kunskapsartiklar i Legal Corpus. Använd detta för att ta reda på svensk miljöjuridik, praxis och tillsynsmetodik.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      query: {
        type: Type.STRING,
        description: 'Söksträngen eller nyckelorden (t.ex. "strandskydd dispens", "förorenad mark ansvar").'
      },
      legalArea: {
        type: Type.STRING,
        description: 'Frivillig. Filtrera på specifikt rättsområde eller kategori om känt.'
      }
    },
    required: ['query'],
  },
};

let cachedVectorColumnName: string | null | undefined = undefined;

async function getVectorColumnName(): Promise<string | null> {
  if (cachedVectorColumnName !== undefined) {
    return cachedVectorColumnName;
  }
  try {
    const columns = await prisma.$queryRawUnsafe<any[]>(
      `SELECT column_name
       FROM information_schema.columns
       WHERE table_name = 'legal_corpus_records'
         AND (udt_name = 'vector' OR column_name IN ('embedding', 'embeddingVector', 'embedding_vector'))
       LIMIT 1;`
    );
    if (columns.length > 0) {
      cachedVectorColumnName = columns[0].column_name;
    } else {
      cachedVectorColumnName = null;
    }
  } catch (err) {
    console.error('Error checking vector column on legal_corpus_records:', err);
    cachedVectorColumnName = null;
  }
  return cachedVectorColumnName;
}

function buildSnippet(text: string, query: string, windowSize = 1000): string {
  if (!text) return '';
  const compact = text.replace(/\s+/g, ' ').trim();
  const lowerText = compact.toLowerCase();
  const lowerQuery = query.toLowerCase();

  const index = lowerText.indexOf(lowerQuery);
  if (index === -1) {
    const firstWord = lowerQuery.split(' ').find(w => w.length > 2);
    if (firstWord) {
      const wIndex = lowerText.indexOf(firstWord);
      if (wIndex !== -1) {
        const start = Math.max(0, wIndex - Math.floor(windowSize / 3));
        const end = Math.min(compact.length, start + windowSize);
        return compact.substring(start, end);
      }
    }
    return compact.substring(0, windowSize);
  }
  
  const start = Math.max(0, index - Math.floor(windowSize / 3));
  const end = Math.min(compact.length, start + windowSize);
  return compact.substring(start, end);
}

export async function searchLegalCorpusHandler(args: { query: string; legalArea?: string }) {
  const { query, legalArea } = args;

  if (!query || query.trim().length < 2) {
    return { error: 'Söksträngen är för kort.' };
  }

  try {
    // 1. Full-Text Search (FTS) query using websearch_to_tsquery
    let ftsQuery = `
      SELECT id, 
             ts_rank_cd(to_tsvector('swedish', coalesce(search_text, '')), websearch_to_tsquery('swedish', $1)) as rank
      FROM legal_corpus_records
      WHERE to_tsvector('swedish', coalesce(search_text, '')) @@ websearch_to_tsquery('swedish', $1)
    `;
    const ftsParams: any[] = [query];
    if (legalArea) {
      ftsQuery += ` AND legal_area ILIKE $2`;
      ftsParams.push(legalArea);
    }
    ftsQuery += ` ORDER BY rank DESC LIMIT 30;`;

    const ftsResults = await prisma.$queryRawUnsafe<any[]>(ftsQuery, ...ftsParams);

    // 2. Substring LIKE fallback query (in case FTS returns nothing)
    let likeQuery = `
      SELECT id
      FROM legal_corpus_records
      WHERE (case_number ILIKE $1
         OR title ILIKE $1
         OR search_text ILIKE $1)
    `;
    const likeParams: any[] = [`%${query}%`];
    if (legalArea) {
      likeQuery += ` AND legal_area ILIKE $2`;
      likeParams.push(legalArea);
    }
    likeQuery += ` LIMIT 10;`;

    // 3. Vector search query (only if vector column is available)
    let vectorResults: any[] = [];
    const vectorColumn = await getVectorColumnName();
    if (vectorColumn) {
      try {
        const embedResult = await embedText(query);
        if (embedResult && embedResult.values) {
          const vectorLiteral = `[${embedResult.values.join(',')}]`;
          let vectorSql = `
            SELECT id,
                   1 - ("${vectorColumn}" <=> $1::vector) as similarity
            FROM legal_corpus_records
            WHERE "${vectorColumn}" IS NOT NULL
          `;
          const vectorParams: any[] = [vectorLiteral];
          if (legalArea) {
            vectorSql += ` AND legal_area ILIKE $2`;
            vectorParams.push(legalArea);
          }
          vectorSql += ` ORDER BY "${vectorColumn}" <=> $1::vector LIMIT 30;`;
          vectorResults = await prisma.$queryRawUnsafe<any[]>(vectorSql, ...vectorParams);
        }
      } catch (vectorErr) {
        console.warn('Vector search failed, continuing with lexical search only:', vectorErr);
      }
    }

    // 4. Reciprocal Rank Fusion (RRF) to merge rankings
    const rrfScores = new Map<string, { rrf: number; similarity?: number; rank?: number }>();

    if (vectorResults && vectorResults.length > 0) {
      vectorResults.forEach((row, index) => {
        const docId = row.id;
        const current = rrfScores.get(docId) || { rrf: 0 };
        current.rrf += 1 / (60 + index + 1);
        current.similarity = Number(row.similarity || 0);
        rrfScores.set(docId, current);
      });
    }

    if (ftsResults && ftsResults.length > 0) {
      ftsResults.forEach((row, index) => {
        const docId = row.id;
        const current = rrfScores.get(docId) || { rrf: 0 };
        current.rrf += 1 / (60 + index + 1);
        current.rank = Number(row.rank || 0);
        rrfScores.set(docId, current);
      });
    } else if (vectorResults.length === 0) {
      // If both vector and FTS returned empty, use LIKE fallback
      const fallbackResults = await prisma.$queryRawUnsafe<any[]>(likeQuery, ...likeParams);
      fallbackResults.forEach((row, index) => {
        const docId = row.id;
        rrfScores.set(docId, { rrf: 1 / (60 + index + 1) });
      });
    }

    const sortedIds = Array.from(rrfScores.keys())
      .sort((a, b) => (rrfScores.get(b)?.rrf || 0) - (rrfScores.get(a)?.rrf || 0))
      .slice(0, 5);

    if (sortedIds.length === 0) {
      return {
        message: `Inga miljödomar eller lagrum hittades som matchade sökningen "${query}".`,
        results: []
      };
    }

    const details = await prisma.$queryRawUnsafe<any[]>(
      `SELECT id, title, case_number, published_at, decision_date, authority_name, legal_area, document_text, metadata, source_url, source_path
       FROM legal_corpus_records
       WHERE id IN (${sortedIds.map((_, i) => `$${i + 1}`).join(', ')});`,
      ...sortedIds
    );

    const mappedResults = sortedIds.map(id => {
      const detail = details.find(d => d.id === id);
      if (!detail) return null;

      const rrfInfo = rrfScores.get(id);
      const snippet = buildSnippet(detail.document_text || '', query, 1000);

      // Structured metadata extraction
      const meta = detail.metadata || {};
      const structuredMeta = {
        lagrum: meta.lagrumLista || [],
        forarbeten: meta.forarbeteLista || [],
        malnummer: meta.malNummerLista || [],
        nyckelord: meta.nyckelordLista || [],
        referatNummer: meta.referatNummerLista || [],
        avgorandedatum: meta.avgorandedatum || detail.decision_date || null
      };

      return {
        id: detail.id,
        title: detail.title,
        caseNumber: detail.case_number,
        decisionDate: detail.decision_date,
        publishedAt: detail.published_at,
        authorityName: detail.authority_name,
        legalArea: detail.legal_area,
        sourceUrl: detail.source_url,
        sourcePath: detail.source_path,
        snippet,
        metadata: structuredMeta,
        score: rrfInfo?.rrf ? Number(rrfInfo.rrf.toFixed(6)) : 0,
        similarity: rrfInfo?.similarity,
        rank: rrfInfo?.rank
      };
    }).filter(Boolean);

    return {
      results: mappedResults
    };
  } catch (err: any) {
    console.error('searchLegalCorpus error:', err);
    return { error: 'Databasfel vid sökning i korpusen.', details: err.message };
  }
}
