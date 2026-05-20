/**
 * ai policy
 *
 * Kodifierar rollfördelning: AI får föreslå och sammanfatta, men systemet
 * måste validera, logga och kräva källor för beslutskritiska påståenden.
 */

export type AiRole = 'SUGGEST' | 'SUMMARIZE' | 'EXTRACT_STRUCTURED' | 'VERIFY';

export interface AiPolicy {
  /** AI får aldrig vara ensam källa för "faktum" som påverkar beslut. */
  requireEvidenceForDecisionCriticalClaims: boolean;
  /** När källor finns ska svaret innehålla explicit hänvisning. */
  requireInlineCitationsWhenSourcesProvided: boolean;
  /** Max ord för användarsvar i RAG (förhindrar hallucinerande romaner). */
  ragMaxWords: number;
}

export const DEFAULT_AI_POLICY: AiPolicy = {
  requireEvidenceForDecisionCriticalClaims: true,
  requireInlineCitationsWhenSourcesProvided: true,
  ragMaxWords: 350,
};

export function ragSystemInstruction(policy: AiPolicy): string {
  const maxWords = policy.ragMaxWords;
  return [
    'Du är en assistent för svensk miljörätt.',
    'Du får bara använda den givna kontexten och ska säga tydligt om svaret saknas.',
    policy.requireInlineCitationsWhenSourcesProvided
      ? 'När du använder en källa ska du citera den inline som (Källa 1), (Källa 2) osv.'
      : 'Om du använder en källa: ange den.',
    `Svara kort och strukturerat (max ${maxWords} ord).`,
  ].join('\n');
}
