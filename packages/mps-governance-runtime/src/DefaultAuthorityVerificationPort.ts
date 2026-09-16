import {
  LocalPemVerificationKeyProvider,
  verifyArtifactAttestation,
  type ArtifactAttestation,
  type VerificationKeyProvider,
} from "../../mimers-brunn-core/src/index.js";
import type {
  ArtifactReference as PinnedArtifactReference,
  ContentReference,
} from "../../mps-core/src/types.js";
import type { ArtifactContract } from "../../mps-compliance/src/artifacts/ArtifactContract.js";
import type { ArtifactReference } from "../../mps-compliance/src/artifacts/ArtifactReference.js";
import { sha256ContentHash } from "../../mps-compliance/src/canonical/sha256Canonical.js";
import type { ArtifactResolverPort } from "../../mps-runtime/src/mimers/ArtifactResolver.js";
import type { TrustDelegationArtifact } from "../../mps-governance/src/actors/TrustDelegationArtifact.js";
import type {
  AuthorityVerificationPort,
  VerifiedAuthorityArtifact,
} from "./AuthorityVerification.js";

export interface AuthorityTrustedKeyring {
  resolve(keyId: string): VerificationKeyProvider | null;
}

export function createAuthorityTrustedKeyring(
  publicKeysByKeyId: ReadonlyMap<string, string>,
): AuthorityTrustedKeyring {
  return {
    resolve(keyId: string): VerificationKeyProvider | null {
      const publicKey = publicKeysByKeyId.get(keyId);
      return publicKey ? new LocalPemVerificationKeyProvider(keyId, publicKey) : null;
    },
  };
}

function pinnedKey(ref: PinnedArtifactReference): string {
  return [
    ref.artifact_type,
    ref.artifact_id,
    ref.content_hash.algorithm,
    ref.content_hash.digest,
  ].join("\u0000");
}

function looseKey(ref: { readonly artifact_id: string; readonly artifact_type: string }): string {
  return [ref.artifact_type, ref.artifact_id].join("\u0000");
}

function sameLooseRef(
  left: { readonly artifact_id: string; readonly artifact_type: string },
  right: { readonly artifact_id: string; readonly artifact_type: string },
): boolean {
  return left.artifact_id === right.artifact_id && left.artifact_type === right.artifact_type;
}

function asLooseRef(ref: PinnedArtifactReference): ArtifactReference {
  return {
    artifact_id: ref.artifact_id,
    artifact_type: ref.artifact_type,
  };
}

function canonicalArtifactBody(artifact: ArtifactContract): unknown {
  const { content_hash: _contentHash, ...body } = artifact;
  return body;
}

function validAt(
  artifact: TrustDelegationArtifact,
  decisionTime: string,
): boolean {
  if (!artifact.valid_from) return false;
  const decisionMs = Date.parse(decisionTime);
  const fromMs = Date.parse(artifact.valid_from);
  if (Number.isNaN(decisionMs) || Number.isNaN(fromMs)) return false;
  if (decisionMs < fromMs) return false;
  if (artifact.valid_until !== undefined) {
    const untilMs = Date.parse(artifact.valid_until);
    if (Number.isNaN(untilMs) || untilMs <= fromMs) return false;
    if (decisionMs >= untilMs) return false;
  }
  return true;
}

export interface AuthorityArtifactAttestationIndex {
  resolve(reference: PinnedArtifactReference): Promise<ContentReference | null>;
}

export function createInMemoryAuthorityArtifactAttestationIndex(
  entries: ReadonlyArray<readonly [PinnedArtifactReference, ContentReference]>,
): AuthorityArtifactAttestationIndex {
  const byArtifact = new Map(entries.map(([artifact, attestation]) => [pinnedKey(artifact), attestation]));
  return {
    async resolve(reference: PinnedArtifactReference): Promise<ContentReference | null> {
      return byArtifact.get(pinnedKey(reference)) ?? null;
    },
  };
}

export interface AuthorityDelegationIndex {
  list(trustDomainRef: PinnedArtifactReference): Promise<readonly PinnedArtifactReference[]>;
}

