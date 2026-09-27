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
import type { DemoCaseInput, UnderlagFileRef, UnderlagRef } from './types';

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

export function loadUnderlag(dir: string, mapping: UnderlagMapping): { input: DemoCaseInput; underlag: UnderlagRef } {
  const sums = readSums(dir);
  const cache = new Map<string, { body: string; ref: UnderlagFileRef }>();
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
  return { input, underlag: { label: mapping.label, sha256: mapping.archiveSha256, fictional, fieldSources } };
}

function dedupe(refs: UnderlagFileRef[]): UnderlagFileRef[] {
  return [...new Map(refs.map((r) => [r.file, r])).values()];
}
