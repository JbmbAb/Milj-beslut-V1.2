/**
 * Deterministic Materialization Pipeline.
 * CAS-first; lineage before EvidenceSet commit; version-bound hashes.
 */

import {
  buildDecisionImpactIdentityPayload,
  hashDecisionImpactIdentity,
  hashEvidenceSetIdentity,
  hashVersionedCanonicalPayload,
  serializeCanonicalPayload,
} from "./CanonicalDecisionImpactHash";
import type { DecisionImpactArtifact, DecisionImpactIdentity } from "./DecisionImpactIdentity";
import type { EvidenceSetArtifact, EvidenceSetIdentity } from "./EvidenceSetArtifact";
import type { DecisionKnowledgeRepository } from "./DecisionKnowledgeRepository";
import {
  MaterializationError,
  type CanonicalMaterializationSource,
  type MaterializationOutcome,
  type MaterializationStep,
} from "./MaterializationContract";
import {
  InMemoryEvidenceSetLineageStore,
  type EvidenceSetLineageResolver,
} from "./validation/validateEvidenceSetLineage";

export type MaterializationPipelineDeps = {
  readonly repository: DecisionKnowledgeRepository;
  readonly lineageStore?: EvidenceSetLineageResolver & {
    append?(artifact: EvidenceSetArtifact): void;
  };
};

function buildEvidenceIdentity(
  source: CanonicalMaterializationSource,
  lineage_sequence: number,
  previous_evidence_set_hash?: string,
): EvidenceSetIdentity {
  return {
    documents: source.source_document_hashes.map((document_hash) => {
      const ref: {
        document_hash: string;
        municipality_code?: string;
        county_code?: string;
        country_code?: string;
      } = { document_hash };
      if (source.municipality_code !== undefined) {
        ref.municipality_code = source.municipality_code;
      }
      if (source.county_code !== undefined) {
        ref.county_code = source.county_code;
      }
      if (source.country_code !== undefined) {
        ref.country_code = source.country_code;
      }
      return ref;
    }),
    schema_version: source.schema_version,
    ...(previous_evidence_set_hash !== undefined
      ? { previous_evidence_set_hash }
      : {}),
    lineage_sequence,
    lineage_scope: {
      jurisdiction_level: source.jurisdiction_level,
      decision_type: source.decision_type,
    },
  };
}

function buildImpactIdentity(
  source: CanonicalMaterializationSource,
  evidence_set_hash: string,
): DecisionImpactIdentity {
  return {
    jurisdiction_level: source.jurisdiction_level,
    decision_type: source.decision_type,
    ...(source.municipality_code !== undefined
      ? { municipality_code: source.municipality_code }
      : {}),
    ...(source.county_code !== undefined ? { county_code: source.county_code } : {}),
    ...(source.country_code !== undefined ? { country_code: source.country_code } : {}),
    evidence_set_hashes: [evidence_set_hash],
    indicators: [source.indicator],
    schema_version: source.schema_version,
    derivation_version: source.derivation_version,
  };
}

/**
 * Idempotent materialization:
 * 1. Build EvidenceSet + DecisionImpact identities deterministically
 * 2. CAS lookup on impact_id — reuse if present
 * 3. Lineage closure MUST succeed before EvidenceSet becomes authoritative
 * 4. Then repository commit
 *
 * Constitutional: No EvidenceSet SHALL become authoritative before lineage closure succeeds.
 */
export class DeterministicMaterializationPipeline {
  private readonly lineage: InMemoryEvidenceSetLineageStore | (EvidenceSetLineageResolver & {
    append?(artifact: EvidenceSetArtifact): void;
  });

  constructor(private readonly deps: MaterializationPipelineDeps) {
    this.lineage = deps.lineageStore ?? new InMemoryEvidenceSetLineageStore();
  }

  materialize(source: CanonicalMaterializationSource): MaterializationOutcome {
    if (source.source_document_hashes.length === 0) {
      throw new MaterializationError(
        "MATERIALIZATION_SOURCE_EMPTY",
        "CanonicalMaterializationSource requires at least one source_document_hash",
      );
    }

    const steps: MaterializationStep[] = ["CAS_LOOKUP"];

    const facts_document_hash = hashVersionedCanonicalPayload({
      kind: "decision_facts",
      facts: source.decision_facts,
    });
    const evidenceIdentity = buildEvidenceIdentity(
      {
        ...source,
        source_document_hashes: [
          ...source.source_document_hashes,
          facts_document_hash,
        ],
      },
      1,
    );
    const evidence_set_hash = hashEvidenceSetIdentity(evidenceIdentity);
    const impactIdentity = buildImpactIdentity(source, evidence_set_hash);
    const impact_id = hashDecisionImpactIdentity(impactIdentity);
    const canonical_payload = serializeCanonicalPayload(
      buildDecisionImpactIdentityPayload(impactIdentity),
    );

    const existing = this.deps.repository.getDecisionImpact(impact_id);
    if (existing) {
      return Object.freeze({
        status: "REUSED",
        steps: Object.freeze([...steps]) as readonly MaterializationStep[],
        impact_id,
        canonical_payload,
      });
    }

    steps.push("PARSE_EXTRACT", "DECISION_FACTS", "DECISION_IMPACT");

    const evidenceArtifact: EvidenceSetArtifact = {
      evidence_set_hash,
      identity: evidenceIdentity,
      metadata: {
        created_at: "1970-01-01T00:00:00.000Z",
        materialization_version: "pipeline-1",
        generated_by: "DeterministicMaterializationPipeline",
      },
    };

    // C-03: Build → Verify lineage → only then Commit (never reverse).
    if (!("append" in this.lineage) || typeof this.lineage.append !== "function") {
      throw new MaterializationError(
        "LINEAGE_STORE_REQUIRED",
        "Lineage store with append() is required before EvidenceSet can become authoritative",
      );
    }
    this.lineage.append(evidenceArtifact);

    // Authoritative only after lineage closure succeeded.
    steps.push("REPOSITORY_COMMIT");
    this.deps.repository.putEvidenceSet(evidenceArtifact);

    const impactArtifact: DecisionImpactArtifact = {
      impact_id,
      identity: impactIdentity,
      metadata: {
        created_at: "1970-01-01T00:00:00.000Z",
        materialization_version: "pipeline-1",
        generated_by: "DeterministicMaterializationPipeline",
      },
    };
    this.deps.repository.putDecisionImpact(impactArtifact);

    return Object.freeze({
      status: "CREATED",
      steps: Object.freeze([...steps]) as readonly MaterializationStep[],
      impact_id,
      canonical_payload,
      evidence_set_hash,
    });
  }
}
