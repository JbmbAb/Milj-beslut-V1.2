import { describe, expect, it } from "vitest";
import {
  REJECT_RETENTION_DIGEST_EXCEEDS_LOCK_BUDGET,
  REJECT_RETENTION_DIGEST_TIME_UNMEASURED,
  RETENTION_DIGEST_PRECONDITIONS,
  RETENTION_TRANSACTION_TIMEOUT_MS,
  committedRetentionDigestPrecondition,
  evaluateRetentionDigestPrecondition,
  parseRetentionDigestPreconditions,
} from "../src/RetentionDigestPrecondition";

/** U30F F4: the digest-time precondition, pure (no database). */

function doc(targets: Record<string, unknown>) {
  return parseRetentionDigestPreconditions({
    contract: "spatial-retention-digest-preconditions-v1",
    transaction_timeout_ms: 600000,
    lock_budget_fraction: 0.5,
    digests_under_lock: 2,
    targets,
  });
}

const MEASURED = {
  status: "MEASURED",
  measured_rows: 4_400_000,
  measured_at: "2026-10-03T10:00:00Z",
  measured_by: "owner",
  environment: "demo PostGIS (miljobeslut-postgres)",
  measurement_evidence: "logs/measure-digest-property.log",
};

describe("committed preconditions", () => {
  it("the property layer is UNMEASURED: promote and backfill are refused until a measurement is committed", () => {
    expect(RETENTION_DIGEST_PRECONDITIONS.targets["env.registerenhetsomradesytor"]).toMatchObject({ status: "UNMEASURED" });
    expect(committedRetentionDigestPrecondition({ schema: "env", table: "registerenhetsomradesytor" })).toMatchObject({
      kind: "UNMET",
      code: REJECT_RETENTION_DIGEST_TIME_UNMEASURED,
    });
  });

  it("the promote transaction timeout is unchanged (600 s) and comes from the same file as the check", () => {
    expect(RETENTION_TRANSACTION_TIMEOUT_MS).toBe(600000);
  });

  it("layers not named are not affected", () => {
    expect(committedRetentionDigestPrecondition({ schema: "env", table: "sgu_well" })).toEqual({ kind: "NOT_REQUIRED" });
  });
});

describe("evaluation", () => {
  it("a measured time within the lock budget meets it; above the budget refuses", () => {
    expect(evaluateRetentionDigestPrecondition("env.p", doc({ "env.p": { ...MEASURED, measured_digest_seconds: 150 } }))).toEqual({
      kind: "MET",
      measured_digest_seconds: 150,
      budget_seconds: 300,
    });
    expect(evaluateRetentionDigestPrecondition("env.p", doc({ "env.p": { ...MEASURED, measured_digest_seconds: 150.5 } }))).toMatchObject({
      kind: "UNMET",
      code: REJECT_RETENTION_DIGEST_EXCEEDS_LOCK_BUDGET,
    });
  });

  it.each([
    ["no reason", { status: "UNMEASURED" }],
    ["unknown status", { status: "ASSUMED_OK" }],
    ["zero seconds", { ...MEASURED, measured_digest_seconds: 0 }],
    ["no evidence", { ...MEASURED, measured_digest_seconds: 10, measurement_evidence: "" }],
    ["bad date", { ...MEASURED, measured_digest_seconds: 10, measured_at: "yesterday!!" }],
  ])("a malformed entry is refused (%s)", (_label, entry) => {
    expect(() => doc({ "env.p": entry })).toThrow(/RETENTION_DIGEST_PRECONDITIONS_INVALID/);
  });
});
