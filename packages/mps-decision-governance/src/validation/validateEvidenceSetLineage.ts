// packages/mps-decision-governance/src/validation/validateEvidenceSetLineage.ts

import { hashCanonicalLineageSlot } from "../CanonicalDecisionImpactHash";
import type { EvidenceSetArtifact, EvidenceSetLineageScope } from "../EvidenceSetArtifact";

/**
 * LINEAGE_SLOT_UNIQUENESS (identity rule, not runtime policy):
 * For each (previous_evidence_set_hash, lineage_scope, canonical document set)
 * at most one lineage_sequence may exist.
 *
 * Distinct from fork detection:
 * - Fork: "two different children of the same parent?" (A→B and A→C)
 * - Slot: "two competing identities for the same logical chain position?"
 *   (includes root: previous_hash = null; alternative timelines with same docs/scope)
 *
 * Violation rejection code: LINEAGE_SEQUENCE_AMBIGUITY
 */
export const LINEAGE_SLOT_UNIQUENESS = "LINEAGE_SLOT_UNIQUENESS" as const;

export interface EvidenceSetLineageResolver {
  resolve(evidence_set_hash: string): EvidenceSetArtifact | undefined;
  /**
   * Optional fork detector: hashes that already claim `previousHash` as parent.
   * When present, parallel branches A→B and A→C are rejected (append-only chain).
   */
  findSuccessorHashes?(previousHash: string): readonly string[];
  /**
   * Optional canonical-slot lookup: for (previous + documents + scope),
   * return the already-committed sequence (and hash), if any.
   */
  findByCanonicalLineageSlot?(slotHash: string):
    | { readonly sequence: number; readonly evidence_set_hash: string }
    | undefined;
}

export class EvidenceSetLineageError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "EvidenceSetLineageError";
  }
}

function sameLineageScope(a: EvidenceSetLineageScope, b: EvidenceSetLineageScope): boolean {
  return (
    a.jurisdiction_level === b.jurisdiction_level && a.decision_type === b.decision_type
  );
}

/**
 * Validate lineage invariants for a single EvidenceSet node:
 * - LINEAGE_SLOT_UNIQUENESS (previous + scope + canonical docs → one sequence)
 * - previous resolves (when set)
 * - no self-reference
 * - scope stable along chain
 * - sequence strictly increases
 * - no fork (when index available)
 */
export function validateEvidenceSetLineage(
  artifact: EvidenceSetArtifact,
  resolver: EvidenceSetLineageResolver,
): void {
  // LINEAGE_SLOT_UNIQUENESS — identity rule; applies to roots and successors alike.
  if (resolver.findByCanonicalLineageSlot) {
    const slotHash = hashCanonicalLineageSlot(artifact.identity);
    const occupied = resolver.findByCanonicalLineageSlot(slotHash);
    if (
      occupied &&
      (occupied.sequence !== artifact.identity.lineage_sequence ||
        occupied.evidence_set_hash !== artifact.evidence_set_hash)
    ) {
      throw new EvidenceSetLineageError(
        "LINEAGE_SEQUENCE_AMBIGUITY",
        `${LINEAGE_SLOT_UNIQUENESS}: for (previous_evidence_set_hash, lineage_scope, canonical documents) ` +
          `at most one lineage_sequence may exist; ` +
          `slot already has sequence=${occupied.sequence} hash=${occupied.evidence_set_hash}, ` +
          `got sequence=${artifact.identity.lineage_sequence} hash=${artifact.evidence_set_hash}`,
      );
    }
  }

  const previousHash = artifact.identity.previous_evidence_set_hash;

  if (!previousHash) {
    return;
  }

  const previous = resolver.resolve(previousHash);

  if (!previous) {
    throw new EvidenceSetLineageError(
      "PREVIOUS_EVIDENCE_SET_NOT_FOUND",
      "previous_evidence_set_hash does not resolve",
    );
  }

  if (previous.evidence_set_hash === artifact.evidence_set_hash) {
    throw new EvidenceSetLineageError(
      "SELF_REFERENCING_EVIDENCE_SET",
      "EvidenceSet cannot reference itself",
    );
  }

  if (!sameLineageScope(artifact.identity.lineage_scope, previous.identity.lineage_scope)) {
    throw new EvidenceSetLineageError(
      "LINEAGE_SCOPE_MISMATCH",
      "EvidenceSet lineage scope changed along chain",
    );
  }

  if (previous.identity.schema_version !== artifact.identity.schema_version) {
    throw new EvidenceSetLineageError(
      "LINEAGE_SCOPE_MISMATCH",
      "EvidenceSet schema_version changed along lineage",
    );
  }

  if (previous.identity.lineage_sequence >= artifact.identity.lineage_sequence) {
    throw new EvidenceSetLineageError(
      "LINEAGE_SEQUENCE_REGRESSION",
      "lineage_sequence must strictly increase along lineage",
    );
  }

  if (resolver.findSuccessorHashes) {
    const successors = resolver.findSuccessorHashes(previousHash);
    const foreign = successors.filter((h) => h !== artifact.evidence_set_hash);
    if (foreign.length > 0) {
      throw new EvidenceSetLineageError(
        "LINEAGE_FORK_DETECTED",
        `Parallel lineage branch forbidden; parent ${previousHash} already has successor ${foreign[0]}`,
      );
    }
  }
}

/**
 * In-memory append-only lineage store with fork + canonical-slot detection.
 */
export class InMemoryEvidenceSetLineageStore implements EvidenceSetLineageResolver {
  private readonly byHash = new Map<string, EvidenceSetArtifact>();
  private readonly childrenOf = new Map<string, Set<string>>();
  private readonly byLineageSlot = new Map<
    string,
    { sequence: number; evidence_set_hash: string }
  >();

  resolve(evidence_set_hash: string): EvidenceSetArtifact | undefined {
    return this.byHash.get(evidence_set_hash);
  }

  findSuccessorHashes(previousHash: string): readonly string[] {
    const set = this.childrenOf.get(previousHash);
    return set ? Object.freeze([...set]) : [];
  }

  findByCanonicalLineageSlot(
    slotHash: string,
  ): { readonly sequence: number; readonly evidence_set_hash: string } | undefined {
    return this.byLineageSlot.get(slotHash);
  }

  /**
   * Validate then commit. Rejects forks, regressions, self-refs, scope drift,
   * and canonical lineage sequence ambiguity.
   */
  append(artifact: EvidenceSetArtifact): void {
    if (this.byHash.has(artifact.evidence_set_hash)) {
      const existing = this.byHash.get(artifact.evidence_set_hash)!;
      if (
        existing.identity.lineage_sequence === artifact.identity.lineage_sequence &&
        existing.identity.previous_evidence_set_hash ===
          artifact.identity.previous_evidence_set_hash
      ) {
        return;
      }
      throw new EvidenceSetLineageError(
        "LINEAGE_FORK_DETECTED",
        `EvidenceSet hash ${artifact.evidence_set_hash} already committed with different lineage`,
      );
    }

    validateEvidenceSetLineage(artifact, this);

    this.byHash.set(artifact.evidence_set_hash, artifact);
    this.byLineageSlot.set(hashCanonicalLineageSlot(artifact.identity), {
      sequence: artifact.identity.lineage_sequence,
      evidence_set_hash: artifact.evidence_set_hash,
    });

    const prev = artifact.identity.previous_evidence_set_hash;
    if (prev) {
      const kids = this.childrenOf.get(prev) ?? new Set<string>();
      kids.add(artifact.evidence_set_hash);
      this.childrenOf.set(prev, kids);
    }
  }
}
