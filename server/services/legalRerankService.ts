import { GoogleGenerativeAI } from '@google/generative-ai';
import { logger } from '../logger';
import { RerankPromptService } from './rerankPromptService';

export type LegalRerankCandidate = {
  id: string;
  chunkText: string;
  score: number;
};

export type LegalRerankOutcome<T extends LegalRerankCandidate> = {
  items: Array<T & { finalScore: number; rerankApplied: boolean }>;
  engine: 'gemini' | 'lexical';
  promptVersion: string;
  skipReason?: string;
};

/**
 * Lokal lexical reranker (Jaccard-liknande) — CPU-billig fallback.
 */
export function localLexicalRerank<T extends { chunkText: string; score: number }>(
  query: string,
  items: T[],
): Array<T & { finalScore: number; rerankApplied: true }> {
  const queryWords = query
    .toLowerCase()
    .split(/\s+/)
    .map((w) => w.replace(/[^\p{L}\p{N}]/gu, ''))
    .filter((w) => w.length > 2);

  return items.map((item) => {
    const textLower = item.chunkText.toLowerCase();
    let wordMatches = 0;
    for (const word of queryWords) {
      if (textLower.includes(word)) wordMatches += 1;
    }
    const relevanceModifier = (wordMatches / (queryWords.length || 1)) * 0.25;
    return {
      ...item,
      finalScore: item.score + relevanceModifier,
      rerankApplied: true as const,
    };
  });
}

function toLexicalOutcome<T extends LegalRerankCandidate>(
  query: string,
  items: T[],
  promptVersion: string,
  skipReason?: string,
): LegalRerankOutcome<T> {
  const reranked = localLexicalRerank(query, items).sort((a, b) => b.finalScore - a.finalScore);
  return {
    items: reranked.map((row) => ({ ...row, rerankApplied: true })),
    engine: 'lexical',
    promptVersion,
    skipReason,
  };
}

/**
 * Gemini rerank med GCS/lokal prompt via RerankPromptService; lexical fallback vid fel/saknad nyckel.
 */
export async function rerankWithGeminiOrLexical<T extends LegalRerankCandidate>(
  query: string,
  items: T[],
  limit: number,
): Promise<LegalRerankOutcome<T>> {
  const candidates = [...items]
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  if (candidates.length === 0) {
    return { items: [], engine: 'lexical', promptVersion: 'none', skipReason: 'NO_CANDIDATES' };
  }

  const apiKey = (process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey) {
    logger.warn('LEGAL_RERANKER: GEMINI_API_KEY saknas — kör lexical fallback.');
    return toLexicalOutcome(query, candidates, 'offline-fallback', 'MISSING_GEMINI_API_KEY');
  }

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
    const { prompt, version } = await RerankPromptService.getFormattedPrompt(
      query,
      candidates.map((c) => ({ id: c.id, chunkText: c.chunkText })),
    );

    logger.info('LEGAL_RERANKER: kör Gemini rerank', {
      query,
      promptVersion: version,
      candidatesCount: candidates.length,
    });

    const response = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: 'application/json' },
    });

    const text = response.response.text();
    const scores = JSON.parse(text) as { id: string; score: number }[];

    const ranked = candidates
      .map((item) => {
        const match = scores.find((s) => s.id === item.id);
        const finalScore = match ? match.score : item.score;
        return { ...item, finalScore, rerankApplied: true as const };
      })
      .sort((a, b) => b.finalScore - a.finalScore);

    return { items: ranked, engine: 'gemini', promptVersion: version };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`LEGAL_RERANKER: Gemini misslyckades (${message}) — lexical fallback.`);
    return toLexicalOutcome(query, candidates, 'error-fallback', `ERROR: ${message}`);
  }
}
