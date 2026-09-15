import {
  verifyArtifactAttestation,
  type ArtifactAttestation,
  type VerificationKeyProvider,
} from "../../mimers-brunn-core/src/index.js";
import type {
  ArtifactReference as PinnedArtifactReference,
  ContentReference,
} from "../../mps-core/src/types.js";
import type { ArtifactContract } from "../../mps-compliance/src/artifacts/ArtifactContract.js";
import type { ContentHash } from "../../mps-compliance/src/artifacts/ContentHash.js";
import type { ActorArtifact } from "../../mps-governance/src/actors/ActorArtifact.js";
import type { ActorLifecycleArtifact } from "../../mps-governance/src/actors/ActorLifecycleArtifact.js";
import type { TrustAnchorArtifact } from "../../mps-governance/src/actors/TrustAnchorArtifact.js";
import type { TrustDelegationArtifact } from "../../mps-governance/src/actors/TrustDelegationArtifact.js";
import type { TrustDomainArtifact } from "../../mps-governance/src/actors/TrustDomainArtifact.js";
import type { CapabilityArtifact } from "../../mps-governance/src/capabilities/CapabilityArtifact.js";
import type { CapabilityGrantArtifact } from "../../mps-governance/src/capabilities/CapabilityGrantArtifact.js";
import type { CapabilityScopeArtifact } from "../../mps-governance/src/capabilities/CapabilityScopeArtifact.js";

export const DELEGATION_STATUS_PREDICATE_TYPE =
  "mimer/authority/delegation-status/v1" as const;
export const DELEGATION_STATUS_SCHEMA_VERSION = 1 as const;

export type DelegationStatus = "ACTIVE" | "REVOKED";

export interface DelegationStatusPredicate {
  readonly delegation_artifact_id: string;
  readonly delegation_content_hash: string;
  readonly status: DelegationStatus;
  /**
   * The exact authority-evaluation instant this status statement answers.
   * Replay reuses this value; it never substitutes wall-clock time.
   */
  readonly evaluated_at: string;
  readonly revoked_at?: string;
  readonly attestation_schema_version: typeof DELEGATION_STATUS_SCHEMA_VERSION;
  readonly signer_key_id: string;
}

export interface VerifiedAuthorityArtifact<TArtifact extends ArtifactContract> {
  readonly artifact: TArtifact;
  /**
   * External verification evidence when the artifact uses ArtifactContract +
   * ArtifactAttestation instead of an embedded mps-core signature.
   */
  readonly verification_evidence_ref?: ContentReference;
}

/**
 * Hybrid boundary proved by GL-AUTHORITY-RV1.
 *
 * The implementation behind this port MUST fail closed unless:
 * - artifact_id and artifact_type equal the supplied pinned reference,
 * - canonical content bytes re-hash to reference.content_hash,
 * - the artifact's own content_hash equals reference.content_hash,
 * - any external attestation is bound to that same digest and has a valid signature.
 *
 * The authority engine deliberately does not know how each artifact family serializes.
 * That knowledge stays in the artifact-specific resolver/adapter rather than creating a
 * fourth canonicalization path here.
 */
export interface AuthorityVerificationPort {
  resolveVerifiedArtifact<TArtifact extends ArtifactContract>(
    reference: PinnedArtifactReference,
  ): Promise<VerifiedAuthorityArtifact<TArtifact>>;

  /**
   * Resolve a content-hash pinned attestation. This verifies content addressing,
   * not signer authority; signer trust is checked below against TrustAnchor.
   */
  resolvePinnedAttestation(reference: ContentReference): Promise<ArtifactAttestation>;

  resolveTrustedVerificationKey(keyId: string): Promise<VerificationKeyProvider | null>;

  /**
   * ACT-21-I5. The supplied delegation path must be the unique canonical path
   * for this actor/domain/scope at decision_time. The port owns graph traversal
   * because only it can see the complete canonical authority graph.
   */
  assertCanonicalDelegationPath(input: {
    readonly decision_time: string;
    readonly root_actor_ref: PinnedArtifactReference;
    readonly actor_ref: PinnedArtifactReference;
    readonly trust_domain_ref: PinnedArtifactReference;
    readonly required_scope: string;
    readonly delegation_refs: readonly PinnedArtifactReference[];
  }): Promise<boolean>;
}

