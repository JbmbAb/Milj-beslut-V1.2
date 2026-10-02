import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  RETENTION_DIGEST_PRECONDITIONS_FILE,
  REJECT_RETENTION_DIGEST_EXCEEDS_LOCK_BUDGET,
  REJECT_RETENTION_DIGEST_TIME_UNMEASURED,
  committedRetentionDigestPreconditions,
  retentionTransactionTimeoutMs,
  committedRetentionDigestPrecondition,
  evaluateRetentionDigestPrecondition,
  parseRetentionDigestPreconditions,
} from "../src/RetentionDigestPrecondition";

/**
 * U30F F4: the digest-time precondition, pure (no database).
 * U30F2 M4: the budget holds EVERY step under the exclusive lock: the digests AND the replace (TRUNCATE +
 * INSERT of the incoming rows). A measured digest time alone never meets it.
 */

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
    expect(committedRetentionDigestPreconditions().targets["env.registerenhetsomradesytor"]).toMatchObject({ status: "UNMEASURED" });
    expect(committedRetentionDigestPrecondition({ schema: "env", table: "registerenhetsomradesytor" })).toMatchObject({
      kind: "UNMET",
      code: REJECT_RETENTION_DIGEST_TIME_UNMEASURED,
    });
  });

  it("the promote transaction timeout is unchanged (600 s) and comes from the same file as the check", () => {
    expect(retentionTransactionTimeoutMs()).toBe(600000);
  });

  it("layers not named are not affected", () => {
    expect(committedRetentionDigestPrecondition({ schema: "env", table: "sgu_well" })).toEqual({ kind: "NOT_REQUIRED" });
  });

  it("the committed document says what must be measured, how, and that the digest measurement alone is not enough (M4)", () => {
    const raw = JSON.parse(readFileSync(RETENTION_DIGEST_PRECONDITIONS_FILE, "utf8")) as { purpose: string; targets: Record<string, { reason: string }> };
    expect(raw.purpose).toContain("measured_replace_seconds");
    expect(raw.purpose).toContain("TRUNCATE");
    const reason = raw.targets["env.registerenhetsomradesytor"]!.reason;
    expect(reason).toContain("--measure-digest --target env.registerenhetsomradesytor");
    expect(reason).toContain("measured_replace_seconds");
  });
});

describe("evaluation", () => {
  it("two digests plus the replace within the lock budget meet it; one second more refuses", () => {
    expect(
      evaluateRetentionDigestPrecondition("env.p", doc({ "env.p": { ...MEASURED, measured_digest_seconds: 100, measured_replace_seconds: 100 } })),
    ).toEqual({
      kind: "MET",
      measured_digest_seconds: 100,
      measured_replace_seconds: 100,
      needed_seconds: 300,
      budget_seconds: 300,
    });
    expect(
      evaluateRetentionDigestPrecondition("env.p", doc({ "env.p": { ...MEASURED, measured_digest_seconds: 100, measured_replace_seconds: 101 } })),
    ).toMatchObject({ kind: "UNMET", code: REJECT_RETENTION_DIGEST_EXCEEDS_LOCK_BUDGET });
  });

  it("digests that fill the budget alone no longer meet it: the TRUNCATE + INSERT runs under the same lock (M4)", () => {
    const result = evaluateRetentionDigestPrecondition("env.p", doc({ "env.p": { ...MEASURED, measured_digest_seconds: 150, measured_replace_seconds: 1 } }));
    expect(result).toMatchObject({ kind: "UNMET", code: REJECT_RETENTION_DIGEST_EXCEEDS_LOCK_BUDGET });
    expect(result.kind === "UNMET" ? result.detail : "").toContain("2 x 150 s + 1 s = 301 s");
  });

  it.each([
    ["no reason", { status: "UNMEASURED" }],
    ["unknown status", { status: "ASSUMED_OK" }],
    ["zero seconds", { ...MEASURED, measured_digest_seconds: 0, measured_replace_seconds: 10 }],
    ["no evidence", { ...MEASURED, measured_digest_seconds: 10, measured_replace_seconds: 10, measurement_evidence: "" }],
    ["bad date", { ...MEASURED, measured_digest_seconds: 10, measured_replace_seconds: 10, measured_at: "yesterday!!" }],
    ["digest time only, no replace time (M4)", { ...MEASURED, measured_digest_seconds: 10 }],
    ["zero replace seconds (M4)", { ...MEASURED, measured_digest_seconds: 10, measured_replace_seconds: 0 }],
    ["non-finite replace seconds (M4)", { ...MEASURED, measured_digest_seconds: 10, measured_replace_seconds: Number.POSITIVE_INFINITY }],
  ])("a malformed entry is refused (%s)", (_label, entry) => {
    expect(() => doc({ "env.p": entry })).toThrow(/RETENTION_DIGEST_PRECONDITIONS_INVALID/);
  });
});
