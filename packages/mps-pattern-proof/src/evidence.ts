/**
 * PATTERN-PROOF-ENGINE-01 V1 -- EvidenceLocator (frozen design section 2, BOOTSTRAP section 2).
 *
 * "authority is proven via a resolvable, governed source, not merely asserted to exist". A locator
 * is the only admissible way an artifact points at evidence; a `file:line` is one KIND of locator,
 * not the definition of one.
 */
import { PatternProofError } from './errors';
import { isPlainObject } from './internal/plain-object';

export const EVIDENCE_LOCATOR_KINDS = [
  'file_line',
  'cas_artifact',
  'git_object',
  'postgis_ref',
  'signed_attestation',
  'runtime_result',
] as const;

export type EvidenceLocatorKind = (typeof EVIDENCE_LOCATOR_KINDS)[number];

export interface EvidenceLocator {
  readonly kind: EvidenceLocatorKind;
  /** e.g. "Dockerfile:32-37", a CAS artifact id, a git blob/commit sha, a test-run identifier. */
  readonly ref: string;
  readonly note?: string;
}

export function isEvidenceLocatorKind(value: unknown): value is EvidenceLocatorKind {
  return typeof value === 'string' && (EVIDENCE_LOCATOR_KINDS as readonly string[]).includes(value);
}

/**
 * Validates one locator. Returns a frozen copy that contains ONLY the present keys (an explicit
 * `note: undefined` is dropped, never copied -- canonicalizeStrict forbids undefined values).
 */
export function validateEvidenceLocator(input: unknown, path = 'evidence'): EvidenceLocator {
  if (!isPlainObject(input)) {
    throw new PatternProofError('PPE_SCHEMA_INVALID', 'EvidenceLocator must be a plain object', { path });
  }
  for (const key of Object.keys(input)) {
    if (key !== 'kind' && key !== 'ref' && key !== 'note') {
      throw new PatternProofError('PPE_UNKNOWN_FIELD', `unknown field "${key}" on EvidenceLocator`, { path });
    }
  }
  if (!isEvidenceLocatorKind(input.kind)) {
    throw new PatternProofError(
      'PPE_EVIDENCE_KIND_INVALID',
      `kind must be one of ${EVIDENCE_LOCATOR_KINDS.join(', ')}`,
      {
        path: `${path}.kind`,
      },
    );
  }
  if (typeof input.ref !== 'string' || input.ref.trim().length === 0) {
    throw new PatternProofError('PPE_SCHEMA_INVALID', 'ref must be a non-empty string', {
      path: `${path}.ref`,
    });
  }
  if (input.note !== undefined && typeof input.note !== 'string') {
    throw new PatternProofError('PPE_SCHEMA_INVALID', 'note must be a string when present', {
      path: `${path}.note`,
    });
  }
  const out: { kind: EvidenceLocatorKind; ref: string; note?: string } = { kind: input.kind, ref: input.ref };
  if (typeof input.note === 'string') out.note = input.note;
  return Object.freeze(out);
}

/** Validates a NON-EMPTY locator array (every artifact field that "requires evidence"). */
export function validateEvidenceLocators(input: unknown, path = 'evidence'): readonly EvidenceLocator[] {
  if (!Array.isArray(input) || input.length === 0) {
    throw new PatternProofError('PPE_EVIDENCE_REQUIRED', 'at least one EvidenceLocator is required', {
      path,
    });
  }
  return Object.freeze(input.map((item, index) => validateEvidenceLocator(item, `${path}[${index}]`)));
}

/**
 * Identity of a locator for set membership (frozen design section 8: a RedPlan probe's authority must
 * appear among the locators the discovery/graph phases actually established). `note` is not identity.
 */
export function locatorKey(locator: EvidenceLocator): string {
  return `${locator.kind}\u0000${locator.ref.trim()}`;
}
