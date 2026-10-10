import {
  HUMAN_IDENTITY_ARTIFACT_TYPE,
  SERVICE_IDENTITY_ARTIFACT_TYPE,
  validateHumanIdentityArtifact,
  type HumanIdentityArtifact,
} from "../../mps-governance/src/actors/IdentityArtifacts";
import type { ActorReference, ContentReference } from "../../mps-core/src/types";
import type { AuthenticatedGovernanceReviewer } from "./DatasetApprovalController";
import {
  GovernanceReviewerIdentityError,
  loadGovernanceReviewerRegistry,
  type GovernanceReviewerRegistryEntry,
} from "./GovernanceReviewerIdentityResolver";

/**
 * IDENTITY — who is this?
 * Resolves a ContentReference to a verified canonical HumanIdentityArtifact.
 * Does not grant GOVERNANCE_REVIEWER and does not authenticate a session.
 */
export interface GovernanceReviewerIdentityAuthorityPort {
  resolveVerifiedHumanIdentity(ref: ContentReference): Promise<VerifiedCanonicalHumanIdentity>;
}

/**
 * AUTHENTICATION — which canonical human is the current principal?
 * Must be bound by trusted runtime/session code. Never taken from a
 * DatasetApproval request payload or caller-supplied ContentReference argument
 * at the public compose boundary.
 */
export interface AuthenticatedPrincipalPort {
  currentIdentityRef(): Promise<ContentReference>;
}

export interface VerifiedCanonicalHumanIdentity {
  readonly identity: HumanIdentityArtifact;
  readonly identity_ref: ContentReference;
}

export class GovernanceReviewerIdentityAuthorityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GovernanceReviewerIdentityAuthorityError";
  }
}

/** Maps ADR-24-21 HumanIdentityArtifact content_hash.value → mps-core digest. */
export function contentReferenceFromHumanIdentity(
  identity: HumanIdentityArtifact,
): ContentReference {
  return {
    id: identity.artifact_id,
    content_hash: {
      algorithm: identity.content_hash.algorithm,
      digest: identity.content_hash.value,
    },
  };
}

export function sameIdentityRef(a: ContentReference, b: ContentReference): boolean {
  return a.id === b.id &&
    a.content_hash.algorithm === b.content_hash.algorithm &&
    a.content_hash.digest === b.content_hash.digest;
}

/**
 * Existing synthetic/mock rejection rule, applied to human subject_id when that
 * id itself carries the admin/mock prefixes used by ensureAdminConsoleUser /
 * ensureMockAuthUser bankid subjects. Complements BankID-level checks in
 * server/security/canonicalAuthorityIdentity.ts without inventing a parallel model.
 */
export function isDisqualifiedHumanSubjectId(subjectId: string): boolean {
  const normalized = subjectId.trim().toLowerCase();
  return normalized.startsWith("admin:") ||
    normalized.startsWith("mock-") ||
    normalized.startsWith("admin-") ||
    normalized === "reviewer-1" ||
    normalized.startsWith("test-") ||
    normalized.startsWith("fake-");
}

/**
 * Verifies a stored identity artifact against a pinned ContentReference.
 * Service identities and unverifiable humans fail closed.
 */
