// packages/mps-materialization/src/MaterializationPipeline.ts

import type { EvidenceSetArtifact } from "../../mps-decision-governance/src/EvidenceSetArtifact";
import type { DecisionImpactArtifact, DecisionImpactIdentity, DecisionImpactMetadata } from "../../mps-decision-governance/src/DecisionImpactIdentity";
import { validateEvidenceSetLineage, EvidenceSetLineageResolver } from "../../mps-decision-governance/src/validation/validateEvidenceSetLineage";
import { MaterializationContract, MaterializationContext } from "./MaterializationContract";
import { DecisionFactsBuilder } from "./DecisionFactsBuilder";
import { DecisionImpactFactory } from "./DecisionImpactFactory";
import { EvidenceResolver } from "./ports/EvidenceResolver";
import { DecisionRepository } from "./ports/DecisionRepository";

export class MaterializationPipeline implements MaterializationContract {
  constructor(
    readonly canonicalizer_id: string,
    readonly materialization_version: string,
    readonly rule_version: string,
    private readonly evidenceResolver: EvidenceResolver,
    private readonly decisionRepository: DecisionRepository,
    private readonly lineageResolver: EvidenceSetLineageResolver
  ) {}

  /**
   * Materialiserar ett fryst evidensset till ett omutligt beslutsfakta-artefakt.
   * Följer strikt plattformens 8-stegade ordnings-invariant (Pipeline Invariant).
   */
  async materialize(
    evidenceSet: EvidenceSetArtifact,
    context: MaterializationContext
  ): Promise<DecisionImpactArtifact> {
    
    // --- STEG 1: Resolve evidence references ---
    const resolvedEvidence = await this.evidenceResolver.resolve(evidenceSet.evidence_set_hash);
    if (!resolvedEvidence) {
      throw new Error(`[MAT Violation] Evidence set '${evidenceSet.evidence_set_hash}' must be resolved in repository before materialization.`);
    }

    // --- STEG 2: Verify artifacts ---
    // Verifiera att det mottagna evidenssetets interna hash stämmer
    if (resolvedEvidence.evidence_set_hash !== evidenceSet.evidence_set_hash) {
      throw new Error(`[MAT Violation] Integrity mismatch in resolved evidence set.`);
    }

    // --- STEG 3: Validate lineage closure (MAT-I01) ---
    // Detta garanterar att hela historiken och sekvensordningen är intakt före godkännande!
    validateEvidenceSetLineage(resolvedEvidence, this.lineageResolver);

    // --- STEG 4: Build DecisionFacts ---
    const indicators = DecisionFactsBuilder.buildIndicators(resolvedEvidence, this.rule_version);

    // --- STEG 5: Create DecisionImpact payload ---
    const identity = DecisionImpactFactory.createIdentity({
      jurisdiction_level: context.jurisdiction_level,
      decision_type: context.decision_type,
      municipality_code: context.municipality_code,
      evidence_set_hashes: [resolvedEvidence.evidence_set_hash],
      indicators,
      schema_version: context.schema_version,
      derivation_version: this.materialization_version
    });

    // --- STEG 6 & 7: Request identity & CAS Save ---
    // Vi skickar identiteten och metadata till vårt strama DecisionArtifactRepository (CAS-lager).
    // Det är där och ENDAST där som den kanoniska hashen beräknas och registreras!
    const metadata: DecisionImpactMetadata = {
      created_at: new Date().toISOString(),
      materialization_version: this.materialization_version,
      generated_by: `Materializer Pipeline v${this.materialization_version}`
    };

    const artifact = await this.decisionRepository.save(identity, metadata);

    // --- STEG 8: Return artifact reference ---
    return artifact;
  }
}
