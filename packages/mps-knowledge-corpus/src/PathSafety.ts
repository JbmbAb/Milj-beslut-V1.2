import path from 'node:path';

/**
 * Data-safety helpers for anything that turns an observed name (a quarantine id, an archive entry
 * name, a manifest file name) into a filesystem read. Document text and file names are DATA; they
 * never choose a location outside the root the caller intends to read from.
 */
export class PathEscapeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PathEscapeError';
  }
}

export class ContentBudgetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ContentBudgetError';
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Quarantine object ids are uuids by construction (DiskQuarantineStorage); anything else is refused before it touches a path. */
export function assertQuarantineId(id: string): string {
  if (typeof id !== 'string' || !UUID.test(id)) {
    throw new PathEscapeError(`REJECT_QUARANTINE_ID: '${String(id).slice(0, 80)}' is not a quarantine uuid`);
  }
  return id;
}

/**
 * Resolves `relative` under `root` and refuses anything that would land outside it: absolute
 * inputs, drive-qualified inputs, `..` traversal, NUL bytes. Returns the resolved absolute path.
 */
export function resolveWithinRoot(root: string, relative: string): string {
  if (typeof relative !== 'string' || relative.length === 0) {
    throw new PathEscapeError('REJECT_PATH: empty relative path');
  }
  if (relative.includes('\0')) throw new PathEscapeError('REJECT_PATH: NUL byte in path');
  if (path.isAbsolute(relative) || /^[a-zA-Z]:[\\/]/.test(relative) || relative.startsWith('\\\\')) {
    throw new PathEscapeError(`REJECT_PATH: absolute path '${relative.slice(0, 80)}' is not allowed`);
  }
  const rootResolved = path.resolve(root);
  const candidate = path.resolve(rootResolved, relative);
  const rel = path.relative(rootResolved, candidate);
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new PathEscapeError(`REJECT_PATH: '${relative.slice(0, 80)}' escapes the intended root`);
  }
  return candidate;
}

export interface ContentBudget {
  /** Hard upper bound on raw bytes accepted for one document. */
  readonly max_raw_bytes: number;
  /** Hard upper bound on projected characters accepted for one document. */
  readonly max_projected_chars: number;
  /**
   * Hard upper bound on raw bytes accepted for a text/html document. KNOWN UPSTREAM LIMITATION:
   * the TEXT-L1 HTML stripper (server/modules/legal/services/legalCorpusTextExtractor.ts) is
   * quadratic on pathological input (many unterminated `<script` openers: measured 64 KiB 0.6 s,
   * 128 KiB 2.5 s, 256 KiB 10 s, 512 KiB 40 s), so the general raw-byte budget cannot bound its
   * CPU cost; this separate, much smaller bound does (every real governed HTML page is < 600 KB).
   */
  readonly max_html_bytes: number;
}

/**
 * SIZE bounds, not cost bounds. 64 MiB covers every governed object except one known outlier: the
 * 114.85 MB PUH court decision (quarantine a40b32bd-…) is refused as REJECT_OVERSIZED and reported
 * as such in every run — admitting it is an owner decision about the budget, not a silent raise.
 */
export const DEFAULT_CONTENT_BUDGET: ContentBudget = Object.freeze({
  max_raw_bytes: 64 * 1024 * 1024,
  max_projected_chars: 8 * 1024 * 1024,
  max_html_bytes: 1024 * 1024,
});

export function assertHtmlBytesWithinBudget(
  byteLength: number,
  budget: ContentBudget = DEFAULT_CONTENT_BUDGET,
): void {
  if (!Number.isFinite(byteLength) || byteLength < 0)
    throw new ContentBudgetError('REJECT_OVERSIZED: invalid byte length');
  if (byteLength > budget.max_html_bytes) {
    throw new ContentBudgetError(
      `REJECT_OVERSIZED: ${byteLength} raw bytes of text/html exceeds the html budget ${budget.max_html_bytes} (the HTML stripper is quadratic on pathological input)`,
    );
  }
}

export function assertRawBytesWithinBudget(
  byteLength: number,
  budget: ContentBudget = DEFAULT_CONTENT_BUDGET,
): void {
  if (!Number.isFinite(byteLength) || byteLength < 0)
    throw new ContentBudgetError('REJECT_OVERSIZED: invalid byte length');
  if (byteLength > budget.max_raw_bytes) {
    throw new ContentBudgetError(
      `REJECT_OVERSIZED: ${byteLength} raw bytes exceeds budget ${budget.max_raw_bytes}`,
    );
  }
}

export function assertProjectedCharsWithinBudget(
  charCount: number,
  budget: ContentBudget = DEFAULT_CONTENT_BUDGET,
): void {
  if (!Number.isFinite(charCount) || charCount < 0)
    throw new ContentBudgetError('REJECT_OVERSIZED: invalid char count');
  if (charCount > budget.max_projected_chars) {
    throw new ContentBudgetError(
      `REJECT_OVERSIZED: ${charCount} projected chars exceeds budget ${budget.max_projected_chars}`,
    );
  }
}