export function verifyCanonicalHumanIdentityArtifact(
  artifact: unknown,
  expectedRef: ContentReference,
): VerifiedCanonicalHumanIdentity {
  if (!artifact || typeof artifact !== "object") {
    throw new GovernanceReviewerIdentityAuthorityError(
      "REJECT_DATASET_APPROVAL_IDENTITY_MISSING: canonical identity artifact not found",
    );
  }
  const shaped = artifact as { readonly artifact_type?: string };
  if (shaped.artifact_type === SERVICE_IDENTITY_ARTIFACT_TYPE) {
    throw new GovernanceReviewerIdentityAuthorityError(
      "REJECT_DATASET_APPROVAL_SERVICE_IDENTITY: DatasetApproval reviewer must be a human identity",
    );
  }
  if (shaped.artifact_type !== HUMAN_IDENTITY_ARTIFACT_TYPE) {
    throw new GovernanceReviewerIdentityAuthorityError(
      `REJECT_DATASET_APPROVAL_IDENTITY_TYPE: expected '${HUMAN_IDENTITY_ARTIFACT_TYPE}', ` +
        `got '${shaped.artifact_type ?? "unknown"}'`,
    );
  }

  let human: HumanIdentityArtifact;
  try {
    human = validateHumanIdentityArtifact(artifact as HumanIdentityArtifact);
  } catch (error) {
    throw new GovernanceReviewerIdentityAuthorityError(
      `REJECT_DATASET_APPROVAL_IDENTITY_UNVERIFIED: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  if (isDisqualifiedHumanSubjectId(human.subject_id)) {
    throw new GovernanceReviewerIdentityAuthorityError(
      "REJECT_DATASET_APPROVAL_SYNTHETIC_IDENTITY: synthetic/mock human subject cannot authorize DatasetApproval",
    );
  }

  const canonicalRef = contentReferenceFromHumanIdentity(human);
  if (canonicalRef.id !== expectedRef.id) {
    throw new GovernanceReviewerIdentityAuthorityError(
      "REJECT_DATASET_APPROVAL_IDENTITY_ID_MISMATCH: reference id does not match canonical human identity",
    );
  }
  if (
    canonicalRef.content_hash.algorithm !== expectedRef.content_hash.algorithm ||
    canonicalRef.content_hash.digest !== expectedRef.content_hash.digest
  ) {
    throw new GovernanceReviewerIdentityAuthorityError(
      "REJECT_DATASET_APPROVAL_IDENTITY_HASH_MISMATCH: reference content_hash does not match canonical human identity",
    );
  }

  return { identity: human, identity_ref: canonicalRef };
}

/** In-memory identity authority for tests and isolated dry-runs. */
export function createInMemoryGovernanceReviewerIdentityAuthority(
  identities: readonly HumanIdentityArtifact[],
): GovernanceReviewerIdentityAuthorityPort {
  const byId = new Map(identities.map((identity) => [identity.artifact_id, identity]));
  return {
    async resolveVerifiedHumanIdentity(ref: ContentReference): Promise<VerifiedCanonicalHumanIdentity> {
      return verifyCanonicalHumanIdentityArtifact(byId.get(ref.id), ref);
    },
  };
}

export function createStaticAuthenticatedPrincipalPort(
  identityRef: ContentReference,
): AuthenticatedPrincipalPort {
  return {
    async currentIdentityRef(): Promise<ContentReference> {
      if (!identityRef?.id?.trim() || !identityRef.content_hash?.digest) {
        throw new GovernanceReviewerIdentityAuthorityError(
          "BLOCKED_BY_AUTHENTICATED_PRINCIPAL_BINDING: authenticated principal identity_ref incomplete",
        );
      }
      return identityRef;
    },
  };
}

/**
 * AUTHORIZATION — after identity + authentication, look up DatasetApproval grant.
 *
 * Evaluation order (fail closed):
 * 1. authenticated principal ref (runtime-controlled)
 * 2. canonical human identity resolve/verify
 * 3. exact reviewer grant lookup (id + content_hash)
 * 4. role must be GOVERNANCE_REVIEWER
 * 5. project ActorReference (identity separate from role)
 */
export async function authorizeDatasetApprovalGovernanceReviewer(input: {
  readonly identityAuthority: GovernanceReviewerIdentityAuthorityPort;
  readonly authenticatedPrincipal: AuthenticatedPrincipalPort;
  readonly grants?: readonly GovernanceReviewerRegistryEntry[];
  readonly env?: NodeJS.ProcessEnv;
}): Promise<AuthenticatedGovernanceReviewer> {
  const principalRef = await input.authenticatedPrincipal.currentIdentityRef();
  const verified = await input.identityAuthority.resolveVerifiedHumanIdentity(principalRef);

  // Authenticated principal must already pin the exact canonical human identity.
  if (!sameIdentityRef(principalRef, verified.identity_ref)) {
    throw new GovernanceReviewerIdentityAuthorityError(
      "REJECT_AUTHENTICATED_HUMAN_MISMATCH: authenticated principal does not match verified canonical human identity",
    );
  }

  const grants = input.grants ?? loadGovernanceReviewerRegistry(input.env ?? process.env);
  const grant = grants.find((entry) => sameIdentityRef(entry.identity_ref, verified.identity_ref));
  if (!grant) {
    throw new GovernanceReviewerIdentityError(
      `REJECT_UNAUTHORIZED_DATASET_APPROVAL_REVIEWER: canonical human '${verified.identity_ref.id}' ` +
        "has no DatasetApproval GOVERNANCE_REVIEWER grant",
    );
  }
  if (grant.role !== "GOVERNANCE_REVIEWER") {
    throw new GovernanceReviewerIdentityError("REJECT_DATASET_APPROVAL_REVIEWER_ROLE");
  }

  // Exact grant binding: matching id with wrong hash (or vice versa) already failed above.
  const actor_ref: ActorReference = {
    identity_ref: verified.identity_ref,
    role: "GOVERNANCE_REVIEWER",
  };
  return { actor_ref };
}
