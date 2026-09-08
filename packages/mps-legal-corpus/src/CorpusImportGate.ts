import {
  verifyArtifactAttestation,
  type ArtifactAttestation,
  type SigningKeyProvider,
} from '@miljobeslut/mimers-brunn-core';
import { ChunkOrderError, computeChunkSetContentHash, type LegalChunkIdentityFields } from './ChunkIdentity';
import {
  LEGAL_CORPUS_IMPORT_ACTION,
  LegalCorpusGateError,
  type LegalCorpusImportAttestationPredicate,
} from './CorpusImportAttestation';
import {
  checkManifestCompleteness,
  type IngestionManifestEntry,
  type ManifestStore,
} from './IngestionManifest';
import type { RegistryAdmissionAuthority } from './SourceRegistryAdmissionAuthority';

/**
 * ADR: docs/architecture/ADR-LEGAL-CORPUS-IMPORT-GATE.md (ACCEPTED / FROZEN).
 *
 * Storage-agnostic on purpose: this module is the domain gate, not a Postgres client.
 * `ManifestStore`/`CorpusWriter` are injected so the gate is fully unit-testable without a
 * live database — same shape as `QuarantineStorage`/`CASRepository` elsewhere in this repo.
 * A concrete Postgres-backed implementation is deliberately out of scope until this gate
 * itself is Windows-PROVEN (per instruction: no pipeline/embedding/adapter work before that).
 */

export type LegalChunk = LegalChunkIdentityFields;

export interface CorpusWriter {
  writeChunkSet(args: {
    readonly documentId: string;
    readonly chunks: readonly LegalChunk[];
    readonly attestation: ArtifactAttestation;
  }): Promise<void>;
}

export interface CorpusImportRequest {
  readonly documentId: string;
  readonly chunks: readonly LegalChunk[];
  readonly attestation: ArtifactAttestation;
}

export interface CorpusImportBatchRequest {
  readonly runId: string;
  /** Every raw document this run touched, ingested or not — used for the "no entry at all" check. */
  readonly expectedDocumentIds: readonly string[];
  readonly imports: readonly CorpusImportRequest[];
}

export interface CorpusImportBatchResult {
  readonly importedDocumentIds: readonly string[];
}

interface PerDocumentCheck {
  readonly documentId: string;
  readonly ok: boolean;
  readonly reason?: string;
  readonly chunks: readonly LegalChunk[];
  readonly attestation: ArtifactAttestation;
}

/** A fully validated batch. It is safe to pass to a transactional persistence adapter. */
export interface ValidatedCorpusImportBatch {
  readonly runId: string;
  readonly imports: readonly CorpusImportRequest[];
}

/**
 * The single authoritative gate between processed chunk sets and the canonical legal corpus.
 * Operative sequence is locked (see spec): manifest completeness for the WHOLE batch is
 * checked first; then every import's attestation/binding checks are gathered (none applied
 * yet); only if the manifest check AND every single binding check pass does ANY write happen
 * — and then all of them happen together. There is no code path that writes some documents
 * and only later discovers a manifest or attestation problem for another one.
 */
export class CorpusImportGate {
  constructor(
    private readonly manifestStore: ManifestStore,
    private readonly corpusWriter: CorpusWriter,
    private readonly signing: SigningKeyProvider,
    /**
     * K2.1 — CORPUS-ADMISSION-REGISTRY-BINDING. Required, with no default, for the same reason
     * `signing` has no default: this gate is storage- and infrastructure-agnostic, and every
     * authority it depends on is injected explicitly by a composition root.
     *
     * K2.1b: an earlier revision defaulted this to a concrete registry-backed implementation so
     * existing call sites would not have to change. That was wrong twice over — it made this
     * package import `mps-data-governance` internals across a documented boundary, and it turned
     * a wiring omission into a silent runtime denial at admission time instead of a visible
     * error at composition time. A required parameter makes an unwired caller impossible to
     * ship rather than merely unlucky at runtime.
     */
    private readonly registryAuthority: RegistryAdmissionAuthority,
  ) {}

  async importBatch(request: CorpusImportBatchRequest): Promise<CorpusImportBatchResult> {
    const validated = await this.validateBatch(request);

    // Writes remain here for existing callers. Production adapters that need a single database
    // transaction call validateBatch first, then persist corpus + provenance atomically.
    for (const imp of validated.imports) {
      await this.corpusWriter.writeChunkSet({
        documentId: imp.documentId,
        chunks: imp.chunks,
        attestation: imp.attestation,
      });
    }

    return { importedDocumentIds: validated.imports.map((imp) => imp.documentId) };
  }

  /**
   * Runs the complete batch gate without writing a corpus row. This is the required boundary
   * for GATE_BEFORE_WRITE_V1: a transaction must begin only after this method resolves.
   */
  async validateBatch(request: CorpusImportBatchRequest): Promise<ValidatedCorpusImportBatch> {
    // ---- Step 1: batch-level manifest completeness — checked BEFORE anything else, per the
    // frozen spec's second precision. Not a per-document check, not a post-hoc audit. ----
    const entries = await this.manifestStore.listEntries(request.runId);
    const completeness = checkManifestCompleteness(entries, request.expectedDocumentIds);
    if (!completeness.complete) {
      throw new LegalCorpusGateError(
        `Manifest completeness check failed for run '${request.runId}': ${completeness.violations.join('; ')}`,
      );
    }
    const entriesByDocumentId = new Map<string, IngestionManifestEntry>(
      entries.map((entry) => [entry.document_id, entry]),
    );

    // ---- Step 2: gather every per-document binding check. No side effects yet. ----
    const checks: PerDocumentCheck[] = await Promise.all(
      request.imports.map((imp) => this.checkOneImport(imp, entriesByDocumentId)),
    );

    // ---- Step 3: single gate. Any failure anywhere blocks the ENTIRE batch's writes — not
    // just the failing document's. ----
    const failed = checks.find((check) => !check.ok);
    if (failed) {
      throw new LegalCorpusGateError(
        `Corpus import batch '${request.runId}' rejected — document '${failed.documentId}': ${failed.reason}`,
      );
    }

    return {
      runId: request.runId,
      imports: checks.map((check) => ({
        documentId: check.documentId,
        chunks: check.chunks,
        attestation: check.attestation,
      })),
    };
  }