export interface AuthorityDelegationEvidence {
  readonly delegation_ref: PinnedArtifactReference;
  readonly delegator_actor_ref: PinnedArtifactReference;
  readonly delegator_lifecycle_ref: PinnedArtifactReference;
  readonly delegatee_actor_ref: PinnedArtifactReference;
  readonly delegatee_lifecycle_ref: PinnedArtifactReference;
  readonly status_attestation_ref: ContentReference;
}

export interface AuthorityVerificationRequest {
  readonly decision_time: string;
  readonly required_capability: string;
  readonly required_scope: string;

  readonly actor_ref: PinnedArtifactReference;
  readonly actor_lifecycle_ref: PinnedArtifactReference;

  readonly capability_ref: PinnedArtifactReference;
  readonly capability_scope_ref: PinnedArtifactReference;
  readonly capability_grant_ref: PinnedArtifactReference;

  readonly trust_domain_ref: PinnedArtifactReference;
  readonly trust_anchor_ref: PinnedArtifactReference;
  readonly trust_root_actor_ref: PinnedArtifactReference;
  readonly trust_root_actor_lifecycle_ref: PinnedArtifactReference;

  readonly delegation_path: readonly AuthorityDelegationEvidence[];
}

export interface AuthorityEvidenceClosure {
  readonly decision_time: string;
  readonly required_capability: string;
  readonly required_scope: string;
  readonly authority_refs: readonly PinnedArtifactReference[];
  readonly verification_evidence_refs: readonly ContentReference[];
}

export type AuthorityVerificationResult =
  | { readonly ok: true; readonly closure: AuthorityEvidenceClosure }
  | { readonly ok: false; readonly reason: string };

function sameLooseRef(
  left: { readonly artifact_id: string; readonly artifact_type: string } | undefined,
  right: { readonly artifact_id: string; readonly artifact_type: string },
): boolean {
  return Boolean(
    left &&
      left.artifact_id === right.artifact_id &&
      left.artifact_type === right.artifact_type,
  );
}

function hashMatchesPinned(hash: ContentHash | undefined, ref: PinnedArtifactReference): boolean {
  return Boolean(
    hash &&
      hash.algorithm === ref.content_hash.algorithm &&
      hash.value === ref.content_hash.digest,
  );
}

function parseInstant(value: string, label: string): number {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    throw new Error(`REJECT_AUTHORITY_TIME: invalid ${label}`);
  }
  return parsed;
}

function requireWindowContains(
  decisionMs: number,
  validFrom: string | undefined,
  validUntil: string | undefined,
  label: string,
): void {
  if (!validFrom) {
    throw new Error(`REJECT_AUTHORITY_WINDOW: ${label} missing valid_from`);
  }
  const from = parseInstant(validFrom, `${label}.valid_from`);
  if (decisionMs < from) {
    throw new Error(`REJECT_AUTHORITY_WINDOW: ${label} not active at decision_time`);
  }
  if (validUntil !== undefined) {
    const until = parseInstant(validUntil, `${label}.valid_until`);
    if (until <= from) {
      throw new Error(`REJECT_AUTHORITY_WINDOW: ${label} valid_until <= valid_from`);
    }
    if (decisionMs >= until) {
      throw new Error(`REJECT_AUTHORITY_WINDOW: ${label} expired at decision_time`);
    }
  }
}

function pinnedRefKey(ref: PinnedArtifactReference): string {
  return [
    ref.artifact_type,
    ref.artifact_id,
    ref.content_hash.algorithm,
    ref.content_hash.digest,
  ].join("\u0000");
}

function contentRefKey(ref: ContentReference): string {
  return [
    ref.id,
    ref.content_hash.algorithm,
    ref.content_hash.digest,
    ref.schema_ref?.schema_id ?? "",
    ref.schema_ref?.schema_version ?? "",
  ].join("\u0000");
}

