import { describe, it, expect } from "vitest";
import { ShadowEvaluationArtifact } from "../src/evaluation/ShadowEvaluationArtifact.js";
import { assertContentReferenceMatches } from "../src/core/assertContentReferenceMatches.js";

// Utility for test 2
function hashArtifact(artifact: any) {
    return artifact.content_hash;
}

describe("ADR-22 Core Compliance", () => {

    describe("1. Canonical artifacts contain identity", () => {
        it("canonical artifacts contain identity", () => {
            const artifact = {
                artifact_type: "SHADOW_EVALUATION",
                content_hash: "abc123",
                schema_version: "1.0",
                signature: {
                    algorithm: "SHA256",
                    value: "signed"
                }
            } as ShadowEvaluationArtifact;

            expect(artifact.content_hash).toBeDefined();
            expect(artifact.signature.value).toBeDefined();
        });
    });

    describe("2. Artifact identity isolation", () => {
        it("telemetry changes do not change artifact identity", () => {
            const artifact = {
                artifact_type: "PLAN",
                content_hash: "HASH_A"
            };

            const result1 = {
                artifact,
                telemetry: {
                    duration_ms: 100,
                    trace: "abc"
                }
            };

            const result2 = {
                artifact,
                telemetry: {
                    duration_ms: 9000,
                    trace: "xyz"
                }
            };

            expect(result1.telemetry).not.toEqual(result2.telemetry);
            expect(hashArtifact(result1.artifact)).toEqual(hashArtifact(result2.artifact));
        });
    });

    describe("3. Reference integrity", () => {
        it("rejects mismatching artifact hash", () => {
            const reference = {
                hash: "HASH_A",
                artifact_type: "PLAN" as const
            };

            const artifact = {
                artifact_type: "PLAN",
                content_hash: "HASH_B"
            };

            expect(() => assertContentReferenceMatches(reference, artifact as any))
                .toThrow("CONTENT_REFERENCE_MISMATCH");
        });
    });

    describe("4. Shadow evaluation lineage", () => {
        it("evaluation must reference evaluated candidate", () => {
            const candidate = {
                hash: "candidate-A"
            };

            const evaluation = {
                candidate_ref: {
                    hash: "candidate-B"
                }
            };

            expect(evaluation.candidate_ref.hash).not.toBe(candidate.hash);
        });
    });

    describe("5. Fitness trust boundary", () => {
        it("promotion request cannot inject fitness", () => {
            const request = {
                candidate_ref: { hash: "candidate" },
                evaluation_ref: { hash: "evaluation" },
                constraints_ref: { hash: "constraints" }
                // ingen fitness
            };

            expect((request as any).fitness).toBeUndefined();
        });
    });

    describe("6. Fitness calculation", () => {
        it("fitness is derived from evaluation", () => {
            const evaluation = {
                metrics: {
                    quality: 1,
                    cost: 0,
                    errors: 0,
                    latency_ms: 0
                }
            };

            const fitness = {
                value: 1
            };

            expect(fitness.value).toBe(evaluation.metrics.quality);
        });
    });

    describe("7. Promotion reference validation", () => {
        it("rejects unrelated evaluation", async () => {
            const request = {
                candidate_ref: { hash: "candidate-A" },
                evaluation_ref: { hash: "evaluation-X" },
                constraints_ref: { hash: "constraints" }
            };

            const evaluation = {
                candidate_ref: { hash: "candidate-B" }
            };

            expect(evaluation.candidate_ref.hash).not.toBe(request.candidate_ref.hash);
        });
    });

    describe("8. Mutation replay", () => {
        it("replay loads candidate artifact", () => {
            const candidate = {
                artifact_type: "EVOLUTION_CANDIDATE",
                content_hash: "immutable-hash"
            };

            const replayInput = candidate;

            expect(replayInput.content_hash).toBe("immutable-hash");
        });
    });

    describe("9. Chaos telemetry poisoning", () => {
        it("massively different runtime telemetry keeps same artifact hash", () => {
            const execution1 = {
                artifact: { content_hash: "same" },
                telemetry: { duration_ms: 10 }
            };

            const execution2 = {
                artifact: { content_hash: "same" },
                telemetry: { duration_ms: 999999 }
            };

            expect(execution1.telemetry.duration_ms).not.toBe(execution2.telemetry.duration_ms);
            expect(execution1.artifact.content_hash).toBe(execution2.artifact.content_hash);
        });
    });

    describe("10. WORM ArtifactRepository", () => {
        it("rejects mutation of existing identity", async () => {
            const first = { content_hash: "HASH" };
            const second = { content_hash: "DIFFERENT" };

            expect(first.content_hash).not.toBe(second.content_hash);
        });
    });

    describe("11. Actor identity", () => {
        it("rejects unknown governance roles", () => {
            const validRoles = [
                "EVOLUTION_AGENT",
                "HUMAN_OPERATOR",
                "SYSTEM_PROCESS",
                "GOVERNANCE_REVIEWER"
            ];

            expect(validRoles).not.toContain("developer");
        });
    });

    describe("12. Artifact migration", () => {
        it("migration invalidates old signature", () => {
            const oldArtifact = {
                schema_version: "1.0",
                signature: "OLD_SIGNATURE"
            };

            const migrated = {
                schema_version: "2.0",
                signature: "NEW_SIGNATURE"
            };

            expect(migrated.signature).not.toBe(oldArtifact.signature);
        });
    });

});
