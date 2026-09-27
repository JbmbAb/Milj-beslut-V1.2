// @vitest-environment node
/**
 * DEMO-01 guardrails as RED/GREEN probes: no row without source or marker, counts not
 * percentages, "ej analyserat" instead of defaults, K-24 rows rejected rather than repaired,
 * verbatim MPF paragraphs, row-by-row approval, frozen JSON as the only PDF input.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyDecisions, freezeApproval, FROZEN_SCHEMA, type FrozenProposal } from '../../approvalGate';
import { canonicalJson, freeze, loadFrozen, saveCase, loadCase } from '../../caseStore';
import { extractMpfParagraph, j3Caveat } from '../../legalCitation';
import { localizationRows, NOT_ANALYZED_INCOMPLETE, NOT_ANALYZED_MISSING, type LayerFacts } from '../../localization';
import { ANMALAN_TITLE, EGENKONTROLL_TITLE, renderAnmalanPdf, renderEgenkontrollPdf } from '../../pdf';
import { assertEveryRowHasProvenance, buildProposalRows, INSUFFICIENT } from '../../proposalEngine';
import { loadRequirements, parseReadmeHashes, parseRequirementRow, type RequirementRow } from '../../requirementsSource';
import type { DemoCase, DemoCaseInput, ProposalRow } from '../../types';

const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);
let tmp: string;

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'demo01-'));
  process.env.DEMO_C_ANMALAN_DATA_DIR = path.join(tmp, 'data');
  process.env.DEMO_RELEASE_SHA = 'test-release-sha';
});
afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
  delete process.env.DEMO_C_ANMALAN_DATA_DIR;
  delete process.env.DEMO_RELEASE_SHA;
});

const input = (over: Partial<DemoCaseInput> = {}): DemoCaseInput => ({
  propertyDesignation: 'TESTBY 1:1', verksamhetskoder: ['90.40'], avfallstyper: '17 05 04', mangdPerArTon: '', maxSamtidigtLagradTon: '',
  verksamhetsutovare: 'Testbolaget', ytansKonstruktion: '', jordart: '', lutningAvrinning: '', dagvatten: '', placeholder: false, ...over,
});

const req = (over: Partial<RequirementRow> = {}): RequirementRow => ({
  row_id: 'r1', document_sha256: SHA_A, page: 2, chunk_id: 'c1', kommun: 'Testkommun', diarienummer: 'MBN 2024-1', dokumenttyp: 'beslut',
  beslutsdatum: null, mpf_kod: '90.40', krav_typ: 'villkor', citat: 'Massorna ska lagras på hårdgjord yta.', metod: null, frekvens: null,
  ansvarig: null, dokumentationskrav: null, extraction_rule_id: 'rule-yta', verified: false, person_masked: true, ...over,
});

const facts = (over: Partial<LayerFacts> = {}): LayerFacts => ({
  propertyFound: true, municipality: 'TESTKOMMUN', areaM2: 1000, parts: 1,
  wells: { within100: 0, within300: 1, nearestM: 150, uses300: [{ distM: 150, anvandning: 'Energibrunn' }] },
  ebh: { within500: 0, nearestM: null }, protectedArea: { intersects: 0, within500: 0 }, natura2000: { within1000: 0 },
  waterProtection: { within500: 0 }, catchment: [], stability: { landslide500: 0, msbStab500: 0, fastmarkIntersect: 0, aktsamhetIntersect: 0 },
  flood: { intersects: 0 }, nyckelbiotop: { within500: 0 },
  soil: { soilTypeIntersects: 0, soil25kIntersects: 0, soilTypeRows: 0, soil25kRows: 999999 },
  surfaceWaterLayerPresent: false, demLayerPresent: false,
  batches: Object.fromEntries(
    ['env.registerenhetsomradesytor', 'env.sgu_well', 'env.ebh_potentiellt_fororenade_omraden', 'env.protected_area', 'env.natura2000_area',
      'env.water_protection_area', 'hydro.water_catchment', 'env.sgu_landslide_feature', 'climate.flood_risk_area', 'env.sks_nyckelbiotoper',
      'env.sgu_soil_type_25k_100k'].map((layer) => [layer, { layer, dataset_version: '2026-06-19', row_count: 1, content_bundle_sha256: SHA_B }]),
  ),
  ...over,
});

describe('guardrail: every row has a source or a marker', () => {
  it('RED: a row without provenance is refused', () => {
    expect(() => assertEveryRowHasProvenance([{ id: 'x', section: 'verksamhet', label: 'x', text: 'x' } as ProposalRow])).toThrow(/no provenance/);
  });
  it('RED: corpus row without SHA + page is refused', () => {
    const row: ProposalRow = { id: 'x', section: 'forsiktighetsmatt', label: 'x', text: 'x',
      provenance: { kind: 'municipal_corpus', rowId: 'r', documentSha256: 'nope', page: 0, kommun: 'k', diarienummer: '', verified: false } };
    expect(() => assertEveryRowHasProvenance([row])).toThrow(/without SHA \+ page/);
  });
  it('RED: a layer fact without bundle hash is refused unless it says "ej analyserat"', () => {
    const base: ProposalRow = { id: 'x', section: 'lokalisering', label: 'x', text: '0 inom 500 m',
      provenance: { kind: 'mimer_layer', layer: 'env.x', datasetVersion: null, bundleSha256: null, query: 'q' } };
    expect(() => assertEveryRowHasProvenance([base])).toThrow(/without bundle hash/);
    expect(() => assertEveryRowHasProvenance([{ ...base, text: `${NOT_ANALYZED_MISSING}: x` }])).not.toThrow();
  });
  it('RED: percentages and PROVEN-wording in Mimer text are refused', () => {
    const p = { kind: 'template_default' as const, templateId: 't' };
    expect(() => assertEveryRowHasProvenance([{ id: 'a', section: 'egenkontroll', label: 'förekommer i 40 %', text: 'x', provenance: p }])).toThrow(/percentage/);
    expect(() => assertEveryRowHasProvenance([{ id: 'b', section: 'egenkontroll', label: 'x', text: 'x', note: 'PROVEN', provenance: p }])).toThrow(/forbidden/);
  });
  it('GREEN: a full proposal passes, empty user fields are marked, not filled', () => {
    const rows = buildProposalRows({ input: input(), localization: localizationRows(facts()), citations: [], requirements: [req()], coverage: [], municipality: 'Testkommun' });
    expect(rows.find((r) => r.id === 'user-jordart')?.text).toBe('användarens uppgift – ej ifylld');
    expect(() => assertEveryRowHasProvenance(rows)).not.toThrow();
  });
});

describe('proposal engine: counts, not percentages; n < 3 marked', () => {
  it('counts distinct documents per (code, rule) and marks n < 3', () => {
    const rows = buildProposalRows({
      input: input(), localization: [], citations: [], municipality: 'Testkommun',
      requirements: [req(), req({ row_id: 'r2', document_sha256: SHA_B, kommun: 'Annan' })],
      coverage: [{ kommun: 'Testkommun', mpf_kod: '90.40', n_dokument: 5 }, { kommun: 'Annan', mpf_kod: '90.40', n_dokument: 4 }],
    });
    const corpus = rows.find((r) => r.id === 'korpus-90.40-rule-yta')!;
    expect(corpus.label).toContain('regel rule-yta träffar i 2 handlingar av 9 med kod 90.40, 2 kommuner; citatet är ett exempel ur en av dem');
    expect(corpus.note).toContain(INSUFFICIENT);
    expect(corpus.note).toContain('ej manuellt kontrollerad');
    expect(corpus.label).not.toMatch(/%/);
  });
  it('prefers a manually verified source row as the quote', () => {
    const rows = buildProposalRows({ input: input(), localization: [], citations: [], coverage: [], municipality: null,
      requirements: [req(), req({ row_id: 'r0', verified: true, citat: 'Verifierad formulering.' })] });
    const corpus = rows.find((r) => r.section === 'forsiktighetsmatt' && r.provenance.kind === 'municipal_corpus')!;
    expect(corpus.text).toBe('Verifierad formulering.');
    expect(corpus.provenance.kind === 'municipal_corpus' && corpus.provenance.verified).toBe(true);
  });
  it('kontrollpunkt rows land in egenkontroll; missing fields are the user\'s task', () => {
    const rows = buildProposalRows({ input: input(), localization: [], citations: [], coverage: [], municipality: null,
      requirements: [req({ krav_typ: 'kontrollpunkt', frekvens: 'en gång per år', extraction_rule_id: 'rule-kontroll' })] });
    const k = rows.find((r) => r.section === 'egenkontroll' && r.provenance.kind === 'municipal_corpus')!;
    expect(k.control).toMatchObject({ frekvens: 'en gång per år', metod: 'användarens uppgift – ej ifylld', avvikelse: 'användarens uppgift – ej ifylld' });
  });
});

describe('localization: "ej analyserat", never a default', () => {
  it('soil gap, missing DEM and missing hydrography become "ej analyserat" with the user\'s task noted', () => {
    const rows = localizationRows(facts());
    expect(rows.find((r) => r.id === 'lok-jordart')?.text).toMatch(new RegExp(`^${NOT_ANALYZED_INCOMPLETE}`));
    expect(rows.find((r) => r.id === 'lok-lutning')?.text).toMatch(new RegExp(`^${NOT_ANALYZED_MISSING}`));
    expect(rows.find((r) => r.id === 'lok-ytvatten')?.text).toMatch(new RegExp(`^${NOT_ANALYZED_MISSING}`));
    expect(rows.find((r) => r.id === 'lok-natura2000')?.note).toMatch(/ofullständigt/);
  });
  it('carries batch and bundle hash per layer', () => {
    const well = localizationRows(facts()).find((r) => r.id === 'lok-brunnar')!;
    expect(well.text).toBe('0 inom 100 m; 1 inom 300 m (1 Energibrunn); närmaste 150 m');
    expect(well.provenance).toMatchObject({ kind: 'mimer_layer', layer: 'env.sgu_well', bundleSha256: SHA_B, datasetVersion: '2026-06-19' });
  });
  it('a fact from a layer without a bound import batch is not shown, it becomes "ej analyserat"', () => {
    const f = facts();
    delete f.batches['env.ebh_potentiellt_fororenade_omraden'];
    const ebh = localizationRows(f).find((r) => r.id === 'lok-ebh')!;
    expect(ebh.text).toBe(`${NOT_ANALYZED_MISSING}: ingen bunden importbatch för env.ebh_potentiellt_fororenade_omraden`);
    expect(() => assertEveryRowHasProvenance(localizationRows(f))).not.toThrow();
  });
  it('unknown property yields one "ej analyserat" row and no facts', () => {
    const rows = localizationRows(facts({ propertyFound: false }));
    expect(rows).toHaveLength(1);
    expect(rows[0].text).toMatch(/^ej analyserat/);
  });
});

describe('MPF citation: verbatim paragraph, no interpretation', () => {
  const text = [
    '29 kap. Avfall', 'Lagring som en del av insamling',
    '48 § Tillståndsplikt B och verksamhetskod 90.30 gäller för att \nlagra icke-farligt avfall, om', '1. mer än 30 000 ton, eller',
    '49 § Anmälningsplikt C och verksamhetskod 90.40 gäller för att \nlagra icke-farligt avfall.', 'Förordning (2025:660).',
    'Uppgrävda massor', '56 § Tillståndsplikt B och verksamhetskod 90.408-i gäller.',
  ].join('\n\n');
  it('extracts the paragraph with its own prövningsnivå and stops at the next paragraph', () => {
    const hit = extractMpfParagraph(text, '90.30')!;
    expect(hit.paragraph).toBe('29 kap. 48 § MPF');
    expect(hit.provningsniva).toBe('Tillståndsplikt B');
    expect(hit.text).toBe('48 § Tillståndsplikt B och verksamhetskod 90.30 gäller för att lagra icke-farligt avfall, om\n1. mer än 30 000 ton, eller');
  });
  it('stops at a heading and does not confuse 90.40 with 90.408-i', () => {
    const hit = extractMpfParagraph(text, '90.40')!;
    expect(hit.text.endsWith('Förordning (2025:660).')).toBe(true);
    expect(hit.text).not.toContain('Uppgrävda');
    expect(extractMpfParagraph(text, '90.4')).toBeNull();
  });
  it('carries the J-3 caveat', () => {
    expect(j3Caveat('2026-08-09')).toBe('korpus hämtad 2026-08-09, giltighetsdatum ej bundet (J-3)');
  });
});

describe('K-24 consumer: reject, never repair', () => {
  const ok = { ...req(), page: 3 };
  it.each([
    ['missing page', { page: '' }],
    ['missing kommun', { kommun: '' }],
    ['bad sha', { document_sha256: 'abc' }],
    ['unmasked', { person_masked: false }],
    ['unknown krav_typ', { krav_typ: 'rekommendation' }],
    ['mojibake quote', { citat: 'Massorna ska lagras pÃ¥ hÃ¥rdgjord yta.' }],
    ['mojibake krav_typ', { krav_typ: 'fÃ¶rsiktighetsmÃ¥tt' }],
  ])('RED: %s', (_n, over) => {
    expect(parseRequirementRow({ ...ok, ...over })).toBeNull();
  });
  it('GREEN: valid row; decomposed å/ä/ö compares equal to composed', () => {
    expect(parseRequirementRow(ok)).not.toBeNull();
    expect(parseRequirementRow({ ...ok, krav_typ: 'försiktighetsmått'.normalize('NFD') })?.krav_typ).toBe('försiktighetsmått');
  });
  it('refuses a delivery whose file hash does not match README.md', () => {
    const dir = path.join(tmp, 'corpus');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'requirements.jsonl'), `${JSON.stringify(ok)}\n`);
    fs.writeFileSync(path.join(dir, 'README.md'), `- requirements.jsonl — ${'0'.repeat(64)}\n`);
    expect(loadRequirements(dir).status.state).toBe('invalid');
    expect(parseReadmeHashes('- requirements.jsonl — ' + SHA_A).get('requirements.jsonl')).toBe(SHA_A);
  });
  it('reports "missing" when nothing is delivered', () => {
    expect(loadRequirements(path.join(tmp, 'nothing-here')).status.state).toBe('missing');
  });
});

describe('approval gate + frozen JSON + PDF', () => {
  const baseRows = () =>
    buildProposalRows({ input: input(), localization: localizationRows(facts()), citations: [], requirements: [req()], coverage: [], municipality: null });

  it('RED: approval with undecided rows is refused', () => {
    const rows = baseRows();
    expect(() => applyDecisions(rows, [{ rowId: rows[0].id, action: 'accept' }])).toThrow(/^undecided_rows/);
  });
  it('an edited row becomes the user\'s text and keeps the original source alongside', () => {
    const rows = baseRows();
    const target = rows.find((r) => r.provenance.kind === 'municipal_corpus')!;
    const { approved, struck } = applyDecisions(rows, rows.map((r) =>
      r.id === target.id ? { rowId: r.id, action: 'edit' as const, text: 'Egen formulering.' } : r.id === 'user-jordart' ? { rowId: r.id, action: 'strike' as const } : { rowId: r.id, action: 'accept' as const }));
    const edited = approved.find((r) => r.id === target.id)!;
    expect(edited.provenance).toEqual({ kind: 'user_input', field: `redigerad:${target.id}` });
    expect(edited.editedFrom).toEqual(target.provenance);
    expect(struck).toEqual(['user-jordart']);
  });
  it('freezing is content-addressed, key-order independent and tamper-evident', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe(canonicalJson({ a: { c: 3, d: 2 }, b: 1 }));
    const f = freeze({ b: 1, a: 2 });
    expect(path.basename(f.path)).toBe(`${f.sha256}.json`);
    fs.writeFileSync(f.path, fs.readFileSync(f.path, 'utf8').replace('2', '3'));
    expect(() => loadFrozen(f.sha256)).toThrow(/frozen_hash_mismatch/);
  });
  it('case JSON has a sha256 sidecar and a changed file is refused', () => {
    const c: DemoCase = { id: 'demo01-abcdef-12345678', createdAt: '', updatedAt: '', createdByUserId: 'u', organisationId: 'o', input: input(), status: 'DRAFT' };
    saveCase(c);
    expect(loadCase(c.id)?.id).toBe(c.id);
    const file = path.join(process.env.DEMO_C_ANMALAN_DATA_DIR!, 'cases', `${c.id}.json`);
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('Testbolaget', 'Annat'));
    expect(() => loadCase(c.id)).toThrow(/case_hash_mismatch/);
  });

  it('PDFs: titles, marking, release SHA + frozen hash on every page, no blank pages', async () => {
    const rows = baseRows();
    const record: DemoCase = {
      id: 'demo01-pdftest-00000000', createdAt: '', updatedAt: '', createdByUserId: 'u', organisationId: 'o', input: input(), status: 'PROPOSED',
      proposal: { generatedAt: 'now', rows, inputs: { requirements: { state: 'loaded', dir: 'x', message: 'ok' }, localizationLabel: 'Lokalisering: ej governed', legalCorpusCaveat: '' } },
    };
    const frozen = freezeApproval(record, rows.map((r) => ({ rowId: r.id, action: 'accept' as const })), 'u');
    const { document } = loadFrozen(frozen.sha256);
    expect((document as FrozenProposal).schema).toBe(FROZEN_SCHEMA);
    const { PDFParse } = await import('pdf-parse');
    for (const [render, title] of [[renderAnmalanPdf, ANMALAN_TITLE], [renderEgenkontrollPdf, EGENKONTROLL_TITLE]] as const) {
      const buf = await render(document as FrozenProposal, frozen.sha256);
      const parsed = await new PDFParse({ data: new Uint8Array(buf) }).getText();
      const full = parsed.text.replace(/\s+/g, ' ');
      expect(full).toContain(title);
      expect(full).toContain('FÖRSLAG – EJ INLÄMNAD');
      expect(full).not.toMatch(/\bPROVEN\b|verifierad av Mimer|Compliant/);
      parsed.pages.forEach((p: { text: string }, i: number) => {
        const t = p.text.replace(/\s+/g, ' ');
        expect(t).toContain('release test-release-sha');
        expect(t).toContain(frozen.sha256.slice(0, 40));
        expect(t).toContain(`sida ${i + 1} av ${parsed.pages.length}`);
        // A page holding nothing but the footer is a blank page.
        expect(t.replace(/Förslag – ej inlämnad · release.*$/, '').trim().length).toBeGreaterThan(40);
      });
    }
  });
});
