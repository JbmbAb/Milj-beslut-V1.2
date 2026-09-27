// @vitest-environment node
/**
 * User underlag: quoted verbatim with file + sha256, fictional underlag always marked, and a field
 * the user rewrites loses its file source.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sha256, saveCase } from '../../caseStore';
import { updateInput } from '../../demoService';
import { formatSource } from '../../formatSource';
import { buildProposalRows, FICTIONAL_NOTE } from '../../proposalEngine';
import type { DemoCase } from '../../types';
import { loadUnderlag, stripMarkdown, type UnderlagMapping } from '../../underlagLoader';

let tmp: string;
let dir: string;
const A2 = '# A2\n\n**MPF-kod: 90.40 - demoantagande.**\n\n| EWC | Namn |\n|---|---|\n| 17 05 04 | Jord och sten |\n';
const B1 = '- Företagsnamn: **Demo AB**\n- Organisationsnummer: **559999-0000**\n- Telefon: 070-000 00 00\n';

const mapping = (over: Partial<UnderlagMapping> = {}): UnderlagMapping => ({
  label: 'underlag.zip',
  archiveSha256: 'c'.repeat(64),
  propertyDesignation: 'TESTBY 1:1',
  verksamhetskoder: { values: ['90.40'], from: [{ file: 'A2.md', excerpt: '**MPF-kod: 90.40 - demoantagande.**' }] },
  fields: {
    avfallstyper: [{ file: 'A2.md', excerpt: '| EWC | Namn |\n|---|---|\n| 17 05 04 | Jord och sten |' }],
    verksamhetsutovare: [{ file: 'B1.md', excerpt: '- Företagsnamn: **Demo AB**\n- Organisationsnummer: **559999-0000**' }],
  },
  ...over,
});

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'demo01-underlag-'));
  dir = path.join(tmp, 'jimmy-underlag');
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'A2.md'), A2);
  fs.writeFileSync(path.join(dir, 'B1.md'), B1);
  fs.writeFileSync(path.join(dir, 'README.md'), '> **FIKTIV DEMODATA - EJ VERKLIG ANMÄLAN.**\n');
  fs.writeFileSync(path.join(dir, 'SHA256SUMS.txt'), ['A2.md', 'B1.md', 'README.md'].map((f) => `${sha256(fs.readFileSync(path.join(dir, f)))}  ${f}`).join('\n'));
  process.env.DEMO_C_ANMALAN_DATA_DIR = path.join(tmp, 'data');
});
afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
  delete process.env.DEMO_C_ANMALAN_DATA_DIR;
});

describe('underlag loader', () => {
  it('quotes verbatim, records file + sha256 per field and forces the fictional mark from README', () => {
    const { input, underlag } = loadUnderlag(dir, mapping());
    expect(input.verksamhetskoder).toEqual(['90.40']);
    expect(input.verksamhetsutovare).toBe('– Företagsnamn: Demo AB\n– Organisationsnummer: 559999-0000');
    expect(input.verksamhetsutovare).not.toContain('070'); // only the mapped excerpt, nothing else from B1
    expect(input.avfallstyper).toBe('EWC · Namn\n17 05 04 · Jord och sten');
    expect(underlag.fictional).toBe(true);
    expect(underlag.fieldSources.avfallstyper).toEqual([{ file: 'A2.md', sha256: sha256(A2) }]);
    expect(input.placeholder).toBe(false);
  });
  it('RED: an excerpt that is not verbatim in the file is refused', () => {
    const m = mapping({ fields: { avfallstyper: [{ file: 'A2.md', excerpt: 'Jord och sten från annan källa' }] } });
    expect(() => loadUnderlag(dir, m)).toThrow(/excerpt_not_verbatim/);
  });
  it('RED: a code the underlag does not state is refused', () => {
    expect(() => loadUnderlag(dir, mapping({ verksamhetskoder: { values: ['90.110'], from: mapping().verksamhetskoder.from } }))).toThrow(/code_not_in_underlag/);
  });
  it('RED: a file that does not match SHA256SUMS.txt is refused', () => {
    const d2 = path.join(tmp, 'tampered');
    fs.cpSync(dir, d2, { recursive: true });
    fs.appendFileSync(path.join(d2, 'B1.md'), 'ändrad\n');
    expect(() => loadUnderlag(d2, mapping())).toThrow(/underlag_hash_mismatch:B1.md/);
  });
  it('stripMarkdown only removes markup', () => {
    expect(stripMarkdown('## Rubrik\n- **fet** `kod`\n|---|\n| a | b |')).toBe('Rubrik\n– fet kod\na · b');
  });
});

describe('underlag in the proposal', () => {
  it('user rows cite their file and carry the fictional note', () => {
    const { input, underlag } = loadUnderlag(dir, mapping());
    const rows = buildProposalRows({ input, underlag, localization: [], citations: [], requirements: [], coverage: [], municipality: null });
    const row = rows.find((r) => r.id === 'user-avfallstyper')!;
    expect(row.note).toContain(FICTIONAL_NOTE);
    expect(formatSource(row.provenance)).toBe(`Källa: användarens uppgift (A2.md sha256 ${sha256(A2).slice(0, 8)}…) – fiktiv uppgift (demo)`);
    // An empty field is neither sourced nor marked fictional: it is simply not filled.
    const property = rows.find((r) => r.id === 'user-propertyDesignation')!;
    expect(property.provenance).toEqual({ kind: 'user_input', field: 'propertyDesignation' });
    expect(property.note).toBeUndefined();
    const empty = rows.find((r) => r.id === 'user-jordart')!;
    expect(empty.provenance).toEqual({ kind: 'user_input', field: 'jordart' });
  });
  it('a field the user rewrites loses its file source; untouched fields keep theirs', () => {
    const { input, underlag } = loadUnderlag(dir, mapping());
    const record: DemoCase = { id: 'demo01-underlag-00000001', createdAt: '', updatedAt: '', createdByUserId: 'u', organisationId: 'o', input, underlag, status: 'DRAFT' };
    saveCase(record);
    const res = updateInput({ id: 'u', organisationId: 'o', role: 'ADMIN', bankidId: 'x' }, record.id, { ...input, avfallstyper: 'Egen ny text' });
    if (res.ok === false) throw new Error(res.error);
    expect(res.value.underlag?.fieldSources.avfallstyper).toBeUndefined();
    expect(res.value.underlag?.fieldSources.verksamhetsutovare).toBeDefined();
    expect(res.value.underlag?.fictional).toBe(true);
  });
});
