/**
 * D3 förslagsmotor (DEMO-01). Pure: case input + layer rows + MPF citations + K-24 rows → rows.
 *
 * No text is generated. A row is either the user's own input, a verbatim corpus quote with
 * document SHA + page, a verbatim legal-corpus quote, a Mimer layer fact, or a marked template
 * default. Counts, never percentages; n < 3 → "otillräckligt underlag".
 */
import type { MpfCitation } from './legalCitation';
import type { CoverageRow, RequirementRow } from './requirementsSource';
import type { DemoCaseInput, ProposalRow, ProposalSectionId, UnderlagRef } from './types';

export const INSUFFICIENT = 'otillräckligt underlag';
export const MIN_N = 3;
const USER_MISSING = 'användarens uppgift – ej ifylld';
const PLACEHOLDER_NOTE = 'platshållare – användarens underlag är inte inläst';
export const FICTIONAL_NOTE = 'fiktiv uppgift (demo) – ej verklig';

function userRow(
  input: DemoCaseInput,
  underlag: UnderlagRef | undefined,
  section: ProposalSectionId,
  field: keyof DemoCaseInput,
  label: string,
): ProposalRow {
  const raw = input[field];
  const value = Array.isArray(raw) ? raw.join(', ') : String(raw ?? '').trim();
  const sources = value ? underlag?.fieldSources[field] : undefined;
  const fictional = Boolean(value && underlag?.fictional);
  return {
    id: `user-${field}`,
    section,
    label,
    text: value || USER_MISSING,
    provenance: { kind: 'user_input', field, ...(sources?.length ? { sources } : {}), ...(fictional ? { fictional } : {}) },
    note: [input.placeholder && value ? PLACEHOLDER_NOTE : null, fictional ? FICTIONAL_NOTE : null].filter(Boolean).join('; ') || undefined,
  };
}

function legalRows(citations: MpfCitation[]): ProposalRow[] {
  return citations.map((c) => ({
    id: `mpf-${c.code}`,
    section: 'verksamhet' as const,
    label: `Verksamhetskod ${c.code}: ${c.paragraph ?? 'paragraf ej funnen'}`,
    text: c.found ? (c.text as string) : `Paragrafen för kod ${c.code} finns inte i ${c.recordKey}; koden kontrolleras av användaren.`,
    provenance: {
      kind: 'legal_corpus' as const,
      recordKey: c.recordKey,
      contentHash: c.contentHash ?? '',
      paragraph: c.paragraph ?? '',
      caveat: c.caveat,
    },
    note: [c.provningsniva ? `prövningsnivå enligt paragrafen: ${c.provningsniva}` : null, c.caveat].filter(Boolean).join('; '),
  }));
}

const SECTION_BY_KRAV: Record<RequirementRow['krav_typ'], ProposalSectionId> = {
  försiktighetsmått: 'forsiktighetsmatt',
  villkor: 'forsiktighetsmatt',
  kontrollpunkt: 'egenkontroll',
  kompletteringskrav: 'teknisk_beskrivning',
};

/**
 * One row per (kod, extraction_rule_id): the rule is the deterministic unit D2 extracts, so the
 * count "förekommer i N beslut" is the number of distinct documents where that rule fired.
 * The quoted text is one concrete source row (manually verified rows first, then own municipality).
 */
function corpusRows(rows: RequirementRow[], codes: string[], coverage: CoverageRow[], municipality: string | null): ProposalRow[] {
  const out: ProposalRow[] = [];
  const muni = municipality?.toLowerCase() ?? null;
  for (const code of codes) {
    const forCode = rows.filter((r) => r.mpf_kod === code);
    const totalDocs = coverage.filter((c) => c.mpf_kod === code).reduce((s, c) => s + c.n_dokument, 0);
    const byRule = new Map<string, RequirementRow[]>();
    for (const r of forCode) byRule.set(r.extraction_rule_id, [...(byRule.get(r.extraction_rule_id) ?? []), r]);
    for (const [rule, group] of [...byRule].sort(([a], [b]) => a.localeCompare(b))) {
      const docs = new Set(group.map((g) => g.document_sha256)).size;
      const kommuner = new Set(group.map((g) => g.kommun)).size;
      const pick = [...group].sort(
        (a, b) =>
          Number(b.verified) - Number(a.verified) ||
          Number(b.kommun.toLowerCase() === muni) - Number(a.kommun.toLowerCase() === muni) ||
          a.row_id.localeCompare(b.row_id),
      )[0];
      // The count belongs to the extraction rule, not to the quoted sentence: say so.
      const countText = `regel ${rule} träffar i ${docs} ${docs === 1 ? 'handling' : 'handlingar'}${totalDocs ? ` av ${totalDocs}` : ''} med kod ${code}, ${kommuner} ${kommuner === 1 ? 'kommun' : 'kommuner'}; citatet är ett exempel ur en av dem`;
      const control =
        pick.krav_typ === 'kontrollpunkt'
          ? {
              frekvens: pick.frekvens ?? USER_MISSING,
              metod: pick.metod ?? USER_MISSING,
              ansvarig: pick.ansvarig ?? USER_MISSING,
              dokumentation: pick.dokumentationskrav ?? USER_MISSING,
              avvikelse: USER_MISSING,
            }
          : undefined;
      out.push({
        id: `korpus-${code}-${rule}`,
        section: SECTION_BY_KRAV[pick.krav_typ],
        label: `${pick.krav_typ} (${countText})`,
        text: pick.citat,
        provenance: {
          kind: 'municipal_corpus',
          rowId: pick.row_id,
          documentSha256: pick.document_sha256,
          page: pick.page,
          kommun: pick.kommun,
          diarienummer: pick.diarienummer,
          verified: pick.verified,
        },
        note: [
          docs < MIN_N ? INSUFFICIENT : null,
          pick.verified ? null : 'automatiskt extraherad, ej manuellt kontrollerad',
        ]
          .filter(Boolean)
          .join('; ') || undefined,
        control,
      });
    }
  }
  return out;
}

