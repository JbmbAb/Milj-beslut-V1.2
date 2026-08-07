/**
 * Frozen invariant identifiers and violation codes for the CAS boundary.
 * See docs/architecture/ADR-MPS-CAS-STORAGE-BOUNDARY.md (Commit H.1).
 */

export const CAS_BOUNDARY_CONTRACT_VERSION = 'cas-boundary-1' as const;

export const CAS_I02 = 'CAS-I02' as const; // Immutable Object
export const CAS_I03 = 'CAS-I03' as const; // Storage Independence
export const CAS_I04 = 'CAS-I04' as const; // Runtime Non Authority
export const CAS_I05 = 'CAS-I05' as const; // Path Determinism
export const CAS_I06 = 'CAS-I06' as const; // No Reverse Identity
export const CAS_I07 = 'CAS-I07' as const; // Runtime Isolation

export type CASInvariantId =
  | typeof CAS_I02
  | typeof CAS_I03
  | typeof CAS_I04
  | typeof CAS_I05
  | typeof CAS_I06
  | typeof CAS_I07;

export const CAS_IMMUTABILITY_VIOLATION = 'CAS_IMMUTABILITY_VIOLATION' as const;
export const CAS_DIGEST_MISMATCH = 'CAS_DIGEST_MISMATCH' as const;
export const CAS_MUTATION_FORBIDDEN = 'CAS_MUTATION_FORBIDDEN' as const;
export const CAS_INVALID_HASH = 'CAS_INVALID_HASH' as const;
export const CAS_REVERSE_IDENTITY_FORBIDDEN = 'CAS_REVERSE_IDENTITY_FORBIDDEN' as const;
export const CAS_RUNTIME_AUTHORITY_VIOLATION = 'CAS_RUNTIME_AUTHORITY_VIOLATION' as const;

export type CASViolationCode =
  | typeof CAS_IMMUTABILITY_VIOLATION
  | typeof CAS_DIGEST_MISMATCH
  | typeof CAS_MUTATION_FORBIDDEN
  | typeof CAS_INVALID_HASH
  | typeof CAS_REVERSE_IDENTITY_FORBIDDEN
  | typeof CAS_RUNTIME_AUTHORITY_VIOLATION;

export class CASBoundaryViolation extends Error {
  readonly code: CASViolationCode;
  readonly invariant: CASInvariantId;

  constructor(code: CASViolationCode, invariant: CASInvariantId, detail: string) {
    super(`${code}: ${detail} [${invariant}]`);
    this.name = 'CASBoundaryViolation';
    this.code = code;
    this.invariant = invariant;
  }
}
