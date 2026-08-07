import { PrismaClient } from '@prisma/client';
import { createHash } from 'crypto';
import { assertSingleMaterializationAuthority } from '../../../mps-materialization/src/MaterializationAuthority';

export interface DecisionImpactArtifactInput {
  artifact_hash: string;
  decision_ref: string;
  release_hash: string;
  municipality_id: string;
  decision_facts_hash: string;
  evidence_refs: any;
  source_artifact_hashes: any;
  semantic_version: string;
  materialization_version: string;
  extraction_model: string;
  rule_version: string;
  verification_status: string;
  lineage_sequence: number;
}

export class DecisionArtifactRepository {
  constructor(private prisma: PrismaClient) {}

  /**
   * Saves a new DecisionImpactArtifact.
   * MAT-I05: the caller must be a registered materialization authority.
   */
  async save(
    artifact: DecisionImpactArtifactInput,
    decision_facts: any,
    authority?: string,
  ) {
    assertSingleMaterializationAuthority(authority);
    return this.prisma.$transaction(async (tx) => {
      await tx.decisionFactsArtifact.upsert({
        where: { artifact_hash: artifact.decision_facts_hash },
        update: {},
        create: {
          artifact_hash: artifact.decision_facts_hash,
          facts: decision_facts
        }
      });
      return tx.decisionImpactArtifact.create({
        data: artifact,
      });
    });
  }

  /**
   * Retrieves an artifact by its CAS hash
   */
  async get(hash: string) {
    return this.prisma.decisionImpactArtifact.findUnique({
      where: { artifact_hash: hash },
    });
  }

  /**
   * Verifies the integrity of an artifact by re-hashing its canonical form
   */
  async verify(hash: string): Promise<boolean> {
    const artifact = await this.get(hash);
    if (!artifact) {
      return false;
    }

    // A canonical serialization would normally be used here, matching the artifact generation.
    // Assuming deterministic stringify for now.
    const canonicalPayload = JSON.stringify({
      decision_ref: artifact.decision_ref,
      release_hash: artifact.release_hash,
      municipality_id: artifact.municipality_id,
      decision_facts_hash: artifact.decision_facts_hash,
      evidence_refs: artifact.evidence_refs,
      source_artifact_hashes: artifact.source_artifact_hashes,
      semantic_version: artifact.semantic_version,
      materialization_version: artifact.materialization_version,
      extraction_model: artifact.extraction_model,
      rule_version: artifact.rule_version,
    });

    const computedHash = createHash('sha256').update(canonicalPayload).digest('hex');
    return computedHash === artifact.artifact_hash && artifact.verification_status === 'VERIFIED';
  }

  /**
   * Supersedes an old artifact with a new one.
   * MAT-I05: the caller must be a registered materialization authority.
   */
  async supersede(
    oldHash: string,
    newArtifact: DecisionImpactArtifactInput,
    decision_facts: any,
    authority?: string,
  ) {
    assertSingleMaterializationAuthority(authority);
    return this.prisma.$transaction(async (tx) => {
      const old = await tx.decisionImpactArtifact.findUnique({
        where: { artifact_hash: oldHash },
      });

      if (!old) {
        throw new Error(`Old artifact with hash ${oldHash} not found`);
      }

      await tx.decisionImpactArtifact.update({
        where: { artifact_hash: old.artifact_hash },
        data: { verification_status: 'SUPERSEDED' },
      });

      await tx.decisionFactsArtifact.upsert({
        where: { artifact_hash: newArtifact.decision_facts_hash },
        update: {},
        create: {
          artifact_hash: newArtifact.decision_facts_hash,
          facts: decision_facts
        }
      });

      return tx.decisionImpactArtifact.create({
        data: {
          ...newArtifact,
          supersedes_hash: old.artifact_hash,
        },
      });
    });
  }
}
