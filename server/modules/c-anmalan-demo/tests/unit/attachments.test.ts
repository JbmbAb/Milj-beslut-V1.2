// @vitest-environment node
/**
 * K-54 attachments: JPG/PNG only with a size limit, one row per drawing, frozen with its hash,
 * hash-checked before embedding (a changed byte is an error), "Bilaga n" pages with the same
 * running header and footer as every other page. Fixtures are synthetic 8×6 px images.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyDecisions, freezeApproval, type FrozenProposal } from '../../approvalGate';
import { dataRoot, loadBlob, loadFrozen, putBlob, sha256 } from '../../caseStore';
import { renderAnmalanPdf } from '../../pdf';
import { assertEveryRowHasProvenance, buildProposalRows } from '../../proposalEngine';
import type { DemoCase, ProposalRow } from '../../types';
import { attachmentMime, loadUnderlag, MAX_ATTACHMENT_BYTES, type UnderlagMapping } from '../../underlagLoader';

const JPG = Buffer.from(
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAAGAAgDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDFoooryj74/9k=',
  'base64',
);
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAgAAAAGCAIAAABxZ0isAAAAFElEQVR4nGM8YWPDgA0wYRWlkwQAvaYBTH6BILwAAAAASUVORK5CYII=', 'base64');

let tmp: string;
let dir: string;

const mapping = (attachments: UnderlagMapping['attachments']): UnderlagMapping => ({
  label: 'underlag',
  archiveSha256: 'c'.repeat(64),
  propertyDesignation: 'TESTBY 1:1',
  verksamhetskoder: { values: ['90.40'], from: [{ file: 'A2.md', excerpt: 'kod 90.40' }] },
  fields: {},
  attachments,
});

function writeSums() {
  const files = fs.readdirSync(dir).filter((f) => f !== 'SHA256SUMS.txt');
  fs.writeFileSync(path.join(dir, 'SHA256SUMS.txt'), files.map((f) => `${sha256(fs.readFileSync(path.join(dir, f)))}  ${f}`).join('\n'));
}

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'demo01-att-'));
  dir = path.join(tmp, 'underlag');
  fs.mkdirSync(dir);
  process.env.DEMO_C_ANMALAN_DATA_DIR = path.join(tmp, 'data');
  process.env.DEMO_RELEASE_SHA = 'test-release';
  fs.writeFileSync(path.join(dir, 'README.md'), 'FIKTIV DEMODATA\n');
  fs.writeFileSync(path.join(dir, 'A2.md'), 'kod 90.40\n');
  fs.writeFileSync(path.join(dir, 'plan.jpg'), JPG);
  fs.writeFileSync(path.join(dir, 'sektion.png'), PNG);
  fs.writeFileSync(path.join(dir, 'fake.jpg'), Buffer.from('%PDF-1.4 not an image'));
  fs.writeFileSync(path.join(dir, 'plan.pdf'), Buffer.from('%PDF-1.4'));
  writeSums();
});
afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
  delete process.env.DEMO_C_ANMALAN_DATA_DIR;
  delete process.env.DEMO_RELEASE_SHA;
});

describe('attachment intake (JPG/PNG only, size limit, hash vs SHA256SUMS)', () => {
  it('accepts JPG and PNG and records file, sha256, type and size', () => {
    const { underlag } = loadUnderlag(dir, mapping([{ file: 'plan.jpg', title: 'Situationsplan' }, { file: 'sektion.png', title: 'Sektion' }]));
    expect(underlag.attachments).toEqual([
      { title: 'Situationsplan', file: 'plan.jpg', sha256: sha256(JPG), mime: 'image/jpeg', bytes: JPG.length },
      { title: 'Sektion', file: 'sektion.png', sha256: sha256(PNG), mime: 'image/png', bytes: PNG.length },
    ]);
  });
  it.each([
    ['a PDF', 'plan.pdf', /attachment_not_jpg_png/],
    ['a PDF renamed to .jpg', 'fake.jpg', /attachment_not_jpg_png/],
  ])('RED: refuses %s', (_n, file, err) => {
    expect(() => loadUnderlag(dir, mapping([{ file, title: 'x' }]))).toThrow(err);
  });
  it('RED: refuses a file above the size limit', () => {
    expect(() => attachmentMime('big.jpg', JPG)).not.toThrow();
    const big = Buffer.concat([JPG, Buffer.alloc(MAX_ATTACHMENT_BYTES)]);
    const d2 = path.join(tmp, 'big');
    fs.mkdirSync(d2);
    fs.writeFileSync(path.join(d2, 'A2.md'), 'kod 90.40\n');
    fs.writeFileSync(path.join(d2, 'big.jpg'), big);
    expect(() => loadUnderlag(d2, mapping([{ file: 'big.jpg', title: 'x' }]))).toThrow(/attachment_too_large/);
  });
  it('RED: refuses an image that does not match SHA256SUMS.txt', () => {
    const d3 = path.join(tmp, 'sums');
    fs.cpSync(dir, d3, { recursive: true });
    const buf = Buffer.from(JPG);
    buf[buf.length - 3] ^= 0xff;
    fs.writeFileSync(path.join(d3, 'plan.jpg'), buf);
    expect(() => loadUnderlag(d3, mapping([{ file: 'plan.jpg', title: 'x' }]))).toThrow(/underlag_hash_mismatch:plan.jpg/);
  });
});

describe('attachment rows, freezing and PDF', () => {
  const setup = () => {
    const { input, underlag, attachmentBytes } = loadUnderlag(dir, mapping([{ file: 'plan.jpg', title: 'Situationsplan' }, { file: 'sektion.png', title: 'Sektion' }]));
    for (const a of underlag.attachments!) putBlob(attachmentBytes.get(a.sha256)!, a.mime);
    const rows = buildProposalRows({ input, underlag, localization: [], citations: [], requirements: [], coverage: [], municipality: null });
    const record: DemoCase = {
      id: `demo01-att-${Math.random().toString(16).slice(2, 10)}`, createdAt: '', updatedAt: '', createdByUserId: 'u', organisationId: 'o', input, underlag,
      status: 'PROPOSED', proposal: { generatedAt: 'now', rows, inputs: { requirements: { state: 'missing', dir: 'x', message: 'ej levererad' }, localizationLabel: 'ej governed', legalCorpusCaveat: '' } },
    };
    return { rows, record };
  };

  it('one row per attachment with source file, sha256 and the fictional mark', () => {
    const { rows } = setup();
    const att = rows.filter((r) => r.section === 'bilagor');
    expect(att.map((r) => r.label)).toEqual(['Bilaga: Situationsplan', 'Bilaga: Sektion']);
    expect(att[0].provenance).toEqual({ kind: 'user_input', field: 'bilaga:plan.jpg', sources: [{ file: 'plan.jpg', sha256: sha256(JPG) }], fictional: true });
    expect(att[0].note).toMatch(/fiktiv/);
  });

  it('RED: an attachment row without a valid hash is refused by the guard', () => {
    const { rows } = setup();
    const bad = rows.map((r) => (r.attachment ? { ...r, attachment: { ...r.attachment, sha256: 'nope' } } : r)) as ProposalRow[];
    expect(() => assertEveryRowHasProvenance(bad)).toThrow(/attachment without sha256/);
  });

  it('"Bilaga n" pages carry the running header and footer; a struck attachment is not rendered', async () => {
    const { rows, record } = setup();
    const struck = rows.find((r) => r.label === 'Bilaga: Situationsplan')!.id;
    const frozen = freezeApproval(record, rows.map((r) => (r.id === struck ? { rowId: r.id, action: 'strike' as const } : { rowId: r.id, action: 'accept' as const })), 'u');
    const { document } = loadFrozen(frozen.sha256);
    const buf = await renderAnmalanPdf(document as FrozenProposal, frozen.sha256);
    const { PDFParse } = await import('pdf-parse');
    const parsed = await new PDFParse({ data: new Uint8Array(buf) }).getText();
    const pages = parsed.pages.map((p: { text: string }) => p.text.replace(/\s+/g, ' '));
    const last = pages[pages.length - 1];
    expect(last).toContain('Bilaga 1: Sektion');
    expect(pages.join(' ')).not.toContain('Situationsplan');
    pages.forEach((t: string, i: number) => {
      expect(t).toContain('FÖRSLAG – EJ INLÄMNAD · FIKTIVA UPPGIFTER — demo');
      expect(t).toContain(`release test-release`);
      expect(t).toContain(`sida ${i + 1} av ${pages.length}`);
    });
    expect(last).toContain(`bild-sha256 ${sha256(PNG)}`);
  });

  it('RED (manipulation): one changed byte in the stored image copy makes PDF generation fail', async () => {
    const { rows, record } = setup();
    const frozen = freezeApproval(record, rows.map((r) => ({ rowId: r.id, action: 'accept' as const })), 'u');
    const blob = path.join(dataRoot(), 'blobs', `${sha256(JPG)}.jpg`);
    const original = fs.readFileSync(blob);
    try {
      const tampered = Buffer.from(original);
      tampered[tampered.length - 3] ^= 0x01;
      fs.writeFileSync(blob, tampered);
      expect(() => loadBlob(sha256(JPG), 'image/jpeg')).toThrow(/attachment_hash_mismatch/);
      await expect(renderAnmalanPdf(loadFrozen(frozen.sha256).document as FrozenProposal, frozen.sha256)).rejects.toThrow(/attachment_hash_mismatch/);
    } finally {
      fs.writeFileSync(blob, original);
    }
    await expect(renderAnmalanPdf(loadFrozen(frozen.sha256).document as FrozenProposal, frozen.sha256)).resolves.toBeInstanceOf(Buffer);
  });

  it('an edited attachment row keeps its image (only the caption becomes the user\'s text)', () => {
    const { rows } = setup();
    const target = rows.find((r) => r.section === 'bilagor')!;
    const { approved } = applyDecisions(rows, rows.map((r) => (r.id === target.id ? { rowId: r.id, action: 'edit' as const, text: 'Ny bildtext' } : { rowId: r.id, action: 'accept' as const })));
    expect(approved.find((r) => r.id === target.id)!.attachment?.sha256).toBe(target.attachment!.sha256);
  });
});
