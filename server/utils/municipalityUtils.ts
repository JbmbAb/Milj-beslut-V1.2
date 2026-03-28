/**
 * municipalityUtils.ts
 *
 * Normalisering och validering av svenska kommunnamn.
 * Portad från Ny plattform (Python) till TypeScript.
 *
 * Hanterar:
 *  - Genitiv-ändelser (Göteborgs → Göteborg)
 *  - Kända felstavningar (edet → Lilla Edet)
 *  - Skräpord som inte är kommunnamn
 *  - Kommuner som korrekt slutar på 's'
 */

/** Ord som INTE är kommunnamn och ska sättas till null. */
const TRASH_WORDS = new Set([
  'och', 'kommer', 'att', 'med', 'för', 'från', 'som',
  'eller', 'den', 'det', 'beslut', 'avslag', 'bifall',
  'none', 'av', 'utförd', 'handläggning', 'okänd',
  'sverige', 'miljö', 'godkänd', 'faktura', 'kommun', 'stad',
  'till', 'datum', 'sida', 'diarienummer',
]);

/** Kommuner som korrekt slutar på 's' — ska INTE genitiv-stripas. */
const S_EXCEPTIONS = new Set([
  'hofors', 'mönsterås', 'västerås', 'borås',
  'alingsås', 'strängnäs', 'bollnäs', 'degerfors',
  'hagfors', 'tranås', 'nås', 'kramfors',
  'bengtsfors', 'karlskrona', 'tidaholms', 'tibros',
  'grums', 'munkfors', 'forshaga', 'hammarö',
  'gävle', 'sandvikens', 'motala', 'norrköpings',
  'nyköpings', 'oxelösunds', 'flens', 'gnesta',
  'vingåkers', 'eskilstuna', 'kungsörs',
  'hallstahammar', 'norbergs', 'fagersta',
  'skinnskattebergs', 'surahammars', 'köpings',
  'arboga', 'hällefors', 'ljusnarsbergs',
  'lindesbergs', 'noras', 'kumla', 'askersunds',
  'lekebergs', 'karlskoga', 'laxå',
]);

/** Kända felstavningar och genitiv-former → korrekta naam. */
const KNOWN_FIXES: Record<string, string> = {
  edet: 'Lilla Edet',
  enköpings: 'Enköping',
  falkenbergs: 'Falkenberg',
  göteborgs: 'Göteborg',
  linköpings: 'Linköping',
  jönköpings: 'Jönköping',
};

export interface MunicipalityCleanResult {
  cleaned: string | null;
  shouldSkip: boolean;
}

/**
 * Normaliserar ett kommunnamn.
 *
 * @returns `{ cleaned, shouldSkip }` — om `shouldSkip` är true
 *          ska värdet sättas till null i databasen.
 *
 * @example
 *   cleanMunicipality('Göteborgs')
 *   // → { cleaned: 'Göteborg', shouldSkip: false }
 *
 *   cleanMunicipality('beslut')
 *   // → { cleaned: null, shouldSkip: true }
 */
export function cleanMunicipality(name: string | null | undefined): MunicipalityCleanResult {
  if (!name) return { cleaned: null, shouldSkip: true };

  const stripped = name.trim();
  const lower = stripped.toLowerCase();

  // Filtrera bort korta strängar och skräpord
  if (lower.length < 3 || TRASH_WORDS.has(lower)) {
    return { cleaned: null, shouldSkip: true };
  }

  // Kända fixar
  if (KNOWN_FIXES[lower]) {
    return { cleaned: KNOWN_FIXES[lower], shouldSkip: false };
  }

  // Genitiv-fix: ta bort avslutande 's' om kommunen inte är ett undantag
  if (!S_EXCEPTIONS.has(lower) && lower.endsWith('s') && lower.length > 5) {
    return { cleaned: stripped.slice(0, -1), shouldSkip: false };
  }

  return { cleaned: stripped, shouldSkip: false };
}

/**
 * Kontrollerar om ett kommunnamn verkar giltigt (ej skräp).
 */
export function isValidMunicipality(name: string | null | undefined): boolean {
  return !cleanMunicipality(name).shouldSkip;
}
