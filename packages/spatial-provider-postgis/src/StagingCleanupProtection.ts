import type { ArtifactRepositoryPort } from "../../mps-runtime/src/kernel/ExecutionKernel";
import {
  RETAINED_RELATION_SCHEMA,
  formatQualifiedTable,
  isRetainedRelationProtected,
  resolveRetentionRecord,
  retentionRecordId,
  type QualifiedTable,
  type SqlPort,
} from "./SpatialDatasetRetention";

/**
 * U30-B2 cleanup-staging -- PRES-05 relation protection for the staging garbage collection.
 *
 * `cleanup-staging` (scripts/import/import-librarian-manifest.ts) drops
 * `lm_staging.<target_table>_<hash8>` for every FAILED (or stale STAGING_STARTED) import batch. That
 * name is ALSO the retained relation of the SUCCESS version with the same hash (the staging table
 * it was promoted from, see SpatialDatasetRetention.retainedRelationFor), so a FAILED re-import of
 * a bound version used to drop that version's only materialisation.
 *
 * `planStagingCleanup` decides, BEFORE any DROP is issued, per relation:
 *   - SKIP CLEANUP_SKIPPED_RETAINED_RELATION [SUCCESS_BATCH]     a SUCCESS batch maps to the relation;
 *   - SKIP CLEANUP_SKIPPED_RETAINED_RELATION [RETENTION_RECORD]  a retention record exists for the
 *     (target, version hash) of one of its batches;
 *   - SKIP CLEANUP_SKIPPED_PROTECTION_UNVERIFIABLE               protection could not be decided (CAS
 *     unavailable or unreadable, or a name that is not a plain identifier) -- fail-closed: kept;
 *   - DROP                                                        only when neither protection applies.
 * A database error while checking SUCCESS batches propagates: the whole cleanup stops before any DROP.
 */

export const CLEANUP_SKIPPED_RETAINED_RELATION = "CLEANUP_SKIPPED_RETAINED_RELATION" as const;
export const CLEANUP_SKIPPED_PROTECTION_UNVERIFIABLE = "CLEANUP_SKIPPED_PROTECTION_UNVERIFIABLE" as const;

export interface StagingCleanupCandidate {
  readonly id: string;
  readonly status: string;
  readonly target_schema: string;
  readonly target_table: string;
  readonly content_bundle_sha256: string;
}

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
      readonly reason: "SUCCESS_BATCH" | "RETENTION_RECORD";
      readonly relation: QualifiedTable;
      readonly relation_name: string;
      readonly batch_ids: readonly string[];
      readonly record_id?: string;
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

export async function planStagingCleanup(input: {
  readonly db: SqlPort;
  /** The durable CAS, or null when it could not be opened (then only SUCCESS-batch protection is decidable). */
  readonly repo: ArtifactRepositoryPort | null;
  readonly candidates: readonly StagingCleanupCandidate[];
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

    // 1. A SUCCESS batch maps to this relation (DB errors propagate: no DROP is issued at all).
    if (await isRetainedRelationProtected(input.db, relation)) {
      decisions.push({ action: "SKIP", code: CLEANUP_SKIPPED_RETAINED_RELATION, reason: "SUCCESS_BATCH", relation, relation_name: relationName, batch_ids: batchIds });
      continue;
    }

    // 2. A retention record exists for one of the versions behind this relation. A record can only
    //    exist for a sha256 version hash on an identifier target (retentionRecordId requires both).
    const versions = new Map<string, QualifiedTable>();
    for (const b of batches) {
      if (SHA256_HEX.test(b.content_bundle_sha256) && isIdentifier(b.target_schema) && isIdentifier(b.target_table)) {
        versions.set(`${b.target_schema}.${b.target_table}@${b.content_bundle_sha256}`, { schema: b.target_schema, table: b.target_table });
      }
    }
    let protectedBy: string | null = null;
    let unverifiable: string | null = null;
    for (const [key, target] of versions) {
      const sha256 = key.slice(key.indexOf("@") + 1);
      if (!input.repo) {
        unverifiable = "the durable Mimers CAS is unavailable, so a retention record cannot be ruled out";
        break;
      }
      try {
        if (await resolveRetentionRecord(input.repo, target, sha256)) {
          protectedBy = retentionRecordId(target, sha256);
          break;
        }
      } catch (error) {
        unverifiable = `reading the retention record for ${formatQualifiedTable(target)}@${sha256} failed: ${describe(error)}`;
        break;
      }
    }
    if (protectedBy) {
      decisions.push({ action: "SKIP", code: CLEANUP_SKIPPED_RETAINED_RELATION, reason: "RETENTION_RECORD", relation, relation_name: relationName, batch_ids: batchIds, record_id: protectedBy });
    } else if (unverifiable) {
      decisions.push({ action: "SKIP", code: CLEANUP_SKIPPED_PROTECTION_UNVERIFIABLE, relation_name: relationName, batch_ids: batchIds, detail: unverifiable });
    } else {
      decisions.push({ action: "DROP", relation, relation_name: relationName, batch_ids: batchIds });
    }
  }
  return decisions;
}
