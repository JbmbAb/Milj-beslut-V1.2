import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * SPATIAL-RETENTION-DIGEST-PRECONDITIONS-V1 -- U30F F4, U30F2 M4.
 *
 * `retainOutgoingThenReplace` phase B is ONE interactive transaction (timeout `transaction_timeout_ms`,
 * 600 s, unchanged) that holds an ACCESS EXCLUSIVE lock on the target from its LOCK TABLE until it
 * ends, blocking every read of the table meanwhile. Inside that transaction, in order:
 *   1. the wait for the lock itself (every open reader and writer of the table finishes first);
 *   2. the ledger re-check (and, for a first import, the admission re-check): small reads;
 *   3. `ensureOutgoingVersionRetained`: `digests_under_lock` full-table digests (live and retained)
 *      and the CAS record writes;
 *   4. TRUNCATE of the target;
 *   5. the named-column INSERT ... SELECT of every incoming row (geometry, index maintenance).
 * For the property layer (~4.4 M rows) neither the digests nor the INSERT have been measured.
 *
 * HARD precondition: for every target listed in retention-digest-preconditions.v1.json the replace
 * promote and the retention backfill are refused until a MEASURED entry (a reviewed commit, with the
 * measurements' evidence) shows that the measured steps under the lock fit the budget:
 *
 *   digests_under_lock x measured_digest_seconds + measured_replace_seconds
 *     <= lock_budget_fraction x transaction_timeout_ms
 *
 * `measured_replace_seconds` is steps 4-5 (TRUNCATE + INSERT). A digest time alone never meets the
 * precondition (U30F2 M4: before, the budget counted only the digests, so MET was necessary but not
 * sufficient). The rest of the timeout, (1 - lock_budget_fraction) x timeout, is headroom for what is
 * NOT measured: the lock wait (1), the small reads and writes of 2-3, server load and run-to-run spread.
 * Headroom is a margin, not a measurement, so MET is still no promise that a promote finishes in time:
 * a promote that runs out of time rolls back with nothing truncated, but holds the lock until then.
 *
 * Measuring (owner-approved runs only; never a test or CI):
 *   - measured_digest_seconds: `retain-spatial-dataset-versions --measure-digest --target <schema.table>`
 *     (read-only; always name the target -- without --target it digests all six default targets). It
 *     prints one JSON line per target; record its `measured_digest_seconds` (the larger of live and
 *     retained, i.e. ONE digest).
 *   - measured_replace_seconds: no tool in this repository measures it, and it is never measured on the
 *     live table: time a TRUNCATE + the same INSERT ... SELECT of `measured_rows` rows into a copy of the
 *     target with the same columns and indexes, on the same server (an owner-approved write outside live).
 * Interpretation with the committed numbers (600 000 ms, 0.5, 2): the budget is 300 s, so
 * 2 x digest + replace <= 300 s. A digest above 150 s alone means the digest-under-lock design must
 * change (SHARE lock with the digests outside the exclusive lock, or a per-target timeout): an owner
 * decision, never a timeout raised to make a measurement fit.
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
      /** Wall time of the replace under the same lock: TRUNCATE + INSERT ... SELECT of measured_rows rows, in seconds (U30F2 M4). */
      readonly measured_replace_seconds: number;
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
      const replace = e.measured_replace_seconds;
      const rows = e.measured_rows;
      if (typeof seconds !== "number" || !(seconds > 0) || !Number.isFinite(seconds)) throw new Error(`${INVALID}: ${name} measured_digest_seconds`);
      // M4: the TRUNCATE + INSERT runs under the same lock; an entry without its time cannot be MEASURED.
      if (typeof replace !== "number" || !(replace > 0) || !Number.isFinite(replace)) throw new Error(`${INVALID}: ${name} measured_replace_seconds`);
      if (typeof rows !== "number" || !Number.isInteger(rows) || rows < 0) throw new Error(`${INVALID}: ${name} measured_rows`);
      if (!text(e.measured_at, 10) || Number.isNaN(Date.parse(e.measured_at))) throw new Error(`${INVALID}: ${name} measured_at`);
      if (!text(e.measured_by, 2) || !text(e.environment, 2) || !text(e.measurement_evidence, 8)) {
        throw new Error(`${INVALID}: ${name} needs measured_by, environment and measurement_evidence`);
      }
      parsed[name] = Object.freeze({
        status: "MEASURED",
        measured_digest_seconds: seconds,
        measured_replace_seconds: replace,
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

let committed: RetentionDigestPreconditions | null = null;

/**
 * The committed preconditions, read on FIRST USE: a module that merely imports this package (the web
 * server and the LU runtime do, through index.ts) does no I/O for it. A missing or malformed file
 * throws, so the promote or backfill that needed it stops (fail-closed).
 */
export function committedRetentionDigestPreconditions(): RetentionDigestPreconditions {
  committed ??= parseRetentionDigestPreconditions(JSON.parse(readFileSync(RETENTION_DIGEST_PRECONDITIONS_FILE, "utf8")));
  return committed;
}

/** The replace promote's interactive transaction timeout (unchanged: 600 000 ms), one source with the check. */
export function retentionTransactionTimeoutMs(): number {
  return committedRetentionDigestPreconditions().transaction_timeout_ms;
}

export type RetentionDigestPreconditionResult =
  | { readonly kind: "NOT_REQUIRED" }
  | {
      readonly kind: "MET";
      readonly measured_digest_seconds: number;
      readonly measured_replace_seconds: number;
      /** digests_under_lock x measured_digest_seconds + measured_replace_seconds. */
      readonly needed_seconds: number;
      readonly budget_seconds: number;
    }
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
  // M4: every measured step under the exclusive lock -- the digests AND the TRUNCATE + INSERT.
  const needed = preconditions.digests_under_lock * entry.measured_digest_seconds + entry.measured_replace_seconds;
  if (needed > budget) {
    return {
      kind: "UNMET",
      code: REJECT_RETENTION_DIGEST_EXCEEDS_LOCK_BUDGET,
      detail:
        `${REJECT_RETENTION_DIGEST_EXCEEDS_LOCK_BUDGET}: ${target} needs ${preconditions.digests_under_lock} x ${entry.measured_digest_seconds} s + ` +
        `${entry.measured_replace_seconds} s = ${needed} s under the exclusive lock (digests, then TRUNCATE + INSERT), over the budget of ${budget} s ` +
        `(${preconditions.lock_budget_fraction} x ${preconditions.transaction_timeout_ms} ms); measured ${entry.measured_at} on ${entry.environment} ` +
        `(${entry.measurement_evidence}) -- the digest-under-lock design must change first`,
    };
  }
  return {
    kind: "MET",
    measured_digest_seconds: entry.measured_digest_seconds,
    measured_replace_seconds: entry.measured_replace_seconds,
    needed_seconds: needed,
    budget_seconds: budget,
  };
}

/** The committed preconditions, for a qualified target; the refusing paths call this (no document parameter). */
export function committedRetentionDigestPrecondition(target: { readonly schema: string; readonly table: string }): RetentionDigestPreconditionResult {
  return evaluateRetentionDigestPrecondition(`${target.schema}.${target.table}`, committedRetentionDigestPreconditions());
}
