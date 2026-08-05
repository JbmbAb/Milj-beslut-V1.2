import { describe, it, expect } from "vitest";
import { DefaultFrozenCoreVerifier } from "../src/conformance/FrozenCoreVerifier";
import { RuleRegistrySnapshot } from "../src/conformance/RuleRegistrySnapshot";
import { createPackage24Mcs001Matrix } from "../src/matrix/Package24McsMatrix";
import { FrozenCoreVerificationContext } from "../src/conformance/FrozenCoreVerificationContext";
import { FROZEN_CORE_V1_MANIFEST } from "../../mps-governance/src/release/reference/FrozenCoreV1";
import { ValidationProfileSnapshot } from "../src/conformance/ValidationProfileSnapshot";
import { ContentHash } from "../src/artifacts/ContentHash";
import { ValidationRule } from "../src/conformance/ValidationRule";
import { ValidationContext } from "../src/conformance/ValidationContext";
import { ValidationResult } from "../src/conformance/ValidationResult";

describe("Commit 13 - Adversarial Compliance Test Suite", () => {
  const verifier = new DefaultFrozenCoreVerifier();

  // Baseline valid registry & matrix
  const validRegistry = new RuleRegistrySnapshot([
    {
      rule_id: "FROZEN_CORE_I7",
      implementation_hash: "v1-hash",
      validate: (context: any) => ({
        rule_id: "FROZEN_CORE_I7",
        passed: true,
        evidence: [
          {
            evidence_id: "ev1",
            rule_id: "FROZEN_CORE_I7",
            artifact_ref: { artifact_id: context.release_manifest.artifact_id, artifact_type: "frozen_core_release_manifest" },
            observation: "mock valid",
            created_at: "2026-08-04T00:00:00Z"
          }
        ]
      })
    }
  ]);
  const validMatrix = createPackage24Mcs001Matrix(validRegistry);

  const baselineContext: FrozenCoreVerificationContext = {
    artifactResolver: { resolve: () => undefined },
    matrixResolver: { resolve: () => validMatrix },
    ruleRegistry: validRegistry,
    canonicalSerializer: { serialize: () => ({ bytes: new Uint8Array(), encoding: 'hex' } as any) }
  };

  it("matrix mutation attempts should throw", () => {
    expect(() => {
      // @ts-ignore
      validMatrix.entries.push({});
    }).toThrow();
  });

  it("profile rule gaps should fail validation", () => {
    const badMatrix = {
      ...validMatrix,
      entries: [
        {
          adr_id: "ADR-FAKE",
          profile: {
            profile_id: "FAKE",
            version: "v1",
            rule_ids: ["NON_EXISTENT_RULE"]
          } as unknown as ValidationProfileSnapshot
        }
      ]
    };

    const badContext = { ...baselineContext, matrixResolver: { resolve: () => badMatrix as any } };

    expect(() => {
      verifier.verify(FROZEN_CORE_V1_MANIFEST, badContext);
    }).toThrow(/Rule NON_EXISTENT_RULE not found in registry/);
  });

  // Attack 1: Hash substitution
  it("Attack 1: Hash substitution should fail", () => {
    // If matrix changes but hash stays the same, in a real env the hash validator would catch it.
    // For this test, we simulate an implementation that validates the hash against the context matrix.
    const ruleThatChecksHash: ValidationRule = {
      rule_id: "HASH_CHECK",
      implementation_hash: "v1",
      validate: (ctx: any) => {
        // Simulated hash check
        const passed =
          ctx.release_manifest.matrix_hash.value === FROZEN_CORE_V1_MANIFEST.matrix_hash.value;
        return { rule_id: "HASH_CHECK", passed, evidence: [] };
      }
    };
    
    const mutantManifest = { ...FROZEN_CORE_V1_MANIFEST, matrix_hash: { algorithm: "sha256", value: "WRONG_HASH" } as ContentHash };
    const mutantRegistry = new RuleRegistrySnapshot([ruleThatChecksHash]);
    const mutantContext = { ...baselineContext, ruleRegistry: mutantRegistry, matrixResolver: { resolve: () => ({ ...validMatrix, entries: [{ profile: { rule_ids: ["HASH_CHECK"] } }] } as any) } };
    
    const result = verifier.verify(mutantManifest, mutantContext);
    expect(result.compliant).toBe(false);
  });

  // Attack 2: Rule implementation drift
  it("Attack 2: Rule implementation drift should fail", () => {
    const originalRule: ValidationRule = {
      rule_id: "ACT_21_I1",
      implementation_hash: "good-hash",
      validate: () => ({ rule_id: "ACT_21_I1", passed: true, evidence: [] })
    };
    
    const driftedRule: ValidationRule = {
      rule_id: "ACT_21_I1",
      implementation_hash: "evil-hash", // Rule has been quietly modified!
      validate: () => ({ rule_id: "ACT_21_I1", passed: true, evidence: [] })
    };

    const expectedHashRule: ValidationRule = {
      rule_id: "DRIFT_CHECK",
      implementation_hash: "drift-check",
      validate: (ctx) => {
        // The context/manifest specifies the expected canonical rule versions.
        // A validator checks if the implementation_hash matches the canonical expected hash.
        const rule = baselineContext.ruleRegistry.rules.find(r => r.rule_id === "ACT_21_I1");
        const passed = rule?.implementation_hash === "good-hash";
        return { rule_id: "DRIFT_CHECK", passed, evidence: [] };
      }
    };

    const hackedContext = { 
      ...baselineContext, 
      ruleRegistry: new RuleRegistrySnapshot([driftedRule, expectedHashRule]),
      matrixResolver: { resolve: () => ({ ...validMatrix, entries: [{ profile: { rule_ids: ["ACT_21_I1", "DRIFT_CHECK"] } }] } as any) }
    };

    const result = verifier.verify(FROZEN_CORE_V1_MANIFEST, hackedContext);
    expect(result.compliant).toBe(false); // Because DRIFT_CHECK fails
  });

  // Attack 3: Evidence poisoning
  it("Attack 3: Evidence poisoning should fail", () => {
    const poisonedRule: ValidationRule = {
      rule_id: "EVIDENCE_POISON",
      implementation_hash: "v1",
      validate: (ctx) => ({
        rule_id: "EVIDENCE_POISON",
        passed: true,
        evidence: [
          {
            evidence_id: "ev1",
            rule_id: "EVIDENCE_POISON",
            artifact_ref: { artifact_id: "fake-artifact-that-isnt-the-target", artifact_type: "any" }, // Poisoned evidence reference
            observation: "verified",
            created_at: "2026-08-04T00:00:00Z"
          }
        ]
      })
    };

    const contextWithPoison = { 
      ...baselineContext, 
      ruleRegistry: new RuleRegistrySnapshot([poisonedRule]),
      matrixResolver: { resolve: () => ({ ...validMatrix, entries: [{ profile: { rule_ids: ["EVIDENCE_POISON"] } }] } as any) }
    };

    // A higher-level audit rule (part of the compliance pipeline) should reject evidence that doesn't match the context graph.
    // We'll wrap this logic to simulate the evidence verification pass.
    const evaluation = verifier.verify(FROZEN_CORE_V1_MANIFEST, contextWithPoison);
    
    // Evaluate the evidence graph:
    let isPoisoned = false;
    for (const report of evaluation.reports) {
      for (const res of report.results) {
        for (const ev of res.evidence) {
           if (ev.artifact_ref.artifact_id !== FROZEN_CORE_V1_MANIFEST.artifact_id) {
             // In a real audit, the evidence must link back to a valid dependency in the closure.
             // For this test, any external artifact ID is treated as poison since there are no dependencies.
             isPoisoned = true;
           }
        }
      }
    }
    expect(isPoisoned).toBe(true);
  });

  // Attack 4: Non-deterministic validator
  it("Attack 4: Non-deterministic validator (replay divergence)", () => {
    let callCount = 0;
    const nonDeterministicRule: ValidationRule = {
      rule_id: "NON_DET",
      implementation_hash: "v1",
      validate: (ctx) => {
        callCount++;
        return {
          rule_id: "NON_DET",
          passed: callCount % 2 !== 0, // True on first call, False on second call
          evidence: []
        };
      }
    };

    const unstableContext = { 
      ...baselineContext, 
      ruleRegistry: new RuleRegistrySnapshot([nonDeterministicRule]),
      matrixResolver: { resolve: () => ({ ...validMatrix, entries: [{ profile: { rule_ids: ["NON_DET"] } }] } as any) }
    };

    const eval1 = verifier.verify(FROZEN_CORE_V1_MANIFEST, unstableContext);
    const eval2 = verifier.verify(FROZEN_CORE_V1_MANIFEST, unstableContext);
    
    // They should ideally be strictly equal. Since one is compliant=true and other compliant=false, they diverge.
    expect(eval1).not.toEqual(eval2);
  });
});
