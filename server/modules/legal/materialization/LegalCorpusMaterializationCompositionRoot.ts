import { join } from 'node:path';
import { createHash } from 'node:crypto';

import { canonicalizeStrict, createArtifactAttestation, type ArtifactAttestation } from '@miljobeslut/mimers-brunn-core';
import {
  CorpusImportGate,
  GovernedLegalCorpusMaterializer,
  LEGAL_CORPUS_IMPORT_ACTION,
  LEGAL_CORPUS_IMPORT_ATTESTATION_SCHEMA_VERSION,
  LEGAL_CORPUS_IMPORT_PREDICATE_TYPE,
  computeChunkSetContentHash,
  createRegistryAdmissionAuthority,
  type CorpusWriter,
  type IngestionManifestEntry,
  type LegalChunk,
} from '@miljobeslut/mps-legal-corpus';

import { FileDownloadManifestStore } from '../../../../packages/mps-data-governance/src/DownloadManifestStore';
import { prisma } from '../../../db/prisma';
import { getLegalCorpusMaterializationSigningProvider } from '../../../security/legalCorpusMaterializationSigningKey';
import { PrismaLegalCorpusMaterializationPersistence } from '../services/PrismaLegalCorpusMaterializationPersistence';
import { DownloadManifestSourceResolver } from './DownloadManifestSourceResolver';
import { FileIngestionManifestStore } from './FileIngestionManifestStore';
import { SourceRegistryAdmissionAdapter } from './SourceRegistryAdmissionAdapter';

/**
 * LEGAL-CORPUS-MATERIALIZATION-V1 (part D) — production composition root.
 *
 * Assembles the already-existing, already-tested `mps-legal-corpus` domain logic
 * (`CorpusImportGate`, `GovernedLegalCorpusMaterializer`) against real infrastructure for the
 * first time: the real Prisma client, the real `.quarantine/download-manifests` store P2 already
 * proved live, a real (file-backed) run manifest store, and the materialization
 * execution-attestation signing key. No new domain logic lives here — this file only wires ports
 * to concrete adapters, same role as `HarvestRuntimeCompositionRoot.ts` plays for P2.
 *
 * Capability note: the signing provider this root holds can mint `legal.corpus.import`
 * attestations, but it CANNOT approve a source, alter the registry, or bypass
 * `CorpusImportGate` — the gate is the thing that checks attestations signed with this key, and
 * every check it runs (binding, hash, manifest completeness) still applies. See
 * `server/security/legalCorpusMaterializationSigningKey.ts`.
 */
export interface LegalCorpusMaterializationCompositionOptions {
  /** Defaults to `.quarantine` under cwd — the same root P2-HARVEST-LIVE-01 already writes to. */
  readonly quarantineRootPath?: string;
  /** Defaults to `<quarantineRootPath>/legal-corpus-manifests`. */
  readonly ingestionManifestRootPath?: string;
  /**
   * K2.1 — defaults to `SOURCE_REGISTRY_ARTIFACT_PATH` / the repo-resolved authority file,
   * exactly as `loadVerifiedSourceRegistry` resolves it. Present so a caller can point the
   * admission authority at an explicit registry without mutating process env.
   */
  readonly sourceRegistryPath?: string;
}

export interface ComposedLegalCorpusMaterialization {
  readonly materializer: GovernedLegalCorpusMaterializer;
  readonly ingestionManifestStore: FileIngestionManifestStore;
  readonly sourceManifestResolver: DownloadManifestSourceResolver;
  readonly signAttestation: (args: {
    readonly documentId: string;
    readonly sourceContentHash: string;
    readonly chunks: readonly LegalChunk[];
    readonly pipelineVersion: string;
    readonly chunkPolicyVersion: string;
    readonly approverActorId: string;
    readonly approverRole: string;
    /**
     * K2.1 — required. The source-registry entry this document claims to originate from. Signed
     * into the predicate so `CorpusImportGate` can resolve it against the real signed registry,
     * and so `GovernedLegalCorpusMaterializer` can prove the persisted identity names the same
     * entry the attestation does.
     */
    readonly registryArtifactId: string;
    readonly registrySourceContentHash: string;
  }) => Promise<ArtifactAttestation>;
}

