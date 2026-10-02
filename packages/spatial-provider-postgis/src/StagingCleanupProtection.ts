import type { ArtifactRepositoryPort } from "../../mps-runtime/src/kernel/ExecutionKernel";
import {
  RETAINED_RELATION_SCHEMA,
  formatQualifiedTable,
  relationExists,
  resolveLegacyV1RetentionRecord,
  resolveRetainedRelationClaim,
  resolveRetentionRecord,
  retainedRelationClaimId,
  retentionRecordId,
  legacyV1RetentionRecordId,
  type QualifiedTable,
  type SqlPort,
  type TransactionalSqlPort,
} from "./SpatialDatasetRetention";

/**
 * U30-B2 cleanup-staging + U30F F1/F9 -- PRES-05 protection of the relations in lm_staging.
 *
 * `lm_staging.<target_table>_<hash8>` is the staging table of an import AND the retained relation
 * of the SUCCESS version with the same 8-hex prefix (SpatialDatasetRetention.retainedRelationFor).
 * Two governed paths destroy such relations: cleanup-staging (DROP) and import-staging
 * (ogr2ogr -overwrite). Both decide protection PER RELATION with `decideStagingRelationProtection`:
 *
 *   SUCCESS_BATCH            the ledger has a SUCCESS batch mapping to the relation;
 *   IN_FLIGHT_BATCH          a batch of the relation is STAGING_IMPORTED or PROMOTE_STARTED, or
 *                            STAGING_STARTED for less than 24 h (it is being imported or promoted);
 *   RETENTION_CLAIM          CAS holds the relation's claim (F9: found by the relation name alone,
 *                            so a lost SUCCESS row or an 8-hex collision does not hide it);
 *   RETENTION_RECORD         CAS holds a verified record for a version the ledger maps to the relation;
 *   LEGACY_RETENTION_RECORD  CAS holds a basis-less v1 record for such a version (kept, not verified);
 *   PROTECTION_UNVERIFIABLE  CAS unavailable or unreadable, or a name that is not a plain identifier.
 *
 * Only an unprotected relation may be dropped or overwritten. A database error propagates (nothing
 * is destroyed). The cleanup checks again immediately before each DROP, in the DROP's own
 * transaction under an ACCESS EXCLUSIVE lock on the relation (`dropStagingRelationGoverned`), so a
 * concurrent import or promote between plan and DROP is seen (F9 TOCTOU).
 */

export const CLEANUP_SKIPPED_RETAINED_RELATION = "CLEANUP_SKIPPED_RETAINED_RELATION" as const;
export const CLEANUP_SKIPPED_PROTECTION_UNVERIFIABLE = "CLEANUP_SKIPPED_PROTECTION_UNVERIFIABLE" as const;
export const REJECT_STAGING_IMPORT_WOULD_OVERWRITE_RETAINED_RELATION = "REJECT_STAGING_IMPORT_WOULD_OVERWRITE_RETAINED_RELATION" as const;

/** A STAGING_STARTED batch younger than this is an import in progress (the cleanup's own staleness rule). */
export const STAGING_STARTED_IN_FLIGHT_MS = 24 * 60 * 60 * 1000;

export interface StagingCleanupCandidate {
  readonly id: string;
  readonly status: string;
  readonly target_schema: string;
  readonly target_table: string;
  readonly content_bundle_sha256: string;
}

export type StagingProtectionReason =
  | "SUCCESS_BATCH"
  | "IN_FLIGHT_BATCH"
  | "RETENTION_CLAIM"
  | "RETENTION_RECORD"
  | "LEGACY_RETENTION_RECORD";

export type StagingRelationProtection =
  | { readonly protected: false }
  | {
      readonly protected: true;
      readonly code: typeof CLEANUP_SKIPPED_RETAINED_RELATION;
      readonly reason: StagingProtectionReason;
      readonly detail: string;
      readonly record_id?: string;
    }
  | { readonly protected: true; readonly code: typeof CLEANUP_SKIPPED_PROTECTION_UNVERIFIABLE; readonly reason: "PROTECTION_UNVERIFIABLE"; readonly detail: string };

