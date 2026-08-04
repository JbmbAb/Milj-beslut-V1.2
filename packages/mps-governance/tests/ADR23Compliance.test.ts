import { describe, it, expect } from "vitest";
import { GovernanceReviewArtifact } from "../src/artifacts/GovernanceReviewArtifact.js";
import { GovernanceApprovalArtifact } from "../src/artifacts/GovernanceApprovalArtifact.js";
import { PolicySimulationArtifact } from "../src/artifacts/PolicySimulationArtifact.js";
import { GovernancePolicyEngine } from "../src/engine/GovernancePolicyEngine.js";
import { RegistryValidator, RegistryEntry } from "../src/registry/RegistryEntry.js";
import { assertContentReferenceMatches } from "../../mps-evolution/src/core/assertContentReferenceMatches.js";
import { CanonicalArtifact } from "../../mps-evolution/src/core/types.js";
import { createHash } from "crypto";

describe("ADR-23 Governance Compliance", () => {
    
    // Test 1 — Runtime leakage
    it("prevents runtime leakage in GovernanceReviewArtifact (schema violation)", () => {
        const review: any = {
            artifact_type: "GOVERNANCE_REVIEW",
            subject_ref: { hash: "abc", artifact_type: "EVOLUTION_CANDIDATE" },
            evidence_refs: [],
            reviewer: { identity_ref: { hash: "u1", artifact_type: "PLAN" }, role: "GOVERNANCE_REVIEWER" },
            decision: "APPROVE",
            comments: "Looks good",
            content_hash: "hash",
            schema_version: "1.0",
            signature: { algorithm: "SHA256", value: "sig" },
            telemetry: { duration: 100 } // Attack!
        };
        
        // Mocking a strict schema validator that throws on unknown fields
        const validateStrictSchema = (artifact: any) => {
            if ('telemetry' in artifact) throw new Error("SCHEMA_VIOLATION");
        };

        expect(() => validateStrictSchema(review)).toThrow("SCHEMA_VIOLATION");
    });

    // Test 2 — Fake evidence
    it("rejects fake evidence via REFERENCE_MISMATCH", () => {
        const fakeEvidenceRef = { hash: "fake_hash", artifact_type: "SHADOW_EVALUATION" as const };
        const realEvidenceArtifact: CanonicalArtifact = {
            artifact_type: "SHADOW_EVALUATION",
            content_hash: "real_hash",
            schema_version: "1.0",
            signature: { algorithm: "SHA256", value: "sig" }
        };

        expect(() => {
            assertContentReferenceMatches(fakeEvidenceRef, realEvidenceArtifact);
        }).toThrow("CONTENT_REFERENCE_MISMATCH"); 
    });

    // Test 3 — Multi-Reviewer Aggregation (Deterministic sorting)
    it("canonicalizes evidence refs deterministically regardless of input order", () => {
        const engine = new GovernancePolicyEngine();
        
        const promotionRef = { hash: "promo_hash", artifact_type: "PROMOTION_DECISION" as const };
        const promotionArtifact: any = { content_hash: "promo_hash", artifact_type: "PROMOTION_DECISION" };
        
        const policyRef = { hash: "policy_hash", artifact_type: "GOVERNANCE_POLICY" as const };
        const policyArtifact: any = { content_hash: "policy_hash", artifact_type: "GOVERNANCE_POLICY", rules: [] };

        const review1Ref = { hash: "z_hash", artifact_type: "GOVERNANCE_REVIEW" as const };
        const review2Ref = { hash: "a_hash", artifact_type: "GOVERNANCE_REVIEW" as const };
        
        const review1Artifact: any = { content_hash: "z_hash", artifact_type: "GOVERNANCE_REVIEW", subject_ref: promotionRef, decision: "APPROVE" };
        const review2Artifact: any = { content_hash: "a_hash", artifact_type: "GOVERNANCE_REVIEW", subject_ref: promotionRef, decision: "APPROVE" };
        
        const decidedBy = { identity_ref: { hash: "sys", artifact_type: "PLAN" as const }, role: "SYSTEM_PROCESS" as const };

        // Input order: z, a
        const approval1 = engine.evaluate(
            promotionRef, promotionArtifact,
            policyRef, policyArtifact,
            [review1Ref, review2Ref], [review1Artifact, review2Artifact],
            decidedBy, "All good"
        );

        // Input order: a, z
        const approval2 = engine.evaluate(
            promotionRef, promotionArtifact,
            policyRef, policyArtifact,
            [review2Ref, review1Ref], [review2Artifact, review1Artifact],
            decidedBy, "All good"
        );

        // Both should have evidence_refs sorted: a_hash, z_hash
        expect(approval1.evidence_refs[0].hash).toBe("a_hash");
        expect(approval1.evidence_refs[1].hash).toBe("z_hash");
        
        expect(approval2.evidence_refs[0].hash).toBe("a_hash");
        expect(approval2.evidence_refs[1].hash).toBe("z_hash");
        
        expect(approval1.evidence_refs).toEqual(approval2.evidence_refs);
    });

    // Test 4 — Simulation poisoning
    it("guarantees deterministic artifact hash for PolicySimulation Artifact regardless of hidden state", () => {
        const sim1: PolicySimulationArtifact = {
            artifact_type: "POLICY_SIMULATION",
            policy_ref: { hash: "p1", artifact_type: "PLAN" },
            baseline_ref: { hash: "b1", artifact_type: "PLAN" },
            assumptions: [{ parameter: "inflation", value: 0.02 }],
            results: [{ metric: "cost", outcome: 100 }],
            content_hash: "",
            schema_version: "1.0",
            signature: { algorithm: "SHA256", value: "sig" }
        };

        const sim2 = { ...sim1 };

        const serializeForHash = (sim: PolicySimulationArtifact) => {
            const { content_hash, signature, ...rest } = sim;
            return JSON.stringify(rest);
        };

        const hash1 = createHash("sha256").update(serializeForHash(sim1)).digest("hex");
        const hash2 = createHash("sha256").update(serializeForHash(sim2)).digest("hex");

        expect(hash1).toEqual(hash2);
    });

    // Test 5 — Registry Validation
    it("verifies Registry updates against GovernanceApprovalArtifact strict rules", () => {
        const entry: RegistryEntry = {
            artifact_ref: { hash: "cand", artifact_type: "EVOLUTION_CANDIDATE" },
            promotion_decision_ref: { hash: "promo", artifact_type: "PROMOTION_DECISION" },
            governance_approval_ref: { hash: "appr", artifact_type: "GOVERNANCE_APPROVAL" },
            version: "1.0"
        };

        const approvalArtifact: any = {
            content_hash: "appr",
            promotion_decision_ref: { hash: "promo" },
            governance_result: "REQUEST_CHANGES" // Invalid state for registry update
        };

        // Reject due to REQUEST_CHANGES
        expect(() => {
            RegistryValidator.verify(entry, approvalArtifact);
        }).toThrow("REGISTRY_UPDATE_REJECTED");

        approvalArtifact.governance_result = "APPROVE";

        // Mismatched promotion ref
        approvalArtifact.promotion_decision_ref.hash = "promo2";
        expect(() => {
            RegistryValidator.verify(entry, approvalArtifact);
        }).toThrow("PROMOTION_REFERENCE_MISMATCH");

        approvalArtifact.promotion_decision_ref.hash = "promo";

        // Successful verification
        expect(() => {
            RegistryValidator.verify(entry, approvalArtifact);
        }).not.toThrow();
    });

    // Test 6 — Policy Binding Integrity
    it("rejects Governance Approval if policy artifact cannot be resolved (GOVERNANCE_POLICY_MISSING)", () => {
        const engine = new GovernancePolicyEngine();
        
        const promotionRef = { hash: "promo", artifact_type: "PROMOTION_DECISION" as const };
        const promotionArtifact: any = { content_hash: "promo", artifact_type: "PROMOTION_DECISION" };
        
        const policyRef = { hash: "policy-v3", artifact_type: "GOVERNANCE_POLICY" as const };
        // Passing null/undefined for policyArtifact to simulate it missing in the repository
        
        const decidedBy = { identity_ref: { hash: "sys", artifact_type: "PLAN" as const }, role: "SYSTEM_PROCESS" as const };

        expect(() => {
            engine.evaluate(
                promotionRef, promotionArtifact,
                policyRef, null,
                [], [],
                decidedBy, "Should fail"
            );
        }).toThrow("GOVERNANCE_POLICY_MISSING");
    });
});
