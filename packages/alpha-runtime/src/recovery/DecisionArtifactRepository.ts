import { PrismaClient } from '@prisma/client';
import { createHash } from 'crypto';

export interface DecisionImpactArtifactInput {
  decision_id: string;
  artifact_hash: string;
  release_hash: string;
  municipality_id: string;
  decision_facts: any;
  evidence_refs: any;
  source_artifact_hashes: any;
  semantic_version: string;
  materialization_version: string;
  verification_status: string;
}

export class DecisionArtifactRepository {
  constructor(private prisma: PrismaClient) {}

  /**
   * Saves a new DecisionImpactArtifact
   */
  async save(artifact: DecisionImpactArtifactInput) {
    return this.prisma.decisionImpactArtifact.create({
      data: artifact,
    });
  }

  /**
   * Retrieves an artifact by its CAS hash
   */
  async get(hash: string) {
    return this.prisma.decisionImpactArtifact.findFirst({
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
      decision_id: artifact.decision_id,
      release_hash: artifact.release_hash,
      municipality_id: artifact.municipality_id,
      decision_facts: artifact.decision_facts,
      evidence_refs: artifact.evidence_refs,
      source_artifact_hashes: artifact.source_artifact_hashes,
      semantic_version: artifact.semantic_version,
      materialization_version: artifact.materialization_version,
    });

    const computedHash = createHash('sha256').update(canonicalPayload).digest('hex');
    return computedHash === artifact.artifact_hash && artifact.verification_status === 'VERIFIED';
  }

  /**
   * Supersedes an old artifact with a new one
   */
  async supersede(oldHash: string, newArtifact: DecisionImpactArtifactInput) {
    return this.prisma.$transaction(async (tx) => {
      const old = await tx.decisionImpactArtifact.findFirst({
        where: { artifact_hash: oldHash },
      });

      if (!old) {
        throw new Error(`Old artifact with hash ${oldHash} not found`);
      }

      await tx.decisionImpactArtifact.update({
        where: { id: old.id },
        data: { verification_status: 'SUPERSEDED' },
      });

      return tx.decisionImpactArtifact.create({
        data: {
          ...newArtifact,
          supersedes: old.id,
        },
      });
    });
  }
}
