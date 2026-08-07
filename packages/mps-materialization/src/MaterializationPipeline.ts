/**
 * MaterializationPipeline — the only code path that creates Decision Authority.
 *
 * Constitutional order:
 *   resolve evidence → build facts → build EvidenceSet → lineage closure → build
 *   DecisionImpact → commit to CAS.
 *
 * Nothing becomes authoritative before lineage closure succeeds (C-03), and the
 * pipeline never computes identity itself (MAT-I02).
 */

import { buildDecisionFacts } from "./DecisionFactsBuilder.js";
import {
  buildDecisionImpactFromFacts,
  buildEvidenceSetFromFacts,
} from "./DecisionImpactBuilder.js";
import { LineageValidator } from "./LineageValidator.js";
import {
  MATERIALIZATION_VERSION,
  MaterializationContractError,
  RULE_VERSION,
  type MaterializationContract,
  type MaterializationResult,
  type MaterializationVersions,
  type VerifiedEvidenceSet,
} from "./MaterializationContract.js";
import {
  CasMaterializationRepository,
  type MaterializationRepository,
} from "./MaterializationRepository.js";
import { preVerifiedEvidenceResolver, type EvidenceResolver } from "./ports/EvidenceResolver.js";
import {
  decisionGovernanceIdentityProvider,
  type MaterializationIdentityProvider,
} from "./ports/MaterializationIdentityProvider.js";

export type MaterializationPipelineOptions = {
  readonly evidenceResolver?: EvidenceResolver;
  readonly lineageValidator?: LineageValidator;
  readonly identityProvider?: MaterializationIdentityProvider;
  readonly repository?: MaterializationRepository;
  readonly rule_version?: string;
  readonly materialization_version?: string;
};

export class MaterializationPipeline implements MaterializationContract {
  private readonly evidenceResolver: EvidenceResolver;
  private readonly lineageValidator: LineageValidator;
  private readonly identityProvider: MaterializationIdentityProvider;
  private readonly repository: MaterializationRepository;
  readonly versions: MaterializationVersions;

  constructor(options: MaterializationPipelineOptions = {}) {
    this.evidenceResolver = options.evidenceResolver ?? preVerifiedEvidenceResolver;
    this.lineageValidator = options.lineageValidator ?? new LineageValidator();
    this.identityProvider = options.identityProvider ?? decisionGovernanceIdentityProvider;
    this.repository = options.repository ?? new CasMaterializationRepository();
    this.versions = {
      canonical_version: this.identityProvider.canonical_version,
      rule_version: options.rule_version ?? RULE_VERSION,
      materialization_version: options.materialization_version ?? MATERIALIZATION_VERSION,
    };
  }

  materialize(evidenceSet: VerifiedEvidenceSet): MaterializationResult {
    for (const hash of evidenceSet.source_artifact_hashes) {
      if (!this.evidenceResolver.has(hash)) {
        throw new MaterializationContractError(
          "EVIDENCE_NOT_RESOLVABLE",
          `source artifact '${hash}' must be resolvable before materialization`,
        );
      }
    }

    const facts = buildDecisionFacts(evidenceSet, this.versions, this.identityProvider);
    const evidence_set = buildEvidenceSetFromFacts(facts, this.identityProvider);

    // C-03: authority is granted only after lineage closure succeeds.
    this.lineageValidator.commitAfterClosure(evidence_set);

    const built = buildDecisionImpactFromFacts(facts, evidence_set, this.identityProvider);

    this.repository.putEvidenceSet(evidence_set);
    this.repository.putImpact(built.impact);

    return {
      status: "CREATED",
      artifact: built.impact,
      evidence_set,
      evidence_set_hash: evidence_set.evidence_set_hash,
      canonical_payload: built.canonical_payload,
      versions: this.versions,
    };
  }
}
