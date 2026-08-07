/**
 * Policy determinism + versionability
 */
import { describe, expect, it } from "vitest";
import {
  assertMaterializationAuthority,
  MaterializationAuthorityError,
} from "../../mps-materialization/src/MaterializationAuthority.js";
import {
  assertRetrievalReadOnly,
  classifyQuery,
  createRetrievalPolicyRegistry,
  defaultRetrievalPolicyRegistry,
  evaluateRetrieval,
  RETRIEVAL_POLICY_VERSION,
} from "../src/index.js";

describe("PolicyDeterminism", () => {
  it("same intent ⇒ identical retrieval decision", () => {
    const intent = "DECISION_SUMMARY: sammanfattning av miljötillsyn";
    const a = evaluateRetrieval({ intent, expand_evidence: true });
    const b = evaluateRetrieval({ intent, expand_evidence: true });
    expect(a).toEqual(b);
    expect(a.policy.policy_version).toBe(RETRIEVAL_POLICY_VERSION);
  });

  it("classifyQuery is deterministic", () => {
    expect(classifyQuery("sammanfattning").query_type).toBe("DECISION_SUMMARY");
    expect(classifyQuery("sammanfattning").query_type).toBe("DECISION_SUMMARY");
    expect(classifyQuery("provenance audit").query_type).toBe("PROVENANCE_AUDIT");
  });

  it("registry is versionable and stable", () => {
    expect(defaultRetrievalPolicyRegistry.registry_version).toBe("ret-policy-1");
    const v1 = createRetrievalPolicyRegistry("ret-policy-1");
    const again = createRetrievalPolicyRegistry("ret-policy-1");
    expect(v1.resolve("GENERAL")).toEqual(again.resolve("GENERAL"));
    expect(v1.list()).toHaveLength(4);
  });

  it("MIMER-RET-I03: Retrieval actor cannot pass materialization write gate", () => {
    expect(() => assertMaterializationAuthority("Retrieval")).toThrow(
      MaterializationAuthorityError,
    );
    expect(() => assertRetrievalReadOnly("Retrieval")).not.toThrow();
    expect(() => assertRetrievalReadOnly("mps-retrieval")).not.toThrow();
  });
});
