import { createHash } from 'node:crypto';

import type { ArchiveImportQuarantineStorage, QuarantinePutResult } from '@miljobeslut/mimers-brunn-core';

import type { VerifiedSourceRegistry } from './SourceRegistry';

export class GovernedArchiveImportError extends Error {
  constructor(
    message: string,
    readonly reason_code: string,
  ) {
    super(message);
    this.name = 'GovernedArchiveImportError';
  }
}

export interface ArchiveImportAdmissionRequest {
  readonly source_id: string;
  readonly archive_id: string;
  readonly file_name: string;
  readonly bytes: Uint8Array;
  readonly observed_locator: string;
  readonly observed_at: string;
  readonly transport_metadata?: Readonly<Record<string, string>>;
}

/**
 * The only governed path from already-materialized archive bytes to quarantine.
 *
 * This operation is intentionally unable to fetch, promote, or write CAS material. It only
 * verifies the signed registry authority, binds the observed archive provenance, hashes the
 * caller-supplied bytes, and hands those bytes to quarantine.
 */
export class GovernedArchiveImportAdmission {
  constructor(
    private readonly registry: VerifiedSourceRegistry,
    private readonly quarantine: ArchiveImportQuarantineStorage,
  ) {}

  async importObservation(request: ArchiveImportAdmissionRequest): Promise<QuarantinePutResult> {
    assertNonEmpty(request.source_id, 'source_id');
    assertNonEmpty(request.archive_id, 'archive_id');
    assertNonEmpty(request.file_name, 'file_name');
    assertNonEmpty(request.observed_locator, 'observed_locator');
    assertNonEmpty(request.observed_at, 'observed_at');
    if (request.bytes.byteLength === 0) {
      throw new GovernedArchiveImportError(
        'REJECT_EMPTY_BYTES: archive import requires already-materialized non-empty bytes.',
        'REJECT_EMPTY_BYTES',
      );
    }

    const source = this.registry.getSource(request.source_id);
    if (!source) {
      throw new GovernedArchiveImportError(
        `REJECT_SOURCE: '${request.source_id}' is not present in the verified Source Registry.`,
        'REJECT_SOURCE',
      );
    }
    if (source.channelType !== 'ARCHIVE_IMPORT') {
      throw new GovernedArchiveImportError(
        `REJECT_CHANNEL: '${request.source_id}' is not approved for ARCHIVE_IMPORT.`,
        'REJECT_CHANNEL',
      );
    }
    if (source.archiveId !== request.archive_id) {
      throw new GovernedArchiveImportError(
        `REJECT_ARCHIVE_ID: '${request.archive_id}' does not match the approved archive for ` +
          `'${request.source_id}'.`,
        'REJECT_ARCHIVE_ID',
      );
    }

    const expectedHash = createHash('sha256').update(request.bytes).digest('hex');
    const result = await this.quarantine.putArchiveImport({
      source_id: source.sourceId,
      file_name: request.file_name,
      bytes: request.bytes,
      acquisition: {
        acquisition_kind: 'ARCHIVE_IMPORT',
        archive_id: source.archiveId,
        observed_locator: request.observed_locator,
        observed_at: request.observed_at,
        transport_metadata: request.transport_metadata,
      },
      custom_metadata: { registry_artifact_id: source.registryArtifactId },
    });

    if (result.hash !== expectedHash) {
      throw new GovernedArchiveImportError(
        'REJECT_QUARANTINE_HASH: quarantine did not return the hash of the imported bytes.',
        'REJECT_QUARANTINE_HASH',
      );
    }
    return result;
  }
}

function assertNonEmpty(value: string, field: string): void {
  if (!value || value.trim().length === 0) {
    throw new GovernedArchiveImportError(
      `REJECT_MISSING_PROVENANCE: ARCHIVE_IMPORT requires '${field}'.`,
      'REJECT_MISSING_PROVENANCE',
    );
  }
}