async function resolve<T extends ArtifactContract>(
  port: AuthorityVerificationPort,
  ref: PinnedArtifactReference,
  externalEvidence: ContentReference[],
): Promise<T> {
  const verified = await port.resolveVerifiedArtifact<T>(ref);
  if (!sameLooseRef(verified.artifact, ref)) {
    throw new Error("REJECT_AUTHORITY_REFERENCE: resolved id/type mismatch");
  }
  if (!hashMatchesPinned(verified.artifact.content_hash, ref)) {
    throw new Error("REJECT_AUTHORITY_REFERENCE: resolved content_hash mismatch");
  }
  if (verified.verification_evidence_ref) {
    externalEvidence.push(verified.verification_evidence_ref);
  }
  return verified.artifact;
}

async function resolveActorClosure(
  port: AuthorityVerificationPort,
  actorRef: PinnedArtifactReference,
  lifecycleRef: PinnedArtifactReference,
  trustDomainRef: PinnedArtifactReference,
  decisionMs: number,
  externalEvidence: ContentReference[],
  collectedRefs: PinnedArtifactReference[],
): Promise<ActorArtifact> {
  const actor = await resolve<ActorArtifact>(port, actorRef, externalEvidence);
  const lifecycle = await resolve<ActorLifecycleArtifact>(port, lifecycleRef, externalEvidence);

  if (!actor.identity_ref || !actor.identity_hash) {
    throw new Error("REJECT_ACTOR_IDENTITY: actor lacks canonical identity closure");
  }
  const identityRef: PinnedArtifactReference = {
    artifact_id: actor.identity_ref.artifact_id,
    artifact_type: actor.identity_ref.artifact_type,
    content_hash: {
      algorithm: actor.identity_hash.algorithm,
      digest: actor.identity_hash.value,
    },
  };
  await resolve<ArtifactContract>(port, identityRef, externalEvidence);

  if (!sameLooseRef(actor.lifecycle_ref, lifecycleRef)) {
    throw new Error("REJECT_ACTOR_LIFECYCLE: lifecycle reference mismatch");
  }
  if (!sameLooseRef(actor.trust_domain_ref, trustDomainRef)) {
    throw new Error("REJECT_TRUST_DOMAIN: actor domain mismatch");
  }
  if (lifecycle.state !== "active") {
    throw new Error("REJECT_ACTOR_LIFECYCLE: actor is not active");
  }
  requireWindowContains(
    decisionMs,
    lifecycle.effective_from,
    lifecycle.effective_to,
    `actor_lifecycle:${actorRef.artifact_id}`,
  );

  collectedRefs.push(actorRef, lifecycleRef, identityRef);
  return actor;
}

async function verifyDelegationStatus(
  port: AuthorityVerificationPort,
  anchor: TrustAnchorArtifact,
  delegation: TrustDelegationArtifact,
  delegationRef: PinnedArtifactReference,
  statusRef: ContentReference,
  decisionTime: string,
): Promise<void> {
  if (!anchor.verification_key_id) {
    throw new Error("REJECT_AUTHORITY_ROOT: trust anchor missing verification_key_id");
  }

  const attestation = await port.resolvePinnedAttestation(statusRef);
  if (attestation.predicateType !== DELEGATION_STATUS_PREDICATE_TYPE) {
    throw new Error("REJECT_DELEGATION_STATUS: predicate type");
  }
  if (attestation.signer !== anchor.verification_key_id) {
    throw new Error("REJECT_DELEGATION_STATUS: signer is not trust anchor key");
  }

  const key = await port.resolveTrustedVerificationKey(attestation.signer);
  if (!key || key.keyId !== anchor.verification_key_id) {
    throw new Error("REJECT_DELEGATION_STATUS: untrusted signer");
  }
  if (!(await verifyArtifactAttestation(attestation, key))) {
    throw new Error("REJECT_DELEGATION_STATUS: invalid signature");
  }

  const predicate = attestation.predicate as Partial<DelegationStatusPredicate>;
  const expectedDigest = `sha256:${delegationRef.content_hash.digest}`;
  if (
    attestation.subjectDigest !== expectedDigest ||
    predicate.delegation_artifact_id !== delegationRef.artifact_id ||
    predicate.delegation_content_hash !== delegationRef.content_hash.digest
  ) {
    throw new Error("REJECT_DELEGATION_STATUS: delegation binding");
  }
  if (
    predicate.attestation_schema_version !== DELEGATION_STATUS_SCHEMA_VERSION ||
    predicate.signer_key_id !== anchor.verification_key_id
  ) {
    throw new Error("REJECT_DELEGATION_STATUS: schema/signer binding");
  }
  if (predicate.evaluated_at !== decisionTime) {
    throw new Error("REJECT_DELEGATION_STATUS: evaluated_at != decision_time");
  }
  if (predicate.status !== "ACTIVE") {
    throw new Error("REJECT_DELEGATION_STATUS: delegation revoked");
  }
  if (predicate.revoked_at !== undefined) {
    throw new Error("REJECT_DELEGATION_STATUS: ACTIVE statement carries revoked_at");
  }

  // Ensure the status claim itself contains a real parseable canonical instant.
  parseInstant(predicate.evaluated_at, "delegation_status.evaluated_at");

  // The content-pinned delegation reference is also checked against the resolved artifact.
  if (!hashMatchesPinned(delegation.content_hash, delegationRef)) {
    throw new Error("REJECT_DELEGATION_STATUS: delegation hash mismatch");
  }
}

