/**
 * Loads the user's underlag folder into a DemoCaseInput without paraphrasing.
 *
 * A mapping names, per input field, excerpts from the underlag files. Every excerpt must occur
 * verbatim in its file, and every file must match SHA256SUMS.txt when present. The case records
 * which files each field was quoted from (file + sha256). Only markdown markup is stripped for
 * display. An underlag whose README says "FIKTIV DEMODATA" is always marked fictional.
 *
 * The mapping and the underlag stay outside the repo (personal/fictional case data).
 */
import fs from 'node:fs';
import path from 'node:path';
import { sha256 } from './caseStore';
import type { AttachmentRef, DemoCaseInput, UnderlagFileRef, UnderlagRef } from './types';

export interface Excerpt {
  file: string;
  excerpt: string;
}

export interface UnderlagMapping {
  label: string;
  /** sha256 of the delivered archive, recorded as the underlag identity. */
  archiveSha256: string;
  propertyDesignation: string;
  verksamhetskoder: { values: string[]; from: Excerpt[] };
  fields: Partial<Record<Exclude<keyof DemoCaseInput, 'propertyDesignation' | 'verksamhetskoder' | 'placeholder'>, Excerpt[]>>;
  /** Drawings to attach (K-54): JPG/PNG files from the underlag, in this order. */
  attachments?: Array<{ file: string; title: string }>;
}

export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
export const MAX_ATTACHMENTS = 5;

/** Only JPG/PNG, recognised by both extension and magic bytes. */
export function attachmentMime(file: string, buf: Buffer): AttachmentRef['mime'] {
  const ext = path.extname(file).toLowerCase();
  const jpeg = buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  const png = buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if ((ext === '.jpg' || ext === '.jpeg') && jpeg) return 'image/jpeg';
  if (ext === '.png' && png) return 'image/png';
  throw new Error(`attachment_not_jpg_png:${file}`);
}

/** Display-only cleanup: bold/code marks, table pipes, list dashes. Words are not changed. */
export function stripMarkdown(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .split('\n')
    .filter((line) => !/^\s*\|?\s*:?-{3,}/.test(line)) // table separator rows
    .map((line) =>
      line
        .replace(/\*\*|`/g, '')
        .replace(/^\s*\|\s*(.*?)\s*\|\s*$/, (_m, cells: string) => cells.split(/\s*\|\s*/).join(' · '))
        .replace(/^\s*-\s+/, '– ')
        .replace(/^#+\s+/, ''),
    )
    .filter((line) => line.trim())
    .join('\n');
}

export function readSums(dir: string): Map<string, string> {
  const file = path.join(dir, 'SHA256SUMS.txt');
  const out = new Map<string, string>();
  if (!fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([a-f0-9]{64})\s+\*?(.+)$/i);
    if (m) out.set(m[2].trim().replace(/\\/g, '/'), m[1].toLowerCase());
  }
  return out;
}

export function loadUnderlag(
  dir: string,
  mapping: UnderlagMapping,
): { input: DemoCaseInput; underlag: UnderlagRef; attachmentBytes: Map<string, Buffer> } {
  const sums = readSums(dir);
  const cache = new Map<string, { body: string; ref: UnderlagFileRef }>();
  const readBytes = (file: string) => {
    const buf = fs.readFileSync(path.join(dir, file));
    const digest = sha256(buf);
    const expected = sums.get(file);
    if (expected && expected !== digest) throw new Error(`underlag_hash_mismatch:${file}`);
    if (sums.size && !expected) throw new Error(`underlag_file_not_in_sums:${file}`);
    return { buf, digest };
  };
  const readFile = (file: string) => {
    if (!cache.has(file)) {
      const buf = fs.readFileSync(path.join(dir, file));
      const digest = sha256(buf);
      const expected = sums.get(file);
      if (expected && expected !== digest) throw new Error(`underlag_hash_mismatch:${file}`);
      if (sums.size && !expected) throw new Error(`underlag_file_not_in_sums:${file}`);
      cache.set(file, { body: buf.toString('utf8').replace(/\r\n/g, '\n'), ref: { file, sha256: digest } });
    }
    return cache.get(file)!;
  };
  const quote = (excerpts: Excerpt[]) =>
    excerpts.map((e) => {
      const f = readFile(e.file);
      if (!f.body.includes(e.excerpt.replace(/\r\n/g, '\n'))) throw new Error(`excerpt_not_verbatim:${e.file}:${e.excerpt.slice(0, 40)}`);
      return { text: stripMarkdown(e.excerpt), ref: f.ref };
    });

  const readme = fs.existsSync(path.join(dir, 'README.md')) ? fs.readFileSync(path.join(dir, 'README.md'), 'utf8') : '';
  const fictional = /FIKTIV DEMODATA/i.test(readme);

  const fieldSources: UnderlagRef['fieldSources'] = {};
  const values: Record<string, string> = {};
  for (const [field, excerpts] of Object.entries(mapping.fields)) {
    if (!excerpts?.length) continue;
    const q = quote(excerpts);
    values[field] = q.map((x) => x.text).join('\n');
    fieldSources[field] = dedupe(q.map((x) => x.ref));
  }
  const codeQuotes = quote(mapping.verksamhetskoder.from);
  for (const code of mapping.verksamhetskoder.values) {
    if (!codeQuotes.some((q) => q.text.includes(code))) throw new Error(`code_not_in_underlag:${code}`);
  }
  fieldSources.verksamhetskoder = dedupe(codeQuotes.map((q) => q.ref));

  const input: DemoCaseInput = {
    propertyDesignation: mapping.propertyDesignation,
    verksamhetskoder: mapping.verksamhetskoder.values,
    avfallstyper: values.avfallstyper ?? '',
    mangdPerArTon: values.mangdPerArTon ?? '',
    maxSamtidigtLagradTon: values.maxSamtidigtLagradTon ?? '',
    verksamhetsutovare: values.verksamhetsutovare ?? '',
    ytansKonstruktion: values.ytansKonstruktion ?? '',
    jordart: values.jordart ?? '',
    lutningAvrinning: values.lutningAvrinning ?? '',
    dagvatten: values.dagvatten ?? '',
    verksamhetsbeskrivning: values.verksamhetsbeskrivning ?? '',
    anvandarensForsiktighetsmatt: values.anvandarensForsiktighetsmatt ?? '',
    anvandarensEgenkontroll: values.anvandarensEgenkontroll ?? '',
    placeholder: false,
  };
  const specs = mapping.attachments ?? [];
  if (specs.length > MAX_ATTACHMENTS) throw new Error(`too_many_attachments:${specs.length}`);
  const attachmentBytes = new Map<string, Buffer>();
  const attachments: AttachmentRef[] = specs.map(({ file, title }) => {
    const { buf, digest } = readBytes(file);
    if (buf.length > MAX_ATTACHMENT_BYTES) throw new Error(`attachment_too_large:${file}:${buf.length}`);
    const mime = attachmentMime(file, buf);
    attachmentBytes.set(digest, buf);
    return { title, file, sha256: digest, mime, bytes: buf.length };
  });

  return {
    input,
    underlag: { label: mapping.label, sha256: mapping.archiveSha256, fictional, fieldSources, ...(attachments.length ? { attachments } : {}) },
    attachmentBytes,
  };
}

function dedupe(refs: UnderlagFileRef[]): UnderlagFileRef[] {
  return [...new Map(refs.map((r) => [r.file, r])).values()];
}