export function createInMemoryAuthorityDelegationIndex(
  entries: ReadonlyArray<readonly [PinnedArtifactReference, PinnedArtifactReference]>,
): AuthorityDelegationIndex {
  const byDomain = new Map<string, PinnedArtifactReference[]>();
  for (const [domain, delegation] of entries) {
    const key = pinnedKey(domain);
    const current = byDomain.get(key) ?? [];
    current.push(delegation);
    byDomain.set(key, current);
  }
  return {
    async list(trustDomainRef: PinnedArtifactReference): Promise<readonly PinnedArtifactReference[]> {
      return [...(byDomain.get(pinnedKey(trustDomainRef)) ?? [])].sort((a, b) =>
        pinnedKey(a).localeCompare(pinnedKey(b)),
      );
    },
  };
}

export interface DefaultAuthorityVerificationPortDeps {
  readonly artifactResolver: ArtifactResolverPort;
  readonly trustedKeyring: AuthorityTrustedKeyring;
  readonly artifactAttestations: AuthorityArtifactAttestationIndex;
  readonly delegationIndex: AuthorityDelegationIndex;
  readonly attestationArtifactType?: string;
}

/**
 * Concrete implementation of the DELTA-01 hybrid verification boundary.
 *
 * It deliberately adapts the existing ArtifactResolver/CAS shape rather than
 * creating another repository or canonical-reference model.
 */
export class DefaultAuthorityVerificationPort implements AuthorityVerificationPort {
  private readonly attestationArtifactType: string;

  constructor(private readonly deps: DefaultAuthorityVerificationPortDeps) {
    this.attestationArtifactType = deps.attestationArtifactType ?? "authority_attestation";
  }

  async resolveVerifiedArtifact<TArtifact extends ArtifactContract>(
    reference: PinnedArtifactReference,
  ): Promise<VerifiedAuthorityArtifact<TArtifact>> {
    const envelope = await this.deps.artifactResolver.resolveEnvelope<TArtifact>(
      asLooseRef(reference),
    );
    const artifact = envelope.body;

    if (envelope.artifact_id !== reference.artifact_id) {
      throw new Error("REJECT_AUTHORITY_REFERENCE: envelope artifact_id mismatch");
    }
    if (
      artifact.artifact_id !== reference.artifact_id ||
      artifact.artifact_type !== reference.artifact_type
    ) {
      throw new Error("REJECT_AUTHORITY_REFERENCE: resolved id/type mismatch");
    }
    if (
      envelope.content_hash.algorithm !== reference.content_hash.algorithm ||
      envelope.content_hash.value !== reference.content_hash.digest ||
      artifact.content_hash.algorithm !== reference.content_hash.algorithm ||
      artifact.content_hash.value !== reference.content_hash.digest
    ) {
      throw new Error("REJECT_AUTHORITY_REFERENCE: declared content_hash mismatch");
    }

    const recomputed = sha256ContentHash(canonicalArtifactBody(artifact));
    if (
      recomputed.algorithm !== reference.content_hash.algorithm ||
      recomputed.value !== reference.content_hash.digest
    ) {
      throw new Error("REJECT_AUTHORITY_REFERENCE: canonical hash mismatch");
    }

    const attestationRef = await this.deps.artifactAttestations.resolve(reference);
    if (!attestationRef) {
      throw new Error("REJECT_AUTHORITY_ATTESTATION: missing artifact attestation");
    }
    const attestation = await this.resolvePinnedAttestation(attestationRef);
    if (attestation.subjectDigest !== `sha256:${reference.content_hash.digest}`) {
      throw new Error("REJECT_AUTHORITY_ATTESTATION: subject digest mismatch");
    }
    const key = this.deps.trustedKeyring.resolve(attestation.signer);
    if (!key) {
      throw new Error("REJECT_AUTHORITY_ATTESTATION: unknown signing key");
    }
    if (!(await verifyArtifactAttestation(attestation, key))) {
      throw new Error("REJECT_AUTHORITY_ATTESTATION: invalid signature");
    }

    return {
      artifact,
      verification_evidence_ref: attestationRef,
    };
  }

