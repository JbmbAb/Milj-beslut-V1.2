import { PrismaClient } from '@prisma/client';
import { DecisionArtifactRepository } from '../recovery/DecisionArtifactRepository';
import { createHash } from 'crypto';

const prisma = new PrismaClient();
const repo = new DecisionArtifactRepository(prisma);

/**
 * QUARANTINED under MAT-I05 (Single Materialization Authority).
 *
 * This job is a second, unregistered truth producer: it mints its own artifact hash
 * with an ad-hoc JSON.stringify, bakes `extraction_model` into that hash (MAT-I04
 * violation), hardcodes lineage_sequence and bypasses lineage closure entirely.
 *
 * Its write path now fails at the repository gate. Migration path is Alternative A:
 * build a VerifiedEvidenceSet from the case and delegate to mps-materialization's
 * MaterializationPipeline, letting runtime orchestrate and materialization own authority.
 *
 * @deprecated Do not extend. See docs/architecture/ADR-MPS-SINGLE-MATERIALIZATION-AUTHORITY.md
 */
export class MaterializerJob {
  /**
   * Materializes a completed EnvironmentalCase or RequirementCase into a concise DecisionCase
   * and DecisionImpactArtifact to prevent the AI from having to read thousands of raw document chunks.
   * Enforces the MIMER-SCALE-I01 Projection Boundary.
   */
  static async materializeCase(caseId: string, municipality: string, ewcCode?: string, volumeClass?: string) {
    console.log(`Starting materialization for case: ${caseId}`);

    // Fetch the raw historical case and its evidence chunks (Simulated here)
    const envCase = await prisma.environmentalCase.findUnique({
      where: { caseId },
      include: { evidence: true },
    });

    if (!envCase) {
      throw new Error(`Case ${caseId} not found for materialization.`);
    }

    // Determine outcomes and timeline from raw data (stubbed logic for AI optimization)
    const outcome = "CONDITIONED"; 
    const hasComplementaryReq = true;
    const hasInjunction = false;

    // Create or update the DecisionCase (The Fact Layer)
    let decisionCase = await prisma.decisionCase.findFirst({
      where: { environmentalCaseId: envCase.id }
    });

    if (!decisionCase) {
      decisionCase = await prisma.decisionCase.create({
        data: {
          municipality,
          timelineStart: envCase.createdAt,
          timelineEnd: envCase.decisionDate || new Date(),
          outcome,
          ewcCode,
          volumeClass,
          hasComplementaryReq,
          hasInjunction,
          environmentalCaseId: envCase.id,
        },
      });
    }

    // Materialize the Impact Artifact - This is what the AI will read instead of raw chunks!
    const decisionFacts = {
      summary: `Ärendet ledde till ${outcome}. Komplettering krävdes.`,
      key_factors: ["EWC kod indikerade hög risk", "Närhet till vattenskyddsområde"],
      conditions_applied: ["Årlig provtagning", "Bullervall"]
    };

    const evidenceRefs = envCase.evidence.map(e => e.id);
    const sourceArtifactHashes = envCase.evidence.map(e => e.fileHash);

    // Compute facts hash
    const factsPayload = JSON.stringify(decisionFacts);
    const factsHash = createHash('sha256').update(factsPayload).digest('hex');

    // Compute canonical payload hash
    const canonicalPayload = JSON.stringify({
      decision_ref: decisionCase.id,
      release_hash: 'RELEASE_SIMULATION_HASH', // Should be drawn from the current system release version
      municipality_id: municipality,
      decision_facts_hash: factsHash,
      evidence_refs: evidenceRefs,
      source_artifact_hashes: sourceArtifactHashes,
      semantic_version: '1.0.0',
      materialization_version: 'v2',
      extraction_model: 'gemini-1.5-pro',
      rule_version: '1.0.0'
    });
    
    const artifactHash = createHash('sha256').update(canonicalPayload).digest('hex');

    // CAS lookup - Skip if already verified
    const existing = await repo.get(artifactHash);
    if (existing && existing.verification_status === 'VERIFIED') {
      console.log(`Artifact ${artifactHash} ALREADY_VERIFIED. Skipping materialization.`);
      return;
    }

    await repo.save({
      decision_ref: decisionCase.id,
      artifact_hash: artifactHash,
      release_hash: 'RELEASE_SIMULATION_HASH',
      municipality_id: municipality,
      decision_facts_hash: factsHash,
      evidence_refs: evidenceRefs,
      source_artifact_hashes: sourceArtifactHashes,
      semantic_version: '1.0.0',
      materialization_version: 'v2',
      extraction_model: 'gemini-1.5-pro',
      rule_version: '1.0.0',
      verification_status: 'VERIFIED',
      lineage_sequence: 1 // Start sequence for new facts
    }, decisionFacts);

    // Update the Municipality Profile (Aggregated stats)
    await this.updateMunicipalityProfile(municipality);

    console.log(`Successfully materialized DecisionCase ${decisionCase.id} for AI consumption.`);
  }

  private static async updateMunicipalityProfile(municipality: string) {
    const totalCases = await prisma.decisionCase.count({ where: { municipality } });
    const compReqCases = await prisma.decisionCase.count({ 
      where: { municipality, hasComplementaryReq: true } 
    });

    const completionRate = totalCases > 0 ? (compReqCases / totalCases) * 100 : 0;

    await prisma.municipalityDecisionProfile.upsert({
      where: { municipality },
      update: { completionRate, lastCalculatedAt: new Date() },
      create: { municipality, completionRate, lastCalculatedAt: new Date() },
    });
  }
}
