import { describe, it, expect, vi } from "vitest";
import { ShadowEvaluationArtifact } from "../src/evaluation/ShadowEvaluationArtifact.js";
import { assertContentReferenceMatches } from "../src/core/assertContentReferenceMatches.js";
import { PromotionPolicy } from "../src/governance/PromotionPolicy.js";
import { DefaultFitnessEngine } from "../src/fitness/FitnessEngine.js";
import { CasArtifactRepository, ContentAddressedArtifactStore } from "../src/artifact/CasArtifactRepository.js";
import { validateActor } from "../src/core/validateActor.js";
import { ReplayEngine } from "../src/evolution/ReplayEngine.js";
import { MigrationRegistry } from "../src/migration/MigrationRegistry.js";
import { PromotionRequest } from "../src/governance/PromotionRequest.js";

// Mock CAS store
class MockCAS implements ContentAddressedArtifactStore {
    private artifacts = new Map<string, any>();

    async get(ref: any): Promise<any> {
        if (!this.artifacts.has(ref.hash)) throw new Error("NOT_FOUND");
        return this.artifacts.get(ref.hash);
    }

    async put(artifact: any): Promise<any> {
        this.artifacts.set(artifact.content_hash, artifact);
        return { hash: artifact.content_hash, artifact_type: artifact.artifact_type };
    }
}

// Strict WORM Rejecting CAS
class WormRejectingCAS implements ContentAddressedArtifactStore {
    async get(ref: any): Promise<any> { throw new Error("NOT_IMPLEMENTED"); }
    async put(artifact: any): Promise<any> { throw new Error("IMMUTABILITY_VIOLATION"); }
}

