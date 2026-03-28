/**
 * documentMiner.ts
 *
 * Extraherar strukturerad data från ostrukturerad dokumenttext.
 * Portad från Ny plattform (miner.py) till TypeScript.
 *
 * Identifierar:
 *  - Fastighetsbeteckningar (t.ex. "Norrmalm 1:1")
 *  - Kommunnamn via nyckelord
 *  - Riskkategorier baserade på nyckelord
 */

/** Regex för att matcha svenska fastighetsbeteckningar. */
const PROPERTY_PATTERN = /\b([A-ZÅÄÖ][a-zåäö]+(?:\s+[A-ZÅÄÖ][a-zåäö]+)?\s+\d+:\d+)\b/g;

/** Regex för att matcha kommunnamn (t.ex. "Stockholms kommun"). */
const MUNICIPALITY_PATTERN =
  /([A-ZÅÄÖ][a-zåäö]+(?:\s+[A-ZÅÄÖ][a-zåäö]+)?)\s+(?:kommun|stadsbyggnads)/gi;

/** Riskkategorier med tillhörande nyckelord. */
export const RISK_KEYWORDS: Record<string, string[]> = {
  Sanering: ['sanering', 'föroren', 'efterbehandling', 'olja', 'kvicksilver', 'bly'],
  Markrisk: ['schakt', 'massor', 'deponi', 'markstabilitet', 'skred'],
  Juridisk: ['föreläggande', 'vite', 'förbud', 'delgivning'],
  Buller: ['buller', 'ljud', 'decibel', 'bullerskydd'],
  Utsläpp: ['utsläpp', 'avlopp', 'emission', 'reningsverk'],
};

export interface MinerResult {
  /** Primär fastighetsbeteckning (första träffen). */
  primaryProperty: string | null;
  /** Alla fastighetsbeteckningar i dokumentet. */
  allProperties: string[];
  /** Kommunnamn (normaliserat). */
  municipality: string | null;
  /** Identifierade riskkategorier. */
  riskTypes: string[];
  /** Sammanslagen risksträng, t.ex. "Sanering, Markrisk". */
  riskString: string;
}

/**
 * Analyserar dokumenttext och extraherar strukturerad metadata.
 *
 * @example
 *   const result = mineDocumentText('Fastigheten Norrmalm 1:1 i Stockholms kommun...');
 *   result.primaryProperty // → 'Norrmalm 1:1'
 *   result.municipality    // → 'Stockholm'
 *   result.riskTypes       // → ['Juridisk']
 */
export function mineDocumentText(text: string): MinerResult {
  if (!text) {
    return {
      primaryProperty: null,
      allProperties: [],
      municipality: null,
      riskTypes: [],
      riskString: 'Normal',
    };
  }

  // Extrahera fastighetsbeteckningar
  const allProperties = [...text.matchAll(PROPERTY_PATTERN)].map((m) => m[1]);
  const primaryProperty = allProperties[0] ?? null;

  // Extrahera kommunnamn
  const muniMatch = MUNICIPALITY_PATTERN.exec(text);
  const municipality = muniMatch ? muniMatch[1] : null;

  // Risk-klassificering
  const textLower = text.toLowerCase();
  const riskTypes = Object.entries(RISK_KEYWORDS)
    .filter(([, keywords]) => keywords.some((kw) => textLower.includes(kw)))
    .map(([category]) => category);

  return {
    primaryProperty,
    allProperties,
    municipality,
    riskTypes,
    riskString: riskTypes.length > 0 ? riskTypes.join(', ') : 'Normal',
  };
}

/**
 * Extraherar alla fastighetsbeteckningar från en text.
 * Convenience-wrapper för `mineDocumentText`.
 */
export function extractPropertyDesignations(text: string): string[] {
  return mineDocumentText(text).allProperties;
}

/**
 * Klassar ett dokuments risknivå baserat på utvinnad text.
 *
 * @returns 'Hög' | 'Medel' | 'Låg'
 */
export function classifyRiskLevel(text: string): 'Hög' | 'Medel' | 'Låg' {
  const { riskTypes } = mineDocumentText(text);
  if (riskTypes.includes('Sanering') || riskTypes.includes('Juridisk')) return 'Hög';
  if (riskTypes.length > 0) return 'Medel';
  return 'Låg';
}
