/**
 * Types of the production entrypoint composition (schema u51-entrypoints-1).
 * Pure data, no behaviour. See schema.ts for the closed-key validation.
 */

export const ENTRYPOINTS_SCHEMA_ID = 'u51-entrypoints-1' as const;

/** Repository path of the composition file. Under deploy/onprem/, so the composition manifest hash binds it. */
export const ENTRYPOINTS_FILE_PATH = 'deploy/onprem/entrypoints.json' as const;

export type EntrypointRole = 'web' | 'worker';

export interface EntrypointEntry {
  readonly id: string;
  readonly role: EntrypointRole;
  readonly argv: readonly string[];
  readonly entry_file: string;
}

export interface NotProductionEntry {
  readonly entry_file: string;
  readonly reason: string;
}

export interface EntrypointsFile {
  readonly schema: typeof ENTRYPOINTS_SCHEMA_ID;
  readonly entries: readonly EntrypointEntry[];
  readonly not_production: readonly NotProductionEntry[];
}

/** A finding of a check. `rule` is a stable lowercase identifier of the rule that failed. */
export interface Problem {
  readonly rule: string;
  readonly message: string;
}

/**
 * Read access to ONE tree (a git tree object, a working directory or an in-memory map). Paths are repository
 * relative with forward slashes. Never reads outside that tree.
 */
export interface TreeReader {
  /** The file's text, or null when the tree has no such file (or it cannot be read as UTF-8 text). */
  read(path: string): string | null;
  has(path: string): boolean;
  /** Every file path of the tree below `prefix` (a directory path without trailing slash, or '' for all). */
  listUnder(prefix: string): string[];
  /** Hint: these files will be read next (lets a git-backed reader fetch them in one call). */
  prefetch?(paths: readonly string[]): void;
}
