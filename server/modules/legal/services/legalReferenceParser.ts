/**
 * server/modules/legal/services/legalReferenceParser.ts
 *
 * Parser för svenska lagrum-hänvisningar i fritext.
 * Stödjer SFS-nummer, lagförkortningar och komplexa mönster
 * inklusive stycken och punkter.
 *
 * Testfall (se tests/unit/legalReferenceParser.test.ts):
 *   "SFS 1998:808"            → { lawName: 'Miljöbalken' }
 *   "2 kap. 6 § Miljöbalken"  → { chapter: '2', paragraph: '6' }
 *   "MB 9 kap. 6 §"           → { lawName: 'Miljöbalken', chapter: '9', paragraph: '6' }
 *   "6 a § 2 kap MB"          → { chapter: '2', paragraph: '6a' }
 *   "2 kap. 6 § första stycket" → { chapter: '2', paragraph: '6', subsection: 'första' }
 *   "3 kap. 12 § tredje punkten" → { chapter: '3', paragraph: '12', item: '3' }
 */

/** Kanonisk SFS-mappning för vanliga miljö- och förvaltningslagar */
const SFS_TO_LAW: Record<string, string> = {
  '1998:808': 'Miljöbalken',
  '2010:900': 'Plan- och bygglagen',
  '2003:778': 'Lag om skydd mot olyckor',
  '2009:400': 'Offentlighets- och sekretesslagen',
  '1949:381': 'Föräldrabalken',
  '1962:700': 'Brottsbalken',
  '1987:10':  'Plan- och bygglagen (äldre)',
  '1999:673': 'Lag om handel med el',
};

/** Förkortningar för vanliga lagar */
const LAW_ABBREVIATIONS: Record<string, string> = {
  mb:  'Miljöbalken',
  pbl: 'Plan- och bygglagen',
  osl: 'Offentlighets- och sekretesslagen',
  brb: 'Brottsbalken',
  lso: 'Lag om skydd mot olyckor',
};

/** Ord → ordningstal-mappning för stycken och punkter */
const ORDINAL_MAP: Record<string, string> = {
  'första':  '1',
  'andra':   '2',
  'tredje':  '3',
  'fjärde':  '4',
  'femte':   '5',
  'sjätte':  '6',
  'sjunde':  '7',
  'åttonde': '8',
  'nionde':  '9',
  'tionde':  '10',
};

export interface LegalReference {
  lawName?: string;
  chapter?: string;
  paragraph?: string;
  /** Stycke inom paragraf — ordinaltext ("första") eller numerisk ("1") */
  subsection?: string;
  /** Punkt inom stycke/paragraf — numerisk sträng ("1", "2", "3") */
  item?: string;
}

/**
 * Tolkar en sökfråga och extraherar lagrum-metadata.
 * Returnerar null om ingen hänvisning kan identifieras.
 */
export function parseLegalReference(query: string): LegalReference | null {
  const clean = query.replace(/\s+/g, ' ').trim();

  // --- Stycke (ordinalord + "stycket") ---
  const subsectionMatch = clean.match(
    /\b(första|andra|tredje|fjärde|femte|sjätte|sjunde|åttonde|nionde|tionde)\s*stycket\b/i,
  );
  // --- Punkt — antingen siffra ("3 punkten") eller ordinalord ("tredje punkten") ---
  const itemNumericMatch = clean.match(/\b(\d+)\s*punkten\b/i);
  const itemOrdinalMatch = clean.match(
    /\b(första|andra|tredje|fjärde|femte|sjätte|sjunde|åttonde|nionde|tionde)\s*punkten\b/i,
  );

  const subsection = subsectionMatch
    ? subsectionMatch[1].toLowerCase()
    : undefined;

  let item: string | undefined;
  if (itemNumericMatch) {
    item = itemNumericMatch[1];
  } else if (itemOrdinalMatch) {
    item = ORDINAL_MAP[itemOrdinalMatch[1].toLowerCase()];
  }

  // --- SFS-nummer: "SFS 1998:808" eller "1998:808" ---
  const sfsExplicit = clean.match(/\bSFS\s*(\d{4}:\d{3,4})\b/i);
  if (sfsExplicit) {
    const lawName = SFS_TO_LAW[sfsExplicit[1]];
    return lawName ? { lawName, subsection, item } : null;
  }

  // --- Lagförkortning: "MB", "PBL" etc. ---
  const lawMatch = clean.match(/\b(mb|pbl|osl|brb|lso)\b/i);
  const lawName = lawMatch
    ? LAW_ABBREVIATIONS[lawMatch[1].toLowerCase()]
    : undefined;

  // Uttryckt lagnamn: "Miljöbalken", "miljöbalken"
  const explicitLaw = clean.match(
    /\b(miljöbalken|plan-?\s*och\s*bygglagen|brottsbalken|offentlighets-?\s*och\s*sekretesslagen)\b/i,
  );
  const resolvedLaw = lawName ?? (explicitLaw ? explicitLaw[1] : 'Miljöbalken');

  // --- Mönster 1: "2 kap. 6 a §" eller "2 kap 6 §" ---
  const m1 = clean.match(/(\d+)\s*kap\.?\s*(\d+\s*[a-z]?)\s*§/i);
  if (m1) {
    return {
      lawName: resolvedLaw,
      chapter: m1[1],
      paragraph: m1[2].replace(/\s+/g, ''),
      subsection,
      item,
    };
  }

  // --- Mönster 2: "6 a § 2 kap" (omvänd ordning) ---
  const m2 = clean.match(/(\d+\s*[a-z]?)\s*§\s*(?:i\s*)?(\d+)\s*kap/i);
  if (m2) {
    return {
      lawName: resolvedLaw,
      chapter: m2[2],
      paragraph: m2[1].replace(/\s+/g, ''),
      subsection,
      item,
    };
  }

  // --- Mönster 3: Kompakt "MB 2:6" eller "2:6" ---
  const m3 = clean.match(/\b(\d+):(\d+[a-z]?)\b/);
  if (m3) {
    return {
      lawName: resolvedLaw,
      chapter: m3[1],
      paragraph: m3[2],
      subsection,
      item,
    };
  }

  // --- Enbart lagnamn utan lagrum (t.ex. "SFS 1998:808" utan kap/§) ---
  if (lawName || explicitLaw) {
    return { lawName: resolvedLaw, subsection, item };
  }

  return null;
}

/**
 * Normaliserar paragrafnummer till kanonisk form.
 * Ex: "6 a" → "6a", "12 b" → "12b"
 */
export function normalizeParagraph(paragraph: string): string {
  return paragraph.replace(/\s+/g, '').toLowerCase();
}