  private async checkOneImport(
    imp: CorpusImportRequest,
    entriesByDocumentId: ReadonlyMap<string, IngestionManifestEntry>,
  ): Promise<PerDocumentCheck> {
    const entry = entriesByDocumentId.get(imp.documentId);
    const predicate = (imp.attestation?.predicate ?? {}) as Partial<LegalCorpusImportAttestationPredicate>;

    const fail = (reason: string): PerDocumentCheck => ({
      documentId: imp.documentId,
      ok: false,
      reason,
      chunks: imp.chunks,
      attestation: imp.attestation,
    });

    // Order-sensitive by design (see ChunkIdentity.ts) — chunks are NOT silently re-sorted
    // here. A mis-ordered array is itself a rejection, not something this gate fixes for the
    // caller: fixing it would hide exactly the pipeline-ordering bug the hash is meant to catch.
    let chunkOrderValid = true;
    let chunkSetContentHash: string | null = null;
    try {
      chunkSetContentHash = computeChunkSetContentHash(imp.chunks);
    } catch (err) {
      if (!(err instanceof ChunkOrderError)) throw err;
      chunkOrderValid = false;
    }

    if (!entry) {
      return fail('no manifest entry found for this document.');
    }
    if (entry.status !== 'INGESTED') {
      return fail(`manifest entry status is '${entry.status}', expected 'INGESTED'.`);
    }

    let signatureValid: boolean;
    try {
      signatureValid = await verifyArtifactAttestation(imp.attestation, this.signing);
    } catch {
      signatureValid = false;
    }

    const signerKeyBound =
      predicate.signer_key_id === this.signing.keyId && imp.attestation?.signer === this.signing.keyId;
    const actionBound = predicate.action === LEGAL_CORPUS_IMPORT_ACTION;
    const documentBound = predicate.document_id === imp.documentId;
    const sourceContentBound = predicate.source_content_hash === entry.content_hash;
    const chunkHashBound = chunkOrderValid && predicate.chunk_set_content_hash === chunkSetContentHash;
    const pipelineBound = predicate.pipeline_version === entry.pipeline_version;
    const chunkPolicyBound =
      typeof predicate.chunk_policy_version === 'string' && predicate.chunk_policy_version.length > 0;
    const approverActorId = predicate.approver_actor_id;
    const approverRole = predicate.approver_role;
    const approverBound =
      typeof approverActorId === 'string' &&
      approverActorId.length > 0 &&
      typeof approverRole === 'string' &&
      approverRole.length > 0;

    // K2.1 — CORPUS-ADMISSION-REGISTRY-BINDING. An additional authority-binding check,
    // alongside the ten checks below (unchanged, same order, same behavior) — not a
    // replacement or reordering of any of them. Resolved before the existing checks are
    // evaluated so a registry-authority failure fails this document exactly like any other
    // ordered check, never bypassing or short-circuiting around them.
    const registryArtifactId = predicate.registry_artifact_id;
    const registrySourceContentHash = predicate.registry_source_content_hash;
    const registryAdmission =
      typeof registryArtifactId === 'string' && typeof registrySourceContentHash === 'string'
        ? await this.registryAuthority.checkAdmissible(registryArtifactId, registrySourceContentHash)
        : {
            ok: false as const,
            reason: 'ARTIFACT_NOT_FOUND' as const,
            detail: 'attestation predicate is missing registry_artifact_id / registry_source_content_hash.',
          };
    const registryBound = registryAdmission.ok;

    const orderedFailureChecks: ReadonlyArray<readonly [boolean, string]> = [
      [
        chunkOrderValid,
        'chunk array is not in canonical document-structure order — cannot compute a valid ' +
          'chunk_set_content_hash (see ChunkIdentity.ts).',
      ],
      [signatureValid, "attestation's cryptographic signature is invalid."],
      [signerKeyBound, 'attestation is not signed with the expected legal-corpus governance key.'],
      [actionBound, `attestation action is not '${LEGAL_CORPUS_IMPORT_ACTION}'.`],
      [documentBound, 'attestation is bound to a different document_id than the one being imported.'],
      [sourceContentBound, 'attestation source_content_hash does not match the manifest entry.'],
      [
        chunkHashBound,
        'attestation chunk_set_content_hash does not match a fresh hash of the chunks being imported.',
      ],
      [
        pipelineBound,
        'attestation pipeline_version does not match the manifest entry pipeline_version for this document.',
      ],
      [chunkPolicyBound, 'attestation is missing a valid chunk_policy_version.'],
      [approverBound, 'attestation is missing valid approver_actor_id/approver_role in the signed payload.'],
      [
        registryBound,
        `attestation registry binding rejected (${registryAdmission.reason ?? 'UNKNOWN'}): ${registryAdmission.detail}`,
      ],
    ];

    const firstFailure = orderedFailureChecks.find(([ok]) => !ok);
    if (firstFailure) {
      return fail(firstFailure[1]);
    }

    return {
      documentId: imp.documentId,
      ok: true,
      chunks: imp.chunks,
      attestation: imp.attestation,
    };
  }
}
