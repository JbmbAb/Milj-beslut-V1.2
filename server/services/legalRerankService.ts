import { logger } from '../logger';
import { RerankPromptService } from './rerankPromptService';
import { generateJson as generateLocalJson, localGenerationStatus } from '../modules/ai/generation/LocalGenerationPort';

export type LegalRerankCandidate = {
  id: string;
  chunkText: string;
  score: number;
};

export type LegalRerankOutcome<T extends LegalRerankCandidate> = {
  items: Array<T & { finalScore: number; rerankApplied: boolean }>;
  engine: 'local' | 'lexical';
  promptVersion: string;
  skipReason?: string;
};

type RerankScoreRow = { id: string; score: number };

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

function parseRerankScores(payload: unknown): RerankScoreRow[] | null {
  if (!Array.isArray(payload)) return null;
  const rows: RerankScoreRow[] = [];
  for (const item of payload) {
    if (!item || typeof item !== 'object') return null;
    const row = item as Record<string, unknown>;
    if (typeof row.id !== 'string' || typeof row.score !== 'number') return null;
    rows.push({ id: row.id, score: row.score });
  }
  return rows;
}

/**
 * Local/on-prem rerank through the provider-neutral generation port; lexical fallback when the local runtime is unavailable or fails.
 */
export async function rerankWithLocalOrLexical<T extends LegalRerankCandidate>(
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

  const generation = localGenerationStatus();
  if (!generation.available) {
    logger.warn('LEGAL_RERANKER: ingen lokal generering registrerad — kör lexical fallback.', {
      blocker: generation.blocker,
    });
    return toLexicalOutcome(query, candidates, 'offline-fallback', 'MISSING_LOCAL_GENERATION_RUNTIME');
  }

  try {
    const { prompt, version } = await RerankPromptService.getFormattedPrompt(
      query,
      candidates.map((c) => ({ id: c.id, chunkText: c.chunkText })),
    );

    logger.info('LEGAL_RERANKER: kör lokal rerank', {
      query,
      promptVersion: version,
      candidatesCount: candidates.length,
      runtimeId: generation.runtime_id,
    });

    const scores = await generateLocalJson<RerankScoreRow[]>(prompt, {
      profile: 'fast',
      temperature: 0.1,
      maxOutputTokens: 4096,
      parse: (payload) => parseRerankScores(payload),
    });

    if (!scores?.length) {
      throw new Error('Lokal generering returnerade tom eller ogiltig rerank-JSON');
    }

    const ranked = candidates
      .map((item) => {
        const match = scores.find((s) => s.id === item.id);
        const finalScore = match ? match.score : item.score;
        return { ...item, finalScore, rerankApplied: true as const };
      })
      .sort((a, b) => b.finalScore - a.finalScore);

    return { items: ranked, engine: 'local', promptVersion: version };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`LEGAL_RERANKER: lokal rerank misslyckades (${message}) — lexical fallback.`);
    return toLexicalOutcome(query, candidates, 'error-fallback', `ERROR: ${message}`);
  }
}