export type StagingCleanupDecision =
  | {
      readonly action: "DROP";
      readonly relation: QualifiedTable;
      readonly relation_name: string;
      readonly batch_ids: readonly string[];
    }
  | {
      readonly action: "SKIP";
      readonly code: typeof CLEANUP_SKIPPED_RETAINED_RELATION;
      readonly reason: StagingProtectionReason;
      readonly relation: QualifiedTable;
      readonly relation_name: string;
      readonly batch_ids: readonly string[];
      readonly record_id?: string;
      readonly detail?: string;
    }
  | {
      readonly action: "SKIP";
      readonly code: typeof CLEANUP_SKIPPED_PROTECTION_UNVERIFIABLE;
      readonly relation_name: string;
      readonly batch_ids: readonly string[];
      readonly detail: string;
    };

const SQL_IDENTIFIER = /^[a-z_][a-z0-9_]*$/;
const SHA256_HEX = /^[0-9a-f]{64}$/;

function isIdentifier(name: string): boolean {
  return SQL_IDENTIFIER.test(name) && name.length <= 63;
}

/** `"lm_staging"."<table>"` for a relation whose parts are plain identifiers (checked by the planner). */
export function quoteStagingRelation(relation: QualifiedTable): string {
  if (!isIdentifier(relation.schema) || !isIdentifier(relation.table)) {
    throw new Error(`REJECT_STAGING_CLEANUP_IDENTIFIER: ${relation.schema}.${relation.table} is not a plain identifier`);
  }
  return `"${relation.schema}"."${relation.table}"`;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

interface LedgerRowForRelation {
  readonly id: string;
  readonly status: string;
  readonly target_schema: string;
  readonly target_table: string;
  readonly content_bundle_sha256: string;
  readonly started_at: Date | string | null;
}

/** Every ledger row (any status) whose <target_table>_<hash8> is this relation's name. */
async function ledgerRowsForRelation(db: SqlPort, relation: QualifiedTable): Promise<LedgerRowForRelation[]> {
  const result = await db.query<LedgerRowForRelation>(
    `
    SELECT id, status, target_schema, target_table, content_bundle_sha256, started_at
    FROM "PostgisImportBatch"
    WHERE target_table || '_' || substr(content_bundle_sha256, 1, 8) = $1`,
    [relation.table],
  );
  return result.rows;
}

/**
 * The per-relation protection decision (see the module comment). Read-only: a ledger query (DB
 * errors propagate) and CAS reads (errors -> PROTECTION_UNVERIFIABLE, never "unprotected").
 */
export async function decideStagingRelationProtection(input: {
  readonly db: SqlPort;
  /** The durable CAS, or null when it could not be opened (then only the ledger can protect). */
  readonly repo: ArtifactRepositoryPort | null;
  readonly relation: QualifiedTable;
  readonly now?: Date;
  /** Versions known to map to the relation besides the ledger's (the cleanup's candidate batches). */
  readonly knownVersions?: readonly { readonly target_schema: string; readonly target_table: string; readonly content_bundle_sha256: string }[];
}): Promise<StagingRelationProtection> {
  const { db, repo, relation } = input;
  const name = formatQualifiedTable(relation);
  if (relation.schema !== RETAINED_RELATION_SCHEMA || !isIdentifier(relation.schema) || !isIdentifier(relation.table)) {
    return {
      protected: true,
      code: CLEANUP_SKIPPED_PROTECTION_UNVERIFIABLE,
      reason: "PROTECTION_UNVERIFIABLE",
      detail: `${name} is not a plain lm_staging identifier; it is never interpolated into a DROP or an overwrite`,
    };
  }

  const rows = await ledgerRowsForRelation(db, relation);
  const success = rows.find((r) => r.status === "SUCCESS");
  if (success) {
    return { protected: true, code: CLEANUP_SKIPPED_RETAINED_RELATION, reason: "SUCCESS_BATCH", detail: `SUCCESS batch ${success.id} is materialised in it` };
  }
  const now = (input.now ?? new Date()).getTime();
  const inFlight = rows.find(
    (r) =>
      r.status === "STAGING_IMPORTED" ||
      r.status === "PROMOTE_STARTED" ||
      (r.status === "STAGING_STARTED" && (r.started_at === null || now - new Date(r.started_at).getTime() < STAGING_STARTED_IN_FLIGHT_MS)),
  );
  if (inFlight) {
    return { protected: true, code: CLEANUP_SKIPPED_RETAINED_RELATION, reason: "IN_FLIGHT_BATCH", detail: `batch ${inFlight.id} is ${inFlight.status}` };
  }

  if (!repo) {
    return {
      protected: true,
      code: CLEANUP_SKIPPED_PROTECTION_UNVERIFIABLE,
      reason: "PROTECTION_UNVERIFIABLE",
      detail: "the durable Mimers CAS is unavailable, so a retention claim or record cannot be ruled out",
    };
  }
  try {
    if (await resolveRetainedRelationClaim(repo, relation)) {
      const id = retainedRelationClaimId(relation);
      return { protected: true, code: CLEANUP_SKIPPED_RETAINED_RELATION, reason: "RETENTION_CLAIM", detail: `relation claim ${id}`, record_id: id };
    }
    const versions = new Map<string, QualifiedTable>();
    for (const r of [...rows, ...(input.knownVersions ?? [])]) {
      if (SHA256_HEX.test(r.content_bundle_sha256) && isIdentifier(r.target_schema) && isIdentifier(r.target_table)) {
        versions.set(`${r.target_schema}.${r.target_table}@${r.content_bundle_sha256}`, { schema: r.target_schema, table: r.target_table });
      }
    }
    for (const [key, target] of versions) {
      const sha256 = key.slice(key.indexOf("@") + 1);
      if (await resolveRetentionRecord(repo, target, sha256)) {
        const id = retentionRecordId(target, sha256);
        return { protected: true, code: CLEANUP_SKIPPED_RETAINED_RELATION, reason: "RETENTION_RECORD", detail: `retention record ${id}`, record_id: id };
      }
      if (await resolveLegacyV1RetentionRecord(repo, target, sha256)) {
        const id = legacyV1RetentionRecordId(target, sha256);
        return {
          protected: true,
          code: CLEANUP_SKIPPED_RETAINED_RELATION,
          reason: "LEGACY_RETENTION_RECORD",
          detail: `legacy (basis-less) retention record ${id}; kept, never treated as verified`,
          record_id: id,
        };
      }
    }
  } catch (error) {
    return {
      protected: true,
      code: CLEANUP_SKIPPED_PROTECTION_UNVERIFIABLE,
      reason: "PROTECTION_UNVERIFIABLE",
      detail: `reading the retention claim/records for ${name} failed: ${describe(error)}`,
    };
  }
  return { protected: false };
}

export async function planStagingCleanup(input: {
  readonly db: SqlPort;
  /** The durable CAS, or null when it could not be opened (then only the ledger can protect). */
  readonly repo: ArtifactRepositoryPort | null;
  readonly candidates: readonly StagingCleanupCandidate[];
  readonly now?: Date;
}): Promise<StagingCleanupDecision[]> {
  // Same relation naming as the import (and the original cleanup): <target_table>_<hash8>.
  const groups = new Map<string, StagingCleanupCandidate[]>();
  for (const candidate of input.candidates) {
    const name = `${candidate.target_table}_${candidate.content_bundle_sha256.substring(0, 8)}`;
    const group = groups.get(name) ?? [];
    group.push(candidate);
    groups.set(name, group);
  }

  const decisions: StagingCleanupDecision[] = [];
  for (const name of [...groups.keys()].sort()) {
    const batches = groups.get(name)!;
    const batchIds = batches.map((b) => b.id);
    const relationName = `${RETAINED_RELATION_SCHEMA}.${name}`;
    if (!isIdentifier(name)) {
      decisions.push({
        action: "SKIP",
        code: CLEANUP_SKIPPED_PROTECTION_UNVERIFIABLE,
        relation_name: relationName,
        batch_ids: batchIds,
        detail: "relation name is not a plain lower-case identifier; it is never interpolated into a DROP",
      });
      continue;
    }
    const relation: QualifiedTable = { schema: RETAINED_RELATION_SCHEMA, table: name };
    const protection = await decideStagingRelationProtection({ db: input.db, repo: input.repo, relation, now: input.now, knownVersions: batches });
    if (!protection.protected) {
      decisions.push({ action: "DROP", relation, relation_name: relationName, batch_ids: batchIds });
    } else if (protection.code === CLEANUP_SKIPPED_RETAINED_RELATION) {
      decisions.push({
        action: "SKIP",
        code: CLEANUP_SKIPPED_RETAINED_RELATION,
        reason: protection.reason,
        relation,
        relation_name: relationName,
        batch_ids: batchIds,
        detail: protection.detail,
        ...(protection.record_id ? { record_id: protection.record_id } : {}),
      });
    } else {
      decisions.push({ action: "SKIP", code: CLEANUP_SKIPPED_PROTECTION_UNVERIFIABLE, relation_name: relationName, batch_ids: batchIds, detail: protection.detail });
    }
  }
  return decisions;
}

export type GovernedStagingDropOutcome =
  | { readonly outcome: "DROPPED" }
  | { readonly outcome: "ABSENT" }
  | { readonly outcome: "KEPT"; readonly protection: Exclude<StagingRelationProtection, { readonly protected: false }> };

/**
 * F9: the only DROP of an lm_staging relation. In ONE transaction: bounded lock wait, existence,
 * ACCESS EXCLUSIVE lock on the relation (a concurrent promote reading it, or an import replacing it,
 * is serialised), the protection decision again, and only then the DROP (no CASCADE: a dependent
 * object makes it fail rather than vanish).
 */
export async function dropStagingRelationGoverned(input: {
  readonly db: TransactionalSqlPort;
  readonly repo: ArtifactRepositoryPort | null;
  readonly relation: QualifiedTable;
  readonly lockTimeoutMs?: number;
  readonly now?: Date;
}): Promise<GovernedStagingDropOutcome> {
  const quoted = quoteStagingRelation(input.relation);
  if (input.relation.schema !== RETAINED_RELATION_SCHEMA) throw new Error(`REJECT_STAGING_CLEANUP_IDENTIFIER: ${quoted} is not in ${RETAINED_RELATION_SCHEMA}`);
  const lockTimeout = Math.max(1, Math.floor(input.lockTimeoutMs ?? 5000));
  return input.db.transaction(async (tx) => {
    await tx.execute(`SET LOCAL lock_timeout = '${lockTimeout}ms'`);
    if (!(await relationExists(tx, input.relation))) return { outcome: "ABSENT" } as const;
    await tx.execute(`LOCK TABLE ${quoted} IN ACCESS EXCLUSIVE MODE`);
    const protection = await decideStagingRelationProtection({ db: tx, repo: input.repo, relation: input.relation, now: input.now });
    if (protection.protected) return { outcome: "KEPT", protection } as const;
    await tx.execute(`DROP TABLE ${quoted}`);
    return { outcome: "DROPPED" } as const;
  });
}

export class StagingRelationProtectedError extends Error {
  readonly code = REJECT_STAGING_IMPORT_WOULD_OVERWRITE_RETAINED_RELATION;
  constructor(
    readonly relation: string,
    readonly reason: StagingProtectionReason | "PROTECTION_UNVERIFIABLE",
    detail: string,
  ) {
    super(
      `${REJECT_STAGING_IMPORT_WOULD_OVERWRITE_RETAINED_RELATION} [${reason}]: import-staging would overwrite ${relation} ` +
        `(ogr2ogr -overwrite), which is protected: ${detail}. Nothing was written; there is no override.`,
    );
    this.name = "StagingRelationProtectedError";
  }
}

/**
 * F1: before import-staging writes lm_staging.<table>_<hash8> with `ogr2ogr -overwrite`. A relation
 * that does not exist yet is free (the CAS is not even opened); an existing one may be overwritten
 * only when `decideStagingRelationProtection` finds it unprotected (a leftover of a failed import).
 */
export async function assertStagingImportOverwriteAllowed(input: {
  readonly db: SqlPort;
  readonly relation: QualifiedTable;
  /** Opens the durable CAS lazily; resolves null when it cannot be opened. */
  readonly openRepo: () => Promise<ArtifactRepositoryPort | null>;
  readonly now?: Date;
}): Promise<void> {
  const name = formatQualifiedTable(input.relation);
  if (input.relation.schema !== RETAINED_RELATION_SCHEMA || !isIdentifier(input.relation.table)) {
    throw new StagingRelationProtectedError(name, "PROTECTION_UNVERIFIABLE", "not a plain lm_staging identifier");
  }
  if (!(await relationExists(input.db, input.relation))) return;
  const repo = await input.openRepo();
  const protection = await decideStagingRelationProtection({ db: input.db, repo, relation: input.relation, now: input.now });
  if (protection.protected) throw new StagingRelationProtectedError(name, protection.reason, protection.detail);
}
