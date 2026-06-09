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
  /** Krav på att specificera kartlager vid geospatiala svar */
  requireMapLayersSpecification: boolean;
  /** Krav på att specificera målnummer, domstol och lagrum för domslut */
  requireJudgmentCitationSpecification: boolean;
}

export const DEFAULT_AI_POLICY: AiPolicy = {
  requireEvidenceForDecisionCriticalClaims: true,
  requireInlineCitationsWhenSourcesProvided: true,
  ragMaxWords: 350,
  requireMapLayersSpecification: true,
  requireJudgmentCitationSpecification: true,
};

export function ragSystemInstruction(policy: AiPolicy): string {
  const maxWords = policy.ragMaxWords;
  const instructions = [
    'Du är en assistent för svensk miljörätt och miljöbeslut.',
    'Du får bara använda den givna kontexten och ska säga tydligt om svaret saknas.',
    policy.requireInlineCitationsWhenSourcesProvided
      ? 'När du använder en källa ska du citera den inline som (Källa 1), (Källa 2) osv.'
      : 'Om du använder en källa: ange den.',
  ];

  if (policy.requireMapLayersSpecification) {
    instructions.push(
      'När du redovisar geospatial information måste du uttryckligen specificera vilka kartlager (t.ex. sgu_soil_type_25k_100k) och myndighetskällor (t.ex. SGU, Naturvårdsverket) du baserar svaret på.'
    );
  }

  if (policy.requireJudgmentCitationSpecification) {
    instructions.push(
      'Vid alla påståenden om juridisk praxis eller miljödomar ska du explicit inkludera diarienummer/målnummer, domstol, datum samt tillämpliga lagrum (kapitel och paragraf i Miljöbalken eller annan lag).',
      'VIKTIGT: Du ska alltid inkludera en klickbar Markdown-länk till originaldokumentet för varje källa du citerar.',
      '- För källor som har ett ID i verktygssvaret: använd [Titel/Målnummer](/api/legal/view/ID).',
      '- För källor som har en extern URL (sourceUrl): använd [Titel](URL).'
    );
  }

  instructions.push(`Svara kort och strukturerat (max ${maxWords} ord).`);

  return instructions.join('\n');
}