/**
 * Verify authorization at an explicit, persisted decision instant.
 *
 * Important: this function never reads Date.now()/new Date(). "Authorized now"
 * is a separate invocation with a separately supplied decision_time. Historical
 * replay supplies the original closure.decision_time and therefore cannot be
 * invalidated merely because a delegation expires or is revoked later.
 */
export async function verifyAuthorityAtDecisionTime(
  port: AuthorityVerificationPort,
  request: AuthorityVerificationRequest,
): Promise<AuthorityVerificationResult> {
  const externalEvidence: ContentReference[] = [];
  try {
    const decisionMs = parseInstant(request.decision_time, "decision_time");

    const collectedAuthorityRefs: PinnedArtifactReference[] = [];
    const [capability, scope, grant, domain, anchor] = await Promise.all([
      resolve<CapabilityArtifact>(port, request.capability_ref, externalEvidence),
      resolve<CapabilityScopeArtifact>(port, request.capability_scope_ref, externalEvidence),
      resolve<CapabilityGrantArtifact>(port, request.capability_grant_ref, externalEvidence),
      resolve<TrustDomainArtifact>(port, request.trust_domain_ref, externalEvidence),
      resolve<TrustAnchorArtifact>(port, request.trust_anchor_ref, externalEvidence),
    ]);

    const actor = await resolveActorClosure(
      port,
      request.actor_ref,
      request.actor_lifecycle_ref,
      request.trust_domain_ref,
      decisionMs,
      externalEvidence,
      collectedAuthorityRefs,
    );
    const rootActor = await resolveActorClosure(
      port,
      request.trust_root_actor_ref,
      request.trust_root_actor_lifecycle_ref,
      request.trust_domain_ref,
      decisionMs,
      externalEvidence,
      collectedAuthorityRefs,
    );
    if (
      !sameLooseRef(domain.anchor_ref, request.trust_anchor_ref) ||
      !sameLooseRef(anchor.root_actor_ref, request.trust_root_actor_ref) ||
      !hashMatchesPinned(anchor.root_actor_hash, request.trust_root_actor_ref)
    ) {
      throw new Error("REJECT_TRUST_ROOT: domain/anchor/root-actor closure mismatch");
    }
    if (capability.capability_name !== request.required_capability) {
      throw new Error("REJECT_CAPABILITY: capability name mismatch");
    }
    if (
      !sameLooseRef(scope.capability_ref, request.capability_ref) ||
      scope.scope_name !== request.required_scope
    ) {
      throw new Error("REJECT_CAPABILITY_SCOPE: scope mismatch");
    }
    if (
      !sameLooseRef(grant.actor_ref, request.actor_ref) ||
      !hashMatchesPinned(grant.actor_hash, request.actor_ref) ||
      !sameLooseRef(grant.capability_ref, request.capability_ref) ||
      !hashMatchesPinned(grant.capability_hash, request.capability_ref) ||
      !sameLooseRef(grant.scope_ref, request.capability_scope_ref) ||
      !hashMatchesPinned(grant.scope_hash, request.capability_scope_ref)
    ) {
      throw new Error("REJECT_CAPABILITY_GRANT: actor/capability/scope binding mismatch");
    }

    const delegationRefs = request.delegation_path.map((entry) => entry.delegation_ref);
    if (
      !(await port.assertCanonicalDelegationPath({
        decision_time: request.decision_time,
        root_actor_ref: request.trust_root_actor_ref,
        actor_ref: request.actor_ref,
        trust_domain_ref: request.trust_domain_ref,
        required_scope: request.required_scope,
        delegation_refs: delegationRefs,
      }))
    ) {
      throw new Error("REJECT_DELEGATION_PATH: non-canonical or ambiguous path");
    }

    let expectedFrom: PinnedArtifactReference = request.trust_root_actor_ref;
    for (const entry of request.delegation_path) {
      const delegation = await resolve<TrustDelegationArtifact>(
        port,
        entry.delegation_ref,
        externalEvidence,
      );

      if (
        !sameLooseRef(entry.delegator_actor_ref, expectedFrom) ||
        !sameLooseRef(delegation.from_actor_ref, entry.delegator_actor_ref) ||
        !sameLooseRef(delegation.to_actor_ref, entry.delegatee_actor_ref) ||
        !sameLooseRef(delegation.domain_ref, request.trust_domain_ref) ||
        delegation.authority_scope !== request.required_scope
      ) {
        throw new Error("REJECT_DELEGATION_PATH: chain/domain/scope mismatch");
      }

      await resolveActorClosure(
        port,
        entry.delegator_actor_ref,
        entry.delegator_lifecycle_ref,
        request.trust_domain_ref,
        decisionMs,
        externalEvidence,
        collectedAuthorityRefs,
      );
      await resolveActorClosure(
        port,
        entry.delegatee_actor_ref,
        entry.delegatee_lifecycle_ref,
        request.trust_domain_ref,
        decisionMs,
        externalEvidence,
        collectedAuthorityRefs,
      );
      requireWindowContains(
        decisionMs,
        delegation.valid_from,
        delegation.valid_until,
        `delegation:${entry.delegation_ref.artifact_id}`,
      );
      await verifyDelegationStatus(
        port,
        anchor,
        delegation,
        entry.delegation_ref,
        entry.status_attestation_ref,
        request.decision_time,
      );
      externalEvidence.push(entry.status_attestation_ref);

      collectedAuthorityRefs.push(entry.delegation_ref);
      expectedFrom = entry.delegatee_actor_ref;
    }

    if (request.delegation_path.length === 0) {
      if (!sameLooseRef(anchor.root_actor_ref, request.actor_ref)) {
        throw new Error("REJECT_DELEGATION_PATH: delegation required for non-root actor");
      }
    } else if (!sameLooseRef(expectedFrom, request.actor_ref)) {
      throw new Error("REJECT_DELEGATION_PATH: path does not terminate at actor");
    }

    const authorityRefs = [
      ...collectedAuthorityRefs,
      request.capability_ref,
      request.capability_scope_ref,
      request.capability_grant_ref,
      request.trust_domain_ref,
      request.trust_anchor_ref,
      request.trust_root_actor_ref,
      request.trust_root_actor_lifecycle_ref,
      ...delegationRefs,
    ]
      .filter(
        (ref, index, all) => all.findIndex((candidate) => pinnedRefKey(candidate) === pinnedRefKey(ref)) === index,
      )
      .sort((a, b) => pinnedRefKey(a).localeCompare(pinnedRefKey(b)));

    const verificationEvidenceRefs = externalEvidence
      .filter(
        (ref, index, all) => all.findIndex((candidate) => contentRefKey(candidate) === contentRefKey(ref)) === index,
      )
      .sort((a, b) => contentRefKey(a).localeCompare(contentRefKey(b)));

    return {
      ok: true,
      closure: {
        decision_time: request.decision_time,
        required_capability: request.required_capability,
        required_scope: request.required_scope,
        authority_refs: authorityRefs,
        verification_evidence_refs: verificationEvidenceRefs,
      },
    };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : "REJECT_AUTHORITY_UNKNOWN",
    };
  }
}
