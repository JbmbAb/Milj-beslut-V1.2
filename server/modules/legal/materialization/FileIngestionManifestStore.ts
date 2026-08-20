import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { ContentReference } from '@miljobeslut/mps-core';
import type { IngestionManifestEntry, ManifestStore } from '@miljobeslut/mps-legal-corpus';

/**
 * LEGAL-CORPUS-MATERIALIZATION-V1 (part D) — the first concrete implementation of
 * `ManifestStore` (`packages/mps-legal-corpus/src/IngestionManifest.ts`).
 *
 * Distinct from BOTH manifests already in this chain: P2's `DownloadManifest` (what was
 * acquired) and the Prisma `legal_corpus_ingestion_manifest_entries` table (what was
 * successfully persisted, written only after `CorpusImportGate` passes). This one is run-scoped
 * bookkeeping of what a materialization RUN examined and decided about each raw document
 * (PENDING/INGESTED/FILTERED_OUT/FAILED) -- exactly the record `CorpusImportGate.validateBatch`
 * reads via `listEntries()` to run its completeness check BEFORE any write. No production
 * adapter existed for this port before this file (confirmed: every existing caller injects an
 * in-memory test double).
 *
 * File-per-run, JSON array, matching the general shape already used by `FileDownloadManifestStore`
 * -- not a new storage paradigm, one plain file per run so a run's state survives a process
 * restart and is trivially inspectable.
 */
export class FileIngestionManifestStore implements ManifestStore {
  constructor(private readonly rootPath: string) {}

  async listEntries(runId: string): Promise<readonly IngestionManifestEntry[]> {
    try {
      const raw = await readFile(this.pathFor(runId), 'utf8');
      return JSON.parse(raw) as IngestionManifestEntry[];
    } catch (error) {
      if (isNotFound(error)) return [];
      throw error;
    }
  }

  /** Called by the pipeline as it processes each document -- upserts by document_id. */
  async recordEntry(runId: string, entry: IngestionManifestEntry): Promise<void> {
    const existing = await this.listEntries(runId);
    const next = [...existing.filter((e) => e.document_id !== entry.document_id), entry];
    await mkdir(this.rootPath, { recursive: true });
    await writeFile(this.pathFor(runId), JSON.stringify(next, null, 2) + '\n', 'utf8');
  }

  private pathFor(runId: string): string {
    return join(this.rootPath, `${sanitizeRunId(runId)}.json`);
  }
}

function sanitizeRunId(runId: string): string {
  return runId.replace(/[^A-Za-z0-9._-]+/g, '_');
}

function isNotFound(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === 'ENOENT';
}

/** Convenience: build a manifest entry that references a resolvable P2 DownloadManifest object. */
export function buildIngestionManifestEntry(args: {
  readonly document_id: string;
  readonly source_manifest_ref: ContentReference;
  readonly status: IngestionManifestEntry['status'];
  readonly classification: IngestionManifestEntry['classification'];
  readonly content_hash: string;
  readonly pipeline_version: string;
  readonly filtered_reason?: string;
  readonly corpus_import_attestation_ref?: ContentReference;
}): IngestionManifestEntry {
  return {
    document_id: args.document_id,
    source_manifest_ref: args.source_manifest_ref,
    status: args.status,
    classification: args.classification,
    content_hash: args.content_hash,
    pipeline_version: args.pipeline_version,
    processed_at: new Date().toISOString(),
    ...(args.filtered_reason ? { filtered_reason: args.filtered_reason } : {}),
    ...(args.corpus_import_attestation_ref ? { corpus_import_attestation_ref: args.corpus_import_attestation_ref } : {}),
  };
}
