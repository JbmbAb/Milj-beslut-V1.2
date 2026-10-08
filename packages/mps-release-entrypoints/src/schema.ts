import type { EntrypointRole, EntrypointsFile, Problem } from './types';
import { ENTRYPOINTS_SCHEMA_ID } from './types';

/**
 * Closed-key validation of deploy/onprem/entrypoints.json (schema u51-entrypoints-1).
 *
 *  - top level keys are exactly { schema, entries, not_production };
 *  - entries[] sorted strictly ascending by id (UTF-16 code unit order), keys exactly { id, role, argv, entry_file };
 *  - not_production[] sorted strictly ascending by entry_file, keys exactly { entry_file, reason };
 *  - ids unique, entry_files unique across BOTH lists (a file is in one list only);
 *  - every path is a normalised repository-relative path (forward slashes, no leading ./ or /, no .. segment).
 *
 * Any violation is a problem; the caller treats one or more problems as "not executed", never as a partial set.
 */

const SCHEMA_RULE = 'schema';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

export function isNormalisedRepoPath(path: unknown): path is string {
  if (typeof path !== 'string' || path.length === 0) return false;
  if (path.includes('\\') || path.startsWith('/') || path.endsWith('/') || /^[A-Za-z]:/.test(path)) return false;
  return path.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..');
}

function closedKeys(value: Record<string, unknown>, keys: readonly string[], where: string, problems: Problem[]): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((k, i) => k !== expected[i])) {
    problems.push({ rule: SCHEMA_RULE, message: `${where}: keys must be exactly {${expected.join(', ')}}, found {${actual.join(', ')}}` });
  }
}

function strictlyAscending(values: readonly string[]): boolean {
  return values.every((v, i) => i === 0 || values[i - 1]! < v);
}

export type ParsedEntrypoints = { readonly ok: true; readonly file: EntrypointsFile } | { readonly ok: false; readonly problems: readonly Problem[] };

export function parseEntrypointsFile(value: unknown): ParsedEntrypoints {
  const problems: Problem[] = [];
  if (!isPlainObject(value)) return { ok: false, problems: [{ rule: SCHEMA_RULE, message: 'top level must be a JSON object' }] };
  closedKeys(value, ['schema', 'entries', 'not_production'], 'top level', problems);
  if (value.schema !== ENTRYPOINTS_SCHEMA_ID) problems.push({ rule: SCHEMA_RULE, message: `schema must be "${ENTRYPOINTS_SCHEMA_ID}"` });

  const entries = value.entries;
  const notProduction = value.not_production;
  if (!Array.isArray(entries) || entries.length === 0) problems.push({ rule: SCHEMA_RULE, message: 'entries must be a non-empty array' });
  if (!Array.isArray(notProduction)) problems.push({ rule: SCHEMA_RULE, message: 'not_production must be an array' });
  if (problems.length > 0 || !Array.isArray(entries) || !Array.isArray(notProduction)) return { ok: false, problems };

  const ids: string[] = [];
  const files: string[] = [];
  entries.forEach((entry: unknown, index: number) => {
    const where = `entries[${index}]`;
    if (!isPlainObject(entry)) {
      problems.push({ rule: SCHEMA_RULE, message: `${where} must be an object` });
      return;
    }
    closedKeys(entry, ['id', 'role', 'argv', 'entry_file'], where, problems);
    if (typeof entry.id !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(entry.id)) problems.push({ rule: SCHEMA_RULE, message: `${where}.id must be a lowercase kebab-case string` });
    else ids.push(entry.id);
    const role = entry.role as EntrypointRole;
    if (role !== 'web' && role !== 'worker') problems.push({ rule: SCHEMA_RULE, message: `${where}.role must be "web" or "worker"` });
    const argv = entry.argv;
    if (!Array.isArray(argv) || argv.length === 0 || argv.some((a) => typeof a !== 'string' || a.length === 0)) {
      problems.push({ rule: SCHEMA_RULE, message: `${where}.argv must be a non-empty array of non-empty strings` });
    }
    if (!isNormalisedRepoPath(entry.entry_file)) problems.push({ rule: SCHEMA_RULE, message: `${where}.entry_file must be a normalised repository path` });
    else files.push(entry.entry_file);
  });

  const notProductionFiles: string[] = [];
  notProduction.forEach((item: unknown, index: number) => {
    const where = `not_production[${index}]`;
    if (!isPlainObject(item)) {
      problems.push({ rule: SCHEMA_RULE, message: `${where} must be an object` });
      return;
    }
    closedKeys(item, ['entry_file', 'reason'], where, problems);
    if (!isNormalisedRepoPath(item.entry_file)) problems.push({ rule: SCHEMA_RULE, message: `${where}.entry_file must be a normalised repository path` });
    else notProductionFiles.push(item.entry_file);
    if (typeof item.reason !== 'string' || item.reason.trim().length < 20) problems.push({ rule: SCHEMA_RULE, message: `${where}.reason must be a written justification (at least 20 characters)` });
  });

  if (ids.length === entries.length && !strictlyAscending(ids)) problems.push({ rule: SCHEMA_RULE, message: 'entries must be sorted strictly ascending by id (no duplicate ids)' });
  if (notProductionFiles.length === notProduction.length && !strictlyAscending(notProductionFiles)) {
    problems.push({ rule: SCHEMA_RULE, message: 'not_production must be sorted strictly ascending by entry_file (no duplicates)' });
  }
  const all = [...files, ...notProductionFiles];
  const seen = new Set<string>();
  for (const f of all) {
    if (seen.has(f)) problems.push({ rule: 'lists-disjoint-and-exist', message: `${f} is listed more than once (a file is in entries or in not_production, once)` });
    seen.add(f);
  }

  if (problems.length > 0) return { ok: false, problems };
  return { ok: true, file: value as unknown as EntrypointsFile };
}
