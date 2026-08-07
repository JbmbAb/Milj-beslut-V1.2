/**
 * MIMER-BUD-I01..I04 constitutional tests
 */
import { describe, expect, it } from "vitest";
import { evaluateRetrieval } from "../../mps-retrieval-governance/src/index.js";
import {
  DEFAULT_QUERY_BUDGET_POLICY,
  evaluateQueryBudget,
  InMemoryBudgetTelemetry,
  MIMER_BUD_I04,
  QueryBudgetError,
  type QueryBudgetPolicy,
} from "../src/index.js";

const identitySnapshot = {
  artifact_hash: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  decision_identity_hash:
    "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  materialization_hash:
    "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
};

function authorizedPlan() {
  return evaluateRetrieval({
    intent: "Visa utvecklingen av avloppsärenden i Värmland",
    expand_evidence: true,
  });
}

describe("MIMER-BUD-I01 Budget Isolation", () => {
  it("same query/policy/snapshot with different budget limits does not change identity hashes", () => {
    const authorized = authorizedPlan();
    const metrics = {
      artifact_count: 17,
      evidence_expansion_count: 2,
      token_proxy: 500,
      reranker_cost: 1,
    };

    const tight: QueryBudgetPolicy = {
      ...DEFAULT_QUERY_BUDGET_POLICY,
      soft_limit: 0.01,
      hard_observe_limit: 0.05,
    };
    const loose: QueryBudgetPolicy = {
      ...DEFAULT_QUERY_BUDGET_POLICY,
      soft_limit: 1000,
      hard_observe_limit: 10000,
    };

    const a = evaluateQueryBudget({
      authorized,
      metrics,
      identity_passthrough: identitySnapshot,
      budget_policy: tight,
    });
    const b = evaluateQueryBudget({
      authorized,
      metrics,
      identity_passthrough: identitySnapshot,
      budget_policy: loose,
    });

    expect(a.identity_passthrough).toEqual(identitySnapshot);
    expect(b.identity_passthrough).toEqual(identitySnapshot);
    expect(a.identity_passthrough.artifact_hash).toBe(
      b.identity_passthrough.artifact_hash,
    );
    expect(a.identity_passthrough.decision_identity_hash).toBe(
      b.identity_passthrough.decision_identity_hash,
    );
    expect(a.identity_passthrough.materialization_hash).toBe(
      b.identity_passthrough.materialization_hash,
    );
    // Authorized plan selection unchanged by budget.
    expect(a.authorized_plan).toEqual(b.authorized_plan);
  });
});

describe("MIMER-BUD-I02 Budget Is Operational Only", () => {
  it("allows PARTIAL status, never rewrites decision facts / truth", () => {
    const authorized = authorizedPlan();
    const result = evaluateQueryBudget({
      authorized,
      metrics: {
        artifact_count: 1000,
        evidence_expansion_count: 50,
        token_proxy: 100_000,
        reranker_cost: 10,
      },
      identity_passthrough: identitySnapshot,
      budget_policy: {
        ...DEFAULT_QUERY_BUDGET_POLICY,
        soft_limit: 0.01,
        hard_observe_limit: 0.1,
      },
    });

    expect(result.status).toBe("PARTIAL");
    expect(result.reason).toMatch(/QUERY_BUDGET_/);
    expect(result.continued).toBe(true);
    expect(result).not.toHaveProperty("decision_facts");
    expect(result.identity_passthrough).toEqual(identitySnapshot);
  });
});

describe("MIMER-BUD-I03 Soft Failure First", () => {
  it("emits telemetry and continues (never blocks)", () => {
    const telemetry = new InMemoryBudgetTelemetry();
    const authorized = authorizedPlan();
    const result = evaluateQueryBudget({
      authorized,
      metrics: {
        artifact_count: 500,
        evidence_expansion_count: 20,
        token_proxy: 50_000,
        reranker_cost: 5,
      },
      budget_policy: {
        ...DEFAULT_QUERY_BUDGET_POLICY,
        soft_limit: 0.01,
        hard_observe_limit: 1,
      },
      telemetry,
      override: true,
    });

    expect(result.continued).toBe(true);
    expect(telemetry.ofType("QUERY_BUDGET_ESTIMATED").length).toBe(1);
    expect(
      telemetry.ofType("QUERY_BUDGET_WARNING").length +
        telemetry.ofType("QUERY_BUDGET_EXCEEDED").length,
    ).toBeGreaterThanOrEqual(1);
    expect(telemetry.ofType("QUERY_BUDGET_OVERRIDE").length).toBe(1);
  });
});

describe("MIMER-BUD-I04 Budget Cannot Hide Policy Violations", () => {
  it("refuses to authorize RawDocumentChunk via high budget", () => {
    // Policy denied raw on GENERAL — expand_raw stays false.
    const authorized = evaluateRetrieval({
      intent: "general overview",
      expand_raw: true,
      expand_evidence: true,
      requested_initial: "DecisionImpactArtifact",
    });
    expect(authorized.expand_raw).toBe(false);
    expect(authorized.denied_reasons).toContain("raw_expansion_denied_by_policy");

    // High budget must not flip expand_raw back on.
    const result = evaluateQueryBudget({
      authorized,
      metrics: {
        artifact_count: 1,
        evidence_expansion_count: 0,
        token_proxy: 10,
        reranker_cost: 0,
      },
      budget_policy: {
        ...DEFAULT_QUERY_BUDGET_POLICY,
        soft_limit: 1_000_000,
        hard_observe_limit: 10_000_000,
      },
    });
    expect(result.authorized_plan.expand_raw).toBe(false);
  });

  it("rejects unauthorized initial class (forged plan)", () => {
    const forged = {
      ...authorizedPlan(),
      initial_artifact_class: "RawDocumentChunk" as unknown as "DecisionImpactArtifact",
    };
    expect(() =>
      evaluateQueryBudget({
        authorized: forged,
        metrics: {
          artifact_count: 1,
          evidence_expansion_count: 0,
          token_proxy: 1,
          reranker_cost: 0,
        },
      }),
    ).toThrow(QueryBudgetError);
    try {
      evaluateQueryBudget({
        authorized: forged,
        metrics: {
          artifact_count: 1,
          evidence_expansion_count: 0,
          token_proxy: 1,
          reranker_cost: 0,
        },
      });
    } catch (e) {
      expect((e as QueryBudgetError).code).toBe("MIMER_BUD_I04_VIOLATION");
      expect((e as QueryBudgetError).message).toContain(MIMER_BUD_I04);
    }
  });
});
