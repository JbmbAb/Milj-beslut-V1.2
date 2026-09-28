// @vitest-environment node
/**
 * K-94b egenkontroll table: rows from a template whose structure comes from municipal programmes
 * (no names, reference numbers or quotes), cells only from the user's underlag (verbatim, with
 * file source) or "ej ifylld". Rendered as a six-column table in the egenkontroll PDF.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { freezeApproval, type FrozenProposal } from '../../approvalGate';
import { loadFrozen, sha256 } from '../../caseStore';
import {
  CONTROL_FIELDS,
  EGENKONTROLL_POINTS,
  EGENKONTROLL_SOURCE_DOCUMENTS,
  EGENKONTROLL_TEMPLATE_ID,
} from '../../egenkontrollTemplate';
import { renderEgenkontrollPdf } from '../../pdf';
import { assertEveryRowHasProvenance, buildProposalRows } from '../../proposalEngine';
import type { DemoCase, DemoCaseInput, ProposalRow } from '../../types';
import { loadUnderlag, type UnderlagMapping } from '../../underlagLoader';

const MISSING = 'användarens uppgift – ej ifylld';
const B2 = '# B2\n\nVarje inkommande lass ska ha:\n- datum\n\nOkulär kontroll görs före lossning.\n\n- Ansvarig: driftansvarig på plats.\n';
let tmp: string;
let dir: string;

const baseInput: DemoCaseInput = {
  propertyDesignation: 'TESTBY 1:1', verksamhetskoder: ['90.40'], avfallstyper: '', mangdPerArTon: '', maxSamtidigtLagradTon: '',
  verksamhetsutovare: '', ytansKonstruktion: '', jordart: '', lutningAvrinning: '', dagvatten: '', placeholder: false,
};
const mapping = (egenkontroll: UnderlagMapping['egenkontroll']): UnderlagMapping => ({
  label: 'underlag', archiveSha256: 'c'.repeat(64), propertyDesignation: 'TESTBY 1:1',
  verksamhetskoder: { values: ['90.40'], from: [{ file: 'A2.md', excerpt: 'kod 90.40' }] }, fields: {}, egenkontroll,
});

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'demo01-ek-'));
  dir = path.join(tmp, 'underlag');
  fs.mkdirSync(dir);
  process.env.DEMO_C_ANMALAN_DATA_DIR = path.join(tmp, 'data');
  process.env.DEMO_RELEASE_SHA = 'test-release';
  fs.writeFileSync(path.join(dir, 'README.md'), 'FIKTIV DEMODATA\n');
  fs.writeFileSync(path.join(dir, 'A2.md'), 'kod 90.40\n');
  fs.writeFileSync(path.join(dir, 'B2-kontroll.md'), B2);
});
afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
  delete process.env.DEMO_C_ANMALAN_DATA_DIR;
  delete process.env.DEMO_RELEASE_SHA;
});

describe('egenkontroll template (structure only)', () => {
  it('has 14 generic control points and names its 14 source programmes by sha256 only', () => {
    expect(EGENKONTROLL_POINTS).toHaveLength(14);
    expect(EGENKONTROLL_SOURCE_DOCUMENTS).toHaveLength(14);
    expect(EGENKONTROLL_SOURCE_DOCUMENTS.every((h) => /^[a-f0-9]{64}$/.test(h))).toBe(true);
  });
  it('contains no reference numbers, dates, names or quotes from the programmes', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../../egenkontrollTemplate.ts'), 'utf8').replace(/'[a-f0-9]{64}'/g, '');
    expect(src).not.toMatch(/\bdnr\b|\b(19|20)\d{2}-\d{1,2}|MBN|MN-|SBF-|TK-|kommun\b[^a]/i);
    expect(src).not.toMatch(/\.pdf\b/i);
  });
});

describe('egenkontroll rows', () => {
  it('without underlag: all template rows, every cell "ej ifylld", mallstandard provenance', () => {
    const rows = buildProposalRows({ input: baseInput, localization: [], citations: [], requirements: [], coverage: [], municipality: null });
    const ek = rows.filter((r) => r.id.startsWith('ek-'));
    expect(ek.map((r) => r.label)).toEqual(EGENKONTROLL_POINTS.map((p) => p.kontrollpunkt));
    for (const r of ek) {
      expect(r.provenance).toEqual({ kind: 'template_default', templateId: EGENKONTROLL_TEMPLATE_ID });
      expect(r.note).toContain('struktur ur kommunala egenkontrollprogram i korpusen');
      expect(CONTROL_FIELDS.every((f) => r.control![f] === MISSING)).toBe(true);
      expect(r.controlSources).toBeUndefined();
    }
    expect(rows.some((r) => r.id === 'user-anvandarensEgenkontroll')).toBe(true);
  });

  it('with underlag: cells quoted verbatim with file source; the free-text row is not duplicated', () => {
    const { input, underlag } = loadUnderlag(dir, mapping({
      mottagning: { frekvens: [{ file: 'B2-kontroll.md', excerpt: 'Varje inkommande lass' }], metod: [{ file: 'B2-kontroll.md', excerpt: 'Okulär kontroll görs före lossning.' }] },
      yta: { ansvarig: [{ file: 'B2-kontroll.md', excerpt: 'driftansvarig på plats' }] },
    }));
    const rows = buildProposalRows({ input, underlag, localization: [], citations: [], requirements: [], coverage: [], municipality: null });
    const mott = rows.find((r) => r.id === 'ek-mottagning')!;
    expect(mott.control).toMatchObject({ frekvens: 'Varje inkommande lass', metod: 'Okulär kontroll görs före lossning.', ansvarig: MISSING });
    expect(mott.controlSources?.frekvens).toEqual([{ file: 'B2-kontroll.md', sha256: sha256(B2) }]);
    expect(mott.note).toMatch(/fiktiv/);
    expect(rows.find((r) => r.id === 'ek-damm')!.controlSources).toBeUndefined();
    expect(rows.some((r) => r.id === 'user-anvandarensEgenkontroll')).toBe(false);
    expect(() => assertEveryRowHasProvenance(rows)).not.toThrow();
  });

  it.each([
    ['an unknown control point', { finns_inte: { frekvens: [{ file: 'B2-kontroll.md', excerpt: 'Veckovis' }] } }, /unknown_egenkontroll_point/],
    ['an unknown column', { mottagning: { gransvarde: [{ file: 'B2-kontroll.md', excerpt: 'Varje' }] } }, /unknown_egenkontroll_field/],
    ['a cell that is not verbatim', { mottagning: { frekvens: [{ file: 'B2-kontroll.md', excerpt: 'Varje dag' }] } }, /excerpt_not_verbatim/],
  ])('RED: refuses %s', (_n, ek, err) => {
    expect(() => loadUnderlag(dir, mapping(ek as UnderlagMapping['egenkontroll']))).toThrow(err);
  });

  it('RED: a cell source without sha256 is refused by the guard', () => {
    const rows = buildProposalRows({ input: baseInput, localization: [], citations: [], requirements: [], coverage: [], municipality: null });
    const bad = rows.map((r) => (r.id === 'ek-yta' ? { ...r, controlSources: { frekvens: [{ file: 'B2.md', sha256: 'x' }] } } : r)) as ProposalRow[];
    expect(() => assertEveryRowHasProvenance(bad)).toThrow(/cell frekvens without file \+ sha256/);
  });
});

describe('egenkontroll PDF table', () => {
  it('six columns, source tags on user cells, "ej ifylld" elsewhere, struck points absent', async () => {
    const { input, underlag } = loadUnderlag(dir, mapping({
      mottagning: { metod: [{ file: 'B2-kontroll.md', excerpt: 'Okulär kontroll görs före lossning.' }] },
    }));
    const rows = buildProposalRows({ input, underlag, localization: [], citations: [], requirements: [], coverage: [], municipality: null });
    const record: DemoCase = {
      id: 'demo01-ek-00000001', createdAt: '', updatedAt: '', createdByUserId: 'u', organisationId: 'o', input, underlag, status: 'PROPOSED',
      proposal: { generatedAt: 'now', rows, inputs: { requirements: { state: 'missing', dir: 'x', message: 'ej levererad' }, localizationLabel: 'x', legalCorpusCaveat: '' } },
    };
    const frozen = freezeApproval(record, rows.map((r) => ({ rowId: r.id, action: r.id === 'ek-buller' ? ('strike' as const) : ('accept' as const) })), 'u');
    const buf = await renderEgenkontrollPdf(loadFrozen(frozen.sha256).document as FrozenProposal, frozen.sha256);
    const { PDFParse } = await import('pdf-parse');
    const text = (await new PDFParse({ data: new Uint8Array(buf) }).getText()).text.replace(/\s+/g, ' ');
    for (const h of ['Kontrollpunkt', 'Frekvens', 'Metod', 'Ansvarig', 'Dokumentation', 'Avvikelse']) expect(text).toContain(h);
    expect(text).toContain('Okulär kontroll görs före lossning. [B2]');
    expect(text).toContain('ej ifylld');
    expect(text).toContain('struktur ur kommunala egenkontrollprogram i korpusen');
    expect(text).toContain(`[B2] B2-kontroll.md sha256 ${sha256(B2).slice(0, 12)}`);
    expect(text).toContain('Damning');
    expect(text).not.toContain('Buller');
  });
});