/** No-op by construction: `GovernedLegalCorpusMaterializer` only calls `gate.validateBatch()`,
 *  never `gate.importBatch()`, so `CorpusImportGate`'s `corpusWriter` is structurally required by
 *  its constructor but never invoked on this path. Throws if that ever stops being true, rather
 *  than silently writing through an unreviewed path. */
const inertCorpusWriter: CorpusWriter = {
  async writeChunkSet() {
    throw new Error(
      'REJECT_UNEXPECTED_WRITE_PATH: CorpusWriter.writeChunkSet was called, but this composition ' +
        'root only drives GovernedLegalCorpusMaterializer.materialize(), which writes through its ' +
        'own transactional persistence, never through CorpusImportGate.importBatch(). This means ' +
        'something is calling the gate directly — treat that as a bypass, not a feature.',
    );
  },
};

export function composeLegalCorpusMaterialization(
  options: LegalCorpusMaterializationCompositionOptions = {},
): ComposedLegalCorpusMaterialization {
  const quarantineRootPath = options.quarantineRootPath ?? join(process.cwd(), '.quarantine');
  const ingestionManifestRootPath =
    options.ingestionManifestRootPath ?? join(quarantineRootPath, 'legal-corpus-manifests');

  const downloadManifestStore = new FileDownloadManifestStore(join(quarantineRootPath, 'download-manifests'));
  const sourceManifestResolver = new DownloadManifestSourceResolver(downloadManifestStore);
  const ingestionManifestStore = new FileIngestionManifestStore(ingestionManifestRootPath);
  const signing = getLegalCorpusMaterializationSigningProvider();

  // K2.1 — the gate's registry authority is injected here, never defaulted inside the domain
  // package: the adapter is what knows how to load and verify the signed registry, and it lives
  // on this side of the boundary for the same reason DownloadManifestSourceResolver does.
  const registryAuthority = createRegistryAdmissionAuthority(
    new SourceRegistryAdmissionAdapter(options.sourceRegistryPath),
  );
  const gate = new CorpusImportGate(ingestionManifestStore, inertCorpusWriter, signing, registryAuthority);
  const persistence = new PrismaLegalCorpusMaterializationPersistence(prisma);
  const materializer = new GovernedLegalCorpusMaterializer(gate, persistence, sourceManifestResolver);

  const signAttestation = async (args: {
    readonly documentId: string;
    readonly sourceContentHash: string;
    readonly chunks: readonly LegalChunk[];
    readonly pipelineVersion: string;
    readonly chunkPolicyVersion: string;
    readonly approverActorId: string;
    readonly approverRole: string;
    /**
     * K2.1 — required. The source-registry entry this document claims to originate from. Signed
     * into the predicate so `CorpusImportGate` can resolve it against the real signed registry,
     * and so `GovernedLegalCorpusMaterializer` can prove the persisted identity names the same
     * entry the attestation does.
     */
    readonly registryArtifactId: string;
    readonly registrySourceContentHash: string;
  }): Promise<ArtifactAttestation> => {
    const chunkSetContentHash = computeChunkSetContentHash(args.chunks);
    const predicate = {
      action: LEGAL_CORPUS_IMPORT_ACTION,
      document_id: args.documentId,
      source_content_hash: args.sourceContentHash,
      chunk_set_content_hash: chunkSetContentHash,
      pipeline_version: args.pipelineVersion,
      chunk_policy_version: args.chunkPolicyVersion,
      approver_actor_id: args.approverActorId,
      approver_role: args.approverRole,
      attestation_schema_version: LEGAL_CORPUS_IMPORT_ATTESTATION_SCHEMA_VERSION,
      signer_key_id: signing.keyId,
      registry_artifact_id: args.registryArtifactId,
      registry_source_content_hash: args.registrySourceContentHash,
    };
    const subjectDigest = `sha256:${createHash('sha256').update(canonicalizeStrict(predicate), 'utf8').digest('hex')}`;

    return createArtifactAttestation({
      subjectDigest,
      predicateType: LEGAL_CORPUS_IMPORT_PREDICATE_TYPE,
      predicate,
      signing,
    });
  };

  return { materializer, ingestionManifestStore, sourceManifestResolver, signAttestation };
}

export type { IngestionManifestEntry };
