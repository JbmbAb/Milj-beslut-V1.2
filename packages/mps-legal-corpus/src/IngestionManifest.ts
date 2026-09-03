import type { ContentReference } from '@miljobeslut/mps-core';

/**
 * ADR: docs/architecture/ADR-LEGAL-CORPUS-IMPORT-GATE.md (ACCEPTED / FROZEN).
 *
 * One entry is required for EVERY raw document a run ever looks at, regardless of outcome.
 * A raw document with no entry at all, a FILTERED_OUT entry with no `filtered_reason`, or an
 * INGESTED entry with no `corpus_import_attestation_ref` is a contract violation independent
 * of which write path was called — see `checkManifestCompleteness` below.
 */
export type IngestionManifestEntryStatus = 'PENDING' | 'INGESTED' | 'FILTERED_OUT' | 'FAILED';

export interface IngestionManifestClassification {
  readonly legal_area?: string;
  readonly document_type?: string;
  readonly municipality?: string;
  readonly date?: string;
  readonly authority?: string;
}

export interface IngestionManifestEntry {
  readonly document_id: string;
  readonly source_manifest_ref: ContentReference;
  readonly status: IngestionManifestEntryStatus;
  readonly classification: IngestionManifestClassification;
  readonly content_hash: string;
  readonly pipeline_version: string;
  readonly processed_at: string;
  readonly filtered_reason?: string;
  readonly corpus_import_attestation_ref?: ContentReference;
}

/** Injected by the caller — no concrete storage implementation here (see gate module docs). */
export interface ManifestStore {
  listEntries(runId: string): Promise<readonly IngestionManifestEntry[]>;
}

export interface ManifestCompletenessResult {
  readonly complete: boolean;
  readonly violations: readonly string[];
}

/**
 * Batch-level completeness check. Per the frozen spec's second precision: this MUST run as
 * part of the single pre-write gate, before the first row is written to the canonical corpus
 * for ANY document in the run — not as a scheduled post-hoc audit. `CorpusImportGate` below
 * enforces that ordering; this function is the pure, side-effect-free check itself so it can
 * also be reused standalone by a scheduled auditor without duplicating the rule.
 */
export function checkManifestCompleteness(
  entries: readonly IngestionManifestEntry[],
  /**
   * The full set of raw document ids the run is expected to account for (e.g. everything
   * pulled from the quarantine/archive for this batch). Optional so this function stays
   * reusable by a standalone auditor that may not always have that universe on hand — but
   * `CorpusImportGate` always supplies it, since "a document with zero manifest entry" is
   * exactly the silent-dropout case the spec requires catching.
   */
  expectedDocumentIds?: readonly string[],
): ManifestCompletenessResult {
  const violations: string[] = [];

  if (expectedDocumentIds) {
    const present = new Set(entries.map((entry) => entry.document_id));
    for (const documentId of expectedDocumentIds) {
      if (!present.has(documentId)) {
        violations.push(`Document '${documentId}': no manifest entry at all.`);
      }
    }
  }

  for (const entry of entries) {
    if (entry.status === 'FILTERED_OUT' && !entry.filtered_reason) {
      violations.push(
        `Document '${entry.document_id}': status FILTERED_OUT without filtered_reason.`,
      );
    }
    if (entry.status !== 'FILTERED_OUT' && entry.filtered_reason) {
      violations.push(
        `Document '${entry.document_id}': filtered_reason present but status is '${entry.status}', not FILTERED_OUT.`,
      );
    }
    if (entry.status === 'INGESTED' && !entry.corpus_import_attestation_ref) {
      violations.push(
        `Document '${entry.document_id}': status INGESTED without corpus_import_attestation_ref.`,
      );
    }
    if (entry.status !== 'INGESTED' && entry.corpus_import_attestation_ref) {
      violations.push(
        `Document '${entry.document_id}': corpus_import_attestation_ref present but status is '${entry.status}', not INGESTED.`,
      );
    }
  }

  const seen = new Set<string>();
  for (const entry of entries) {
    if (seen.has(entry.document_id)) {
      violations.push(`Document '${entry.document_id}': duplicate manifest entry.`);
    }
    seen.add(entry.document_id);
  }

  return { complete: violations.length === 0, violations };
}
