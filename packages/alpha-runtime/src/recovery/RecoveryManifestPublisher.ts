import { RecoveryManifest } from "./RecoveryManifest";
import { ArtifactFactory } from "../artifact/ArtifactFactory";
import { VerificationExecutor } from "../verification/VerificationExecutor";
import { RegistryEntryBuilder } from "../registry/RegistryEntryBuilder";
import { RegistryStore } from "../registry/RegistryStore";
import { ProvenanceRecord, RegistryReference } from "../types";
import { ProvenanceBuilderFactory } from "../provenance/ProvenanceBuilderFactory";

export class RecoveryManifestPublisher {
  constructor(
    private factory: ArtifactFactory,
    private verifier: VerificationExecutor,
    private entryBuilder: RegistryEntryBuilder,
    private store: RegistryStore,
    private recoveryRuntimeRef: RegistryReference,
    private recoveryManifestSchemaRef: RegistryReference,
    private signingKey: any,
    private provenanceFactory: ProvenanceBuilderFactory
  ) {}

  async publish(manifest: RecoveryManifest) {
    const envelope = await this.factory.create({
      logicalId: `recovery-manifest-${manifest.recovery_id}`,
      artifact: manifest,
      schemaRef: this.recoveryManifestSchemaRef,
      signingKey: this.signingKey
    });

    const verification = await this.verifier.verify(envelope);
    if (!verification.verified) throw new Error("RecoveryManifest verification failed");

    const provenanceBuilder = this.provenanceFactory.create();

    const provenanceRecord: ProvenanceRecord = {
      artifact_hash: envelope.identity.content_hash,
      created_by: this.recoveryRuntimeRef,
      created_at: envelope.identity.created_at,
      parent: manifest.source_snapshot,
      operation: "created",
      metadata: {
        recovery_id: manifest.recovery_id,
        source_snapshot_id: manifest.source_snapshot.id,
        restored_count: manifest.restored_artifacts.length
      }
    };

    provenanceBuilder.addRecord(provenanceRecord);
    const manifestProvenance = await provenanceBuilder.build();

    const entry = this.entryBuilder.build(envelope, verification, manifestProvenance);
    await this.store.put(entry);
  }
}