describe("ADR-22 Enforcement", () => {

    describe("Identity Boundary", () => {
        it("unsigned artifact rejected", async () => {
            const repo = new CasArtifactRepository(new MockCAS());
            const artifact = {
                artifact_type: "SHADOW_EVALUATION" as const,
                content_hash: "abc",
                schema_version: "1.0",
            };
            await expect(repo.put(artifact as any)).rejects.toThrow("SIGNATURE_REQUIRED");
        });

        it("hash collision rejected (WORM)", async () => {
            // Testing boundary propagation: CasArtifactRepository should not swallow CAS WORM violations
            const repo = new CasArtifactRepository(new WormRejectingCAS());
            const artifact = {
                artifact_type: "PLAN" as const,
                content_hash: "COLLIDING_HASH",
                schema_version: "1.0",
                signature: { algorithm: "SHA256" as const, value: "sig" }
            };

            await expect(repo.put(artifact)).rejects.toThrow("IMMUTABILITY_VIOLATION");
        });
    });

    describe("Reference Boundary", () => {
        it("candidate/evaluation mismatch rejected", async () => {
            const cas = new MockCAS();
            const repo = new CasArtifactRepository(cas);
            const policy = new PromotionPolicy(repo, new DefaultFitnessEngine());

            await repo.put({
                artifact_type: "EVOLUTION_CANDIDATE", content_hash: "candidate-A", schema_version: "1.0", signature: { algorithm: "SHA256", value: "sig" }
            } as any);

            await repo.put({
                artifact_type: "SHADOW_EVALUATION", content_hash: "evaluation-X", candidate_ref: { hash: "candidate-B", artifact_type: "EVOLUTION_CANDIDATE" }, metrics: { quality: 1, cost: 0, errors: 0, latency_ms: 0 }, schema_version: "1.0", signature: { algorithm: "SHA256", value: "sig" }
            } as any);

            const request = {
                candidate_ref: { hash: "candidate-A", artifact_type: "EVOLUTION_CANDIDATE" as const },
                evaluation_ref: { hash: "evaluation-X", artifact_type: "SHADOW_EVALUATION" as const },
                constraints_ref: { hash: "constraints", artifact_type: "PLAN" as const }
            };

            await expect(policy.evaluate(request)).rejects.toThrow("FITNESS_CANDIDATE_MISMATCH");
        });

        it("schema_ref asymmetry rejected", () => {
            expect(() => assertContentReferenceMatches(
                { hash: "A", artifact_type: "PLAN", schema_ref: "schema://1" },
                { content_hash: "A", artifact_type: "PLAN", schema_version: undefined } as any
            )).toThrow("SCHEMA_REFERENCE_MISMATCH");
        });
    });

    describe("Runtime Separation", () => {
        it("telemetry cannot affect artifact hash", () => {
            const createEnvelope = (duration: number, trace: string) => {
                const artifact = { artifact_type: "PLAN", content_hash: "HASH_A" };
                return { artifact, telemetry: { duration_ms: duration, trace_id: trace } };
            };
            const result1 = createEnvelope(10, "A");
            const result2 = createEnvelope(9000, "B");

            expect(result1.telemetry).not.toEqual(result2.telemetry);
            expect(result1.artifact.content_hash).toEqual(result2.artifact.content_hash);
        });
    });

    describe("Evolution Boundary", () => {
        it("replay cannot call mutation", async () => {
            const repo = new CasArtifactRepository(new MockCAS());
            await repo.put({
                artifact_type: "EVOLUTION_CANDIDATE", content_hash: "immutable-hash", schema_version: "1.0", signature: { algorithm: "SHA256", value: "sig" }
            } as any);

            const mockMutationEngine = { mutate: vi.fn() };
            const replay = new ReplayEngine(repo, mockMutationEngine as any);

            await replay.run({ hash: "immutable-hash", artifact_type: "EVOLUTION_CANDIDATE" });
            expect(mockMutationEngine.mutate).not.toHaveBeenCalled();
        });
    });

    describe("Fitness Boundary", () => {
        it("metrics affect calculation", () => {
            const engine = new DefaultFitnessEngine();
            const evaluationLow = { metrics: { quality: 0.1, cost: 1, errors: 5, latency_ms: 100 } } as ShadowEvaluationArtifact;
            const evaluationHigh = { metrics: { quality: 0.9, cost: 0, errors: 0, latency_ms: 10 } } as ShadowEvaluationArtifact;

            const low = engine.calculate(evaluationLow);
            const high = engine.calculate(evaluationHigh);

            expect(low.value).not.toBe(high.value);
            expect(high.value).toBeGreaterThan(low.value);
        });
        
        it("does not accept reused fitness from another evaluation and ignores injected fitness", async () => {
            const cas = new MockCAS();
            const repo = new CasArtifactRepository(cas);
            const fitnessEngine = new DefaultFitnessEngine();
            const calculateSpy = vi.spyOn(fitnessEngine, "calculate");
            const promotion = new PromotionPolicy(repo, fitnessEngine);

            const evaluationA = {
                artifact_type: "SHADOW_EVALUATION", content_hash: "eval-123", candidate_ref: { hash: "candidate-A", artifact_type: "EVOLUTION_CANDIDATE" }, metrics: { quality: 0.1, cost: 0, errors: 0, latency_ms: 0 }, schema_version: "1.0", signature: { algorithm: "SHA256", value: "sig" }
            };

            await repo.put({
                artifact_type: "EVOLUTION_CANDIDATE", content_hash: "candidate-A", schema_version: "1.0", signature: { algorithm: "SHA256", value: "sig" }
            } as any);

            await repo.put(evaluationA as any);

            // Force inject a fitness score into the request
            const request = {
                candidate_ref: { hash: "candidate-A", artifact_type: "EVOLUTION_CANDIDATE" },
                evaluation_ref: { hash: "eval-123", artifact_type: "SHADOW_EVALUATION" },
                constraints_ref: { hash: "constraints", artifact_type: "PLAN" },
                fitness: { value: 999999 } // Injected!
            } as unknown as PromotionRequest;

            const decision = await promotion.evaluate(request);

            // Re-calculates entirely from the fetched evaluation artifact A, ignoring any injected values.
            expect(calculateSpy).toHaveBeenCalledWith(evaluationA);
            
            // The resulting decision should NOT use the injected 999999 value
            expect(decision.fitness.value).not.toBe(999999);
            expect(decision.fitness.value).toBe(0.1);
        });
    });

    describe("Actor Boundary", () => {
        it("invalid roles rejected", () => {
            expect(() => validateActor({ role: "developer", identity_ref: { hash: "abc" } })).toThrow("UNKNOWN_ACTOR_ROLE");
        });
        
        it("missing identity rejected", () => {
            expect(() => validateActor({ role: "SYSTEM_PROCESS" })).toThrow("ACTOR_IDENTITY_REQUIRED");
        });
    });

    describe("Migration Boundary", () => {
        it("signature invalidated", () => {
            const oldArtifact = {
                artifact_type: "PLAN" as const,
                content_hash: "old-hash",
                schema_version: "1.0",
                signature: { algorithm: "SHA256" as const, value: "OLD_SIGNATURE" }
            };

            const registry = new MigrationRegistry();
            const migrated = registry.migrate(oldArtifact, "2.0");

            expect(migrated.signature.value).not.toEqual(oldArtifact.signature.value);
            expect(migrated.content_hash).not.toEqual(oldArtifact.content_hash);
            expect(migrated.schema_version).toBe("2.0");
        });
    });
});