export function buildProposalRows(args: {
  input: DemoCaseInput;
  underlag?: UnderlagRef;
  localization: ProposalRow[];
  citations: MpfCitation[];
  requirements: RequirementRow[];
  coverage: CoverageRow[];
  municipality: string | null;
}): ProposalRow[] {
  const { input } = args;
  const u = (section: ProposalSectionId, field: keyof DemoCaseInput, label: string) => userRow(input, args.underlag, section, field, label);
  const corpus = corpusRows(args.requirements, input.verksamhetskoder, args.coverage, args.municipality);
  const rows: ProposalRow[] = [
    u('verksamhetsutovare', 'verksamhetsutovare', 'Verksamhetsutövare'),
    u('verksamhetsutovare', 'propertyDesignation', 'Fastighet'),
    u('verksamhet', 'verksamhetsbeskrivning', 'Verksamhetsbeskrivning'),
    u('verksamhet', 'verksamhetskoder', 'Verksamhetskod(er), valda av användaren'),
    ...legalRows(args.citations),
    u('verksamhet', 'avfallstyper', 'Avfallstyper (EWC)'),
    u('verksamhet', 'mangdPerArTon', 'Mängd per år (ton)'),
    u('verksamhet', 'maxSamtidigtLagradTon', 'Största mängd lagrad vid något tillfälle (ton)'),
    ...args.localization,
    u('teknisk_beskrivning', 'ytansKonstruktion', 'Lagringsytans konstruktion (tätskikt, bärlager)'),
    u('teknisk_beskrivning', 'jordart', 'Jordart under ytan'),
    u('teknisk_beskrivning', 'lutningAvrinning', 'Lutning och avrinning'),
    u('teknisk_beskrivning', 'dagvatten', 'Dagvattenhantering'),
    ...corpus.filter((r) => r.section === 'teknisk_beskrivning'),
    u('forsiktighetsmatt', 'anvandarensForsiktighetsmatt', 'Verksamhetsutövarens försiktighetsmått (damm, buller, transporter)'),
    ...corpus.filter((r) => r.section === 'forsiktighetsmatt'),
    u('egenkontroll', 'anvandarensEgenkontroll', 'Verksamhetsutövarens kontrollrutiner'),
    ...corpus.filter((r) => r.section === 'egenkontroll'),
  ];
  assertEveryRowHasProvenance(rows);
  return rows;
}

const FORBIDDEN_WORDS = /\b(PROVEN|verifierad|verified|compliant|juridiskt säkrad|garanterad)\b/i;
const SHA = /^[a-f0-9]{64}$/;

/** The guardrail as code: throws on any row without a valid source or marker. */
export function assertEveryRowHasProvenance(rows: ProposalRow[]): void {
  const problems: string[] = [];
  const ids = new Set<string>();
  for (const r of rows) {
    if (ids.has(r.id)) problems.push(`${r.id}: duplicate id`);
    ids.add(r.id);
    const p = r.provenance as ProposalRow['provenance'] | undefined;
    if (!p) {
      problems.push(`${r.id}: no provenance`);
      continue;
    }
    if (!r.text?.trim()) problems.push(`${r.id}: empty text`);
    // Only Mimer's own wording (label, note) is checked; quoted text and user input stay verbatim.
    if (FORBIDDEN_WORDS.test(`${r.label} ${r.note ?? ''}`)) problems.push(`${r.id}: forbidden wording`);
    if (p.kind !== 'user_input' && /\d\s?%/.test(`${r.label} ${r.note ?? ''}`)) problems.push(`${r.id}: percentage (counts only)`);
    switch (p.kind) {
      case 'municipal_corpus':
        if (!SHA.test(p.documentSha256) || !(p.page >= 1)) problems.push(`${r.id}: corpus row without SHA + page`);
        break;
      case 'legal_corpus':
        if (!p.recordKey || !p.caveat) problems.push(`${r.id}: legal row without record key / caveat`);
        break;
      case 'mimer_layer':
        if (!p.layer) problems.push(`${r.id}: layer row without layer`);
        if (!p.bundleSha256 && !r.text.startsWith('ej analyserat')) problems.push(`${r.id}: layer fact without bundle hash`);
        break;
      case 'user_input':
        if (!p.field) problems.push(`${r.id}: user row without field`);
        break;
      case 'template_default':
        if (!p.templateId) problems.push(`${r.id}: template row without template id`);
        break;
      default:
        problems.push(`${r.id}: unknown provenance kind`);
    }
  }
  if (problems.length) throw new Error(`proposal_guardrail_violation: ${problems.join(' | ')}`);
}
