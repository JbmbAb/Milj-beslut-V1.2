import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * SPATIAL-FIRST-IMPORT-ADMISSIONS-V1 -- U30F2 H3 (owner decision 2026-10-02).
 *
 * An empty (or missing) live table is NOT by itself a first import. The verifiable initialisation
 * mode is: a reviewed, committed admission in first-import-admissions.v1.json naming the exact target
 * and the exact incoming version (full content_bundle_sha256), who admitted it, when, why and the
 * evidence -- PLUS the absence checks the retain-before-replace gate makes against the whole ledger,
 * the retained trail and CAS (SpatialDatasetRetention.assertFirstImportAdmitted). Never derived from
 * a row count.
 *
 * Read on FIRST USE (the web server imports this package through index.ts). A missing or malformed
 * file throws, so a first import that needed it stops (fail-closed). There is no document parameter
 * on the refusing path and no environment switch: the committed file is the only source.
 */

export const FIRST_IMPORT_ADMISSIONS_CONTRACT_V1 = "spatial-first-import-admissions-v1" as const;
const INVALID = "FIRST_IMPORT_ADMISSIONS_INVALID";

export interface FirstImportAdmission {
  /** The exact incoming version this admission initialises the target with. */
  readonly content_bundle_sha256: string;
  readonly admitted_by: string;
  /** ISO-8601 date or timestamp. */
  readonly admitted_at: string;
  /** Why this target is new (e.g. a newly admitted LU layer), at least 20 characters. */
  readonly reason: string;
  /** Where the decision is recorded (owner decision, review, ticket). */
  readonly evidence: string;
}

export interface FirstImportAdmissions {
  readonly contract: typeof FIRST_IMPORT_ADMISSIONS_CONTRACT_V1;
  readonly admissions: Readonly<Record<string, FirstImportAdmission>>;
}

function text(v: unknown, min: number): v is string {
  return typeof v === "string" && v.trim().length >= min;
}

export function parseFirstImportAdmissions(raw: unknown): FirstImportAdmissions {
  const doc = raw as Record<string, unknown> | null;
  if (!doc || typeof doc !== "object") throw new Error(`${INVALID}: not an object`);
  if (doc.contract !== FIRST_IMPORT_ADMISSIONS_CONTRACT_V1) throw new Error(`${INVALID}: contract`);
  const admissions = doc.admissions as Record<string, unknown> | undefined;
  if (!admissions || typeof admissions !== "object" || Array.isArray(admissions)) throw new Error(`${INVALID}: admissions`);
  const parsed: Record<string, FirstImportAdmission> = {};
  for (const [target, value] of Object.entries(admissions)) {
    if (!/^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*$/.test(target)) throw new Error(`${INVALID}: target ${target}`);
    const e = value as Record<string, unknown> | null;
    if (!e || typeof e.content_bundle_sha256 !== "string" || !/^[0-9a-f]{64}$/.test(e.content_bundle_sha256)) {
      throw new Error(`${INVALID}: ${target} needs the full lower-case content_bundle_sha256 of the admitted version`);
    }
    if (!text(e.admitted_by, 2) || !text(e.admitted_at, 10) || Number.isNaN(Date.parse(e.admitted_at as string))) {
      throw new Error(`${INVALID}: ${target} needs admitted_by and an ISO admitted_at`);
    }
    if (!text(e.reason, 20) || !text(e.evidence, 8)) throw new Error(`${INVALID}: ${target} needs a reason (>= 20 chars) and evidence`);
    parsed[target] = Object.freeze({
      content_bundle_sha256: e.content_bundle_sha256,
      admitted_by: e.admitted_by as string,
      admitted_at: e.admitted_at as string,
      reason: e.reason as string,
      evidence: e.evidence as string,
    });
  }
  return Object.freeze({ contract: FIRST_IMPORT_ADMISSIONS_CONTRACT_V1, admissions: Object.freeze(parsed) });
}

export const FIRST_IMPORT_ADMISSIONS_FILE = join(dirname(fileURLToPath(import.meta.url)), "first-import-admissions.v1.json");

let committed: FirstImportAdmissions | null = null;

/** The committed admissions, read and validated on first use (fail-closed). */
export function committedFirstImportAdmissions(): FirstImportAdmissions {
  committed ??= parseFirstImportAdmissions(JSON.parse(readFileSync(FIRST_IMPORT_ADMISSIONS_FILE, "utf8")));
  return committed;
}
