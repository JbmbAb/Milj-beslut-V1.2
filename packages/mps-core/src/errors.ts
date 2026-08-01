/**
 * ============================================================================
 * MPS-CORE
 * Domain error hierarchy
 *
 * Runtime only.
 *
 * Errors are NOT serialized into artifacts.
 * Errors are NOT hashable.
 * Errors MUST NEVER influence canonical identity.
 * ============================================================================
 */

import type { ContentReference } from "./types";

/* -------------------------------------------------------------------------- */
/* Base class                                                                 */
/* -------------------------------------------------------------------------- */

export abstract class MpsError extends Error {
  readonly code: string;
  readonly artifact_ref?: ContentReference;
  readonly cause?: unknown;

  public constructor(
    code: string,
    message: string,
    artifact_ref?: ContentReference,
    cause?: unknown
  ) {
    super(message);

    this.name = new.target.name;
    this.code = code;
    this.artifact_ref = artifact_ref;
    this.cause = cause;

    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/* -------------------------------------------------------------------------- */
/* Integrity                                                                   */
/* -------------------------------------------------------------------------- */

export abstract class IntegrityViolation extends MpsError {}
export abstract class PolicyViolation extends MpsError {}
export class RuntimeViolation extends MpsError {}

/* -------------------------------------------------------------------------- */
/* Governance                                                                  */
/* -------------------------------------------------------------------------- */

export class GovernanceIntegrityViolation extends IntegrityViolation {}
export class GovernancePolicyViolation extends PolicyViolation {}

/* -------------------------------------------------------------------------- */
/* Archive                                                                      */
/* -------------------------------------------------------------------------- */

export class ArchiveIntegrityViolation extends IntegrityViolation {}
export class ArchivePolicyViolation extends PolicyViolation {}

/* -------------------------------------------------------------------------- */
/* Promotion                                                                    */
/* -------------------------------------------------------------------------- */

export class PromotionIntegrityViolation extends IntegrityViolation {}
export class PromotionPolicyViolation extends PolicyViolation {}

/* -------------------------------------------------------------------------- */
/* Schema                                                                        */
/* -------------------------------------------------------------------------- */

export class SchemaValidationViolation extends RuntimeViolation {}

/* -------------------------------------------------------------------------- */
/* Signature                                                                     */
/* -------------------------------------------------------------------------- */

export class SignatureVerificationViolation extends RuntimeViolation {}

/* -------------------------------------------------------------------------- */
/* Trust                                                                         */
/* -------------------------------------------------------------------------- */

export class TrustViolation extends RuntimeViolation {}

/* -------------------------------------------------------------------------- */
/* Hash                                                                           */
/* -------------------------------------------------------------------------- */

export class HashVerificationViolation extends RuntimeViolation {}

/* -------------------------------------------------------------------------- */
/* Reference                                                                      */
/* -------------------------------------------------------------------------- */

export class ReferenceMismatchViolation extends RuntimeViolation {}

/* -------------------------------------------------------------------------- */
/* Identity                                                                       */
/* -------------------------------------------------------------------------- */

export class IdentityViolation extends RuntimeViolation {}