  async resolvePinnedAttestation(reference: ContentReference): Promise<ArtifactAttestation> {
    const envelope = await this.deps.artifactResolver.resolveEnvelope<ArtifactAttestation>({
      artifact_id: reference.id,
      artifact_type: this.attestationArtifactType,
    });
    if (envelope.artifact_id !== reference.id) {
      throw new Error("REJECT_AUTHORITY_ATTESTATION: envelope id mismatch");
    }
    if (
      envelope.content_hash.algorithm !== reference.content_hash.algorithm ||
      envelope.content_hash.value !== reference.content_hash.digest
    ) {
      throw new Error("REJECT_AUTHORITY_ATTESTATION: envelope hash mismatch");
    }
    const recomputed = sha256ContentHash(envelope.body);
    if (
      recomputed.algorithm !== reference.content_hash.algorithm ||
      recomputed.value !== reference.content_hash.digest
    ) {
      throw new Error("REJECT_AUTHORITY_ATTESTATION: canonical hash mismatch");
    }
    return envelope.body;
  }

  async resolveTrustedVerificationKey(
    keyId: string,
  ): Promise<VerificationKeyProvider | null> {
    return this.deps.trustedKeyring.resolve(keyId);
  }

  async assertCanonicalDelegationPath(input: {
    readonly decision_time: string;
    readonly root_actor_ref: PinnedArtifactReference;
    readonly actor_ref: PinnedArtifactReference;
    readonly trust_domain_ref: PinnedArtifactReference;
    readonly required_scope: string;
    readonly delegation_refs: readonly PinnedArtifactReference[];
  }): Promise<boolean> {
    const indexedRefs = await this.deps.delegationIndex.list(input.trust_domain_ref);
    const edges: Array<{
      readonly ref: PinnedArtifactReference;
      readonly artifact: TrustDelegationArtifact;
    }> = [];

    for (const ref of indexedRefs) {
      let artifact: TrustDelegationArtifact;
      try {
        artifact = (await this.resolveVerifiedArtifact<TrustDelegationArtifact>(ref)).artifact;
      } catch {
        return false;
      }
      if (!sameLooseRef(artifact.domain_ref, input.trust_domain_ref)) continue;
      if (artifact.authority_scope !== input.required_scope) continue;
      if (!validAt(artifact, input.decision_time)) continue;
      edges.push({ ref, artifact });
    }

    edges.sort((a, b) => pinnedKey(a.ref).localeCompare(pinnedKey(b.ref)));

    const adjacency = new Map<string, typeof edges>();
    for (const edge of edges) {
      const key = looseKey(edge.artifact.from_actor_ref);
      const current = adjacency.get(key) ?? [];
      current.push(edge);
      adjacency.set(key, current);
    }

    const rootKey = looseKey(input.root_actor_ref);
    const targetKey = looseKey(input.actor_ref);
    const paths: PinnedArtifactReference[][] = [];
    let cycleDetected = false;

    const visit = (
      actorKey: string,
      visitedActors: ReadonlySet<string>,
      path: readonly PinnedArtifactReference[],
    ): void => {
      if (paths.length > 1 || cycleDetected) return;
      if (actorKey === targetKey) {
        paths.push([...path]);
        return;
      }

      const outgoing = adjacency.get(actorKey) ?? [];
      for (const edge of outgoing) {
        const nextKey = looseKey(edge.artifact.to_actor_ref);
        if (visitedActors.has(nextKey)) {
          cycleDetected = true;
          return;
        }
        visit(
          nextKey,
          new Set([...visitedActors, nextKey]),
          [...path, edge.ref],
        );
        if (paths.length > 1 || cycleDetected) return;
      }
    };

    visit(rootKey, new Set([rootKey]), []);

    if (cycleDetected || paths.length !== 1) return false;
    const canonical = paths[0]!;
    if (canonical.length !== input.delegation_refs.length) return false;
    return canonical.every(
      (ref, index) => pinnedKey(ref) === pinnedKey(input.delegation_refs[index]!),
    );
  }
}
