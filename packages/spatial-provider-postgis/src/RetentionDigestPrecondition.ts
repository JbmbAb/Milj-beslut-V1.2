import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * SPATIAL-RETENTION-DIGEST-PRECONDITIONS-V1 -- U30F F4.
 *
 * `retainOutgoingThenReplace` digests the live table and the retained relation under ACCESS
 * EXCLUSIVE inside one interactive transaction (timeout `transaction_timeout_ms`). For the property
 * layer (~4.4 M rows) that is unmeasured and likely longer than the timeout, blocking every read of
 * the table meanwhile. This is a HARD precondition: for every target listed in
 * retention-digest-preconditions.v1.json the replace promote and the retention backfill are refused
 * until a MEASURED entry (a reviewed commit, with the measurement's evidence) shows that
 * `digests_under_lock x measured_digest_seconds <= lock_budget_fraction x timeout`.
 *
 * Not a silent default: an UNMEASURED entry refuses; an absent entry means the target was not
 * named as a risk (NOT_REQUIRED). There is no environment switch and no caller-supplied document on
 * the refusing paths -- they always read the committed file.
 */

export const RETENTION_DIGEST_PRECONDITIONS_CONTRACT_V1 = "spatial-retention-digest-preconditions-v1" as const;
export const REJECT_RETENTION_DIGEST_TIME_UNMEASURED = "REJECT_RETENTION_DIGEST_TIME_UNMEASURED" as const;
export const REJECT_RETENTION_DIGEST_EXCEEDS_LOCK_BUDGET = "REJECT_RETENTION_DIGEST_EXCEEDS_LOCK_BUDGET" as const;
const INVALID = "RETENTION_DIGEST_PRECONDITIONS_INVALID";

export type RetentionDigestTargetPrecondition =
  | { readonly status: "UNMEASURED"; readonly reason: string }
  | {
      readonly status: "MEASURED";
      /** Wall time of ONE full digest of the target (the larger of live and retained), in seconds. */
      readonly measured_digest_seconds: number;
      readonly measured_rows: number;
      /** ISO-8601 date or timestamp of the measurement. */
      readonly measured_at: string;
      readonly measured_by: string;
      /** Where the environment was (host / database label); the check cannot verify it is the same one. */
      readonly environment: string;
      /** The log or report that holds the measurement. */
      readonly measurement_evidence: string;
    };

export interface RetentionDigestPreconditions {
  readonly contract: typeof RETENTION_DIGEST_PRECONDITIONS_CONTRACT_V1;
  readonly transaction_timeout_ms: number;
  readonly lock_budget_fraction: number;
  readonly digests_under_lock: number;
  readonly targets: Readonly<Record<string, RetentionDigestTargetPrecondition>>;
}

function text(v: unknown, min: number): v is string {
  return typeof v === "string" && v.trim().length >= min;
}

export function parseRetentionDigestPreconditions(raw: unknown): RetentionDigestPreconditions {
  const doc = raw as Record<string, unknown> | null;
  if (!doc || typeof doc !== "object") throw new Error(`${INVALID}: not an object`);
  if (doc.contract !== RETENTION_DIGEST_PRECONDITIONS_CONTRACT_V1) throw new Error(`${INVALID}: contract`);
  const timeout = doc.transaction_timeout_ms;
  const fraction = doc.lock_budget_fraction;
  const digests = doc.digests_under_lock;
  if (typeof timeout !== "number" || !Number.isInteger(timeout) || timeout <= 0) throw new Error(`${INVALID}: transaction_timeout_ms`);
  if (typeof fraction !== "number" || !(fraction > 0 && fraction <= 1)) throw new Error(`${INVALID}: lock_budget_fraction`);
  if (typeof digests !== "number" || !Number.isInteger(digests) || digests < 1) throw new Error(`${INVALID}: digests_under_lock`);
  const targets = doc.targets as Record<string, unknown> | undefined;
  if (!targets || typeof targets !== "object") throw new Error(`${INVALID}: targets`);
  const parsed: Record<string, RetentionDigestTargetPrecondition> = {};
  for (const [name, value] of Object.entries(targets)) {
    if (!/^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*$/.test(name)) throw new Error(`${INVALID}: target ${name}`);
    const e = value as Record<string, unknown>;
    if (e?.status === "UNMEASURED") {
      if (!text(e.reason, 20)) throw new Error(`${INVALID}: ${name} UNMEASURED needs a reason`);
      parsed[name] = Object.freeze({ status: "UNMEASURED", reason: e.reason });
    } else if (e?.status === "MEASURED") {
      const seconds = e.measured_digest_seconds;
      const rows = e.measured_rows;
      if (typeof seconds !== "number" || !(seconds > 0) || !Number.isFinite(seconds)) throw new Error(`${INVALID}: ${name} measured_digest_seconds`);
      if (typeof rows !== "number" || !Number.isInteger(rows) || rows < 0) throw new Error(`${INVALID}: ${name} measured_rows`);
      if (!text(e.measured_at, 10) || Number.isNaN(Date.parse(e.measured_at))) throw new Error(`${INVALID}: ${name} measured_at`);
      if (!text(e.measured_by, 2) || !text(e.environment, 2) || !text(e.measurement_evidence, 8)) {
        throw new Error(`${INVALID}: ${name} needs measured_by, environment and measurement_evidence`);
      }
      parsed[name] = Object.freeze({
        status: "MEASURED",
        measured_digest_seconds: seconds,
        measured_rows: rows,
        measured_at: e.measured_at,
        measured_by: e.measured_by,
        environment: e.environment,
        measurement_evidence: e.measurement_evidence,
      });
    } else {
      throw new Error(`${INVALID}: ${name} status must be UNMEASURED or MEASURED`);
    }
  }
  return Object.freeze({
    contract: RETENTION_DIGEST_PRECONDITIONS_CONTRACT_V1,
    transaction_timeout_ms: timeout,
    lock_budget_fraction: fraction,
    digests_under_lock: digests,
    targets: Object.freeze(parsed),
  });
}

export const RETENTION_DIGEST_PRECONDITIONS_FILE = join(dirname(fileURLToPath(import.meta.url)), "retention-digest-preconditions.v1.json");

export const RETENTION_DIGEST_PRECONDITIONS: RetentionDigestPreconditions = parseRetentionDigestPreconditions(
  JSON.parse(readFileSync(RETENTION_DIGEST_PRECONDITIONS_FILE, "utf8")),
);

/** The replace promote's interactive transaction timeout (unchanged: 600 000 ms), one source with the check. */
export const RETENTION_TRANSACTION_TIMEOUT_MS: number = RETENTION_DIGEST_PRECONDITIONS.transaction_timeout_ms;

export type RetentionDigestPreconditionResult =
  | { readonly kind: "NOT_REQUIRED" }
  | { readonly kind: "MET"; readonly measured_digest_seconds: number; readonly budget_seconds: number }
  | {
      readonly kind: "UNMET";
      readonly code: typeof REJECT_RETENTION_DIGEST_TIME_UNMEASURED | typeof REJECT_RETENTION_DIGEST_EXCEEDS_LOCK_BUDGET;
      readonly detail: string;
    };

/** Pure: evaluate the precondition of `target` ("schema.table") against a preconditions document. */
export function evaluateRetentionDigestPrecondition(
  target: string,
  preconditions: RetentionDigestPreconditions,
): RetentionDigestPreconditionResult {
  const entry = preconditions.targets[target];
  if (!entry) return { kind: "NOT_REQUIRED" };
  const budget = (preconditions.lock_budget_fraction * preconditions.transaction_timeout_ms) / 1000;
  if (entry.status === "UNMEASURED") {
    return {
      kind: "UNMET",
      code: REJECT_RETENTION_DIGEST_TIME_UNMEASURED,
      detail:
        `${REJECT_RETENTION_DIGEST_TIME_UNMEASURED}: ${target} is a hard F4 precondition target and its digest time is not measured ` +
        `(${entry.reason}) -- record an owner-approved measurement in retention-digest-preconditions.v1.json first`,
    };
  }
  const needed = preconditions.digests_under_lock * entry.measured_digest_seconds;
  if (needed > budget) {
    return {
      kind: "UNMET",
      code: REJECT_RETENTION_DIGEST_EXCEEDS_LOCK_BUDGET,
      detail:
        `${REJECT_RETENTION_DIGEST_EXCEEDS_LOCK_BUDGET}: ${target} needs ${preconditions.digests_under_lock} x ${entry.measured_digest_seconds} s = ${needed} s ` +
        `under the exclusive lock, over the budget of ${budget} s (${preconditions.lock_budget_fraction} x ${preconditions.transaction_timeout_ms} ms); ` +
        `measured ${entry.measured_at} on ${entry.environment} (${entry.measurement_evidence}) -- the digest-under-lock design must change first`,
    };
  }
  return { kind: "MET", measured_digest_seconds: entry.measured_digest_seconds, budget_seconds: budget };
}

/** The committed preconditions, for a qualified target; the refusing paths call this (no document parameter). */
export function committedRetentionDigestPrecondition(target: { readonly schema: string; readonly table: string }): RetentionDigestPreconditionResult {
  return evaluateRetentionDigestPrecondition(`${target.schema}.${target.table}`, RETENTION_DIGEST_PRECONDITIONS);
}
