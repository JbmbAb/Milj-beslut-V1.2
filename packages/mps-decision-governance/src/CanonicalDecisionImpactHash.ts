// packages/mps-decision-governance/src/CanonicalDecisionImpactHash.ts

import * as crypto from "crypto";
import { canonicalizeStrict } from "../../mimers-brunn-core/src/serialization/canonicalize";
import type { DecisionImpactIdentity } from "./DecisionImpactIdentity";
import type { EvidenceSetIdentity } from "./EvidenceSetArtifact";

/**
 * Constitutional: version is part of the hash domain, not sidecar metadata.
 * @see ADR-MPS-CONSTITUTIONAL-INVARIANTS §5
 */
export const DECISION_GOVERNANCE_CANONICAL_VERSION = "dg-canonical-1" as const;

function calculateSHA256(data: string): string {
  return crypto.createHash("sha256").update(data, "utf8").digest("hex");
}

/**
 * artifact_hash = SHA256(canonical_version || "\n" || canonical_payload)
 */
export function hashVersionedCanonicalPayload(
  payload: unknown,
  canonical_version: string = DECISION_GOVERNANCE_CANONICAL_VERSION,
): string {
  const canonical_payload = canonicalizeStrict(payload);
  return calculateSHA256(`${canonical_version}\n${canonical_payload}`);
}

/**
 * Serialize identity payload to canonical JSON bytes (UTF-8 string).
 * Does not include version prefix — use hashVersionedCanonicalPayload for identity hashes.
 */
export function serializeCanonicalPayload(payload: unknown): string {
  return canonicalizeStrict(payload);
}

export function deserializeCanonicalPayload(canonical: string): unknown {
  return JSON.parse(canonical) as unknown;
}

/**
 * Kirurgisk tvätt-hjälpare (RFC8785).
 * Tar bort alla nycklar som bär värdet 'undefined'.
 */
function cleanPayload(obj: Record<string, unknown>): Record<string, unknown> {
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) {
      clean[key] = value;
    }
  }
  return clean;
}

/**
 * Canonical identity payload for EvidenceSet (documents order-tolerant).
 * lineage_sequence + lineage_scope + previous_hash enter identity.
 * Metadata MUST NOT be passed here.
 */
export function buildEvidenceSetIdentityPayload(
  identity: EvidenceSetIdentity,
): Record<string, unknown> {
  const sortedDocuments = [...identity.documents].sort((a, b) =>
    a.document_hash.localeCompare(b.document_hash),
  );

  return cleanPayload({
    documents: sortedDocuments,
    schema_version: identity.schema_version,
    previous_evidence_set_hash: identity.previous_evidence_set_hash,
    lineage_sequence: identity.lineage_sequence,
    lineage_scope: {
      jurisdiction_level: identity.lineage_scope.jurisdiction_level,
      decision_type: identity.lineage_scope.decision_type,
    },
  });
}

/**
 * Deterministic, version-bound SHA-256 over EvidenceSetIdentity.
 */
export function hashEvidenceSetIdentity(identity: EvidenceSetIdentity): string {
  return hashVersionedCanonicalPayload(buildEvidenceSetIdentityPayload(identity));
}

/**
 * Canonical lineage slot — (previous_hash + documents + scope).
 * Excludes lineage_sequence. Also version-bound.
 */
export function buildCanonicalLineageSlotPayload(
  identity: EvidenceSetIdentity,
): Record<string, unknown> {
  const sortedDocuments = [...identity.documents].sort((a, b) =>
    a.document_hash.localeCompare(b.document_hash),
  );

  return cleanPayload({
    documents: sortedDocuments,
    schema_version: identity.schema_version,
    previous_evidence_set_hash: identity.previous_evidence_set_hash,
    lineage_scope: {
      jurisdiction_level: identity.lineage_scope.jurisdiction_level,
      decision_type: identity.lineage_scope.decision_type,
    },
  });
}

export function hashCanonicalLineageSlot(identity: EvidenceSetIdentity): string {
  return hashVersionedCanonicalPayload(buildCanonicalLineageSlotPayload(identity));
}

export function buildDecisionImpactIdentityPayload(
  identity: DecisionImpactIdentity,
): Record<string, unknown> {
  const sortedIndicators = [...identity.indicators].sort((a, b) =>
    a.code.localeCompare(b.code),
  );
  const sortedEvidenceHashes = [...identity.evidence_set_hashes].sort();

  return cleanPayload({
    jurisdiction_level: identity.jurisdiction_level,
    decision_type: identity.decision_type,
    municipality_code: identity.municipality_code,
    county_code: identity.county_code,
    country_code: identity.country_code,
    period_start: identity.period_start,
    period_end: identity.period_end,
    evidence_set_hashes: sortedEvidenceHashes,
    indicators: sortedIndicators,
    schema_version: identity.schema_version,
    derivation_version: identity.derivation_version,
  });
}

/**
 * Deterministic, version-bound SHA-256 over DecisionImpactIdentity.
 */
export function hashDecisionImpactIdentity(identity: DecisionImpactIdentity): string {
  return hashVersionedCanonicalPayload(buildDecisionImpactIdentityPayload(identity));
}
