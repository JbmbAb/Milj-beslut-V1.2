import { DisasterRecoveryEngine } from "./DisasterRecoveryEngine";
import { RecoveryPoint, RecoveryResult } from "./RecoveryTypes";
import { RecoveryContext } from "./RecoveryContext";
import { SnapshotChain } from "../world/snapshot/SnapshotChain";
import { SnapshotVerifier } from "../world/snapshot/SnapshotVerifier";
import { WorldStateSnapshot } from "../world/snapshot/SnapshotTypes";
import { WorldStateManager } from "../world/WorldStateManager";
import { RegistryResolver } from "../registry/RegistryResolver";
import { TrustedArtifact } from "../world/TrustedArtifact";
import { ProvenanceBuilderFactory } from "../provenance/ProvenanceBuilderFactory";
import { ProvenanceRecord, RegistryReference } from "../types";

export class DefaultDisasterRecoveryEngine implements DisasterRecoveryEngine {
  constructor(
    private chain: SnapshotChain,
    private verifier: SnapshotVerifier,
    private worldState: WorldStateManager & { calculateRoot?: () => Promise<any> },
    private registryResolver: RegistryResolver<any>,
    private provenanceFactory: ProvenanceBuilderFactory
  ) {}

  async findLatestTrustedSnapshot(): Promise<RecoveryPoint | null> {
    let current: WorldStateSnapshot | null = await this.chain.latest();

    while (current) {
      const result = await this.verifier.verify(current);
      if (result.valid) {
        return {
          snapshot_id: current.identity.snapshot_id,
          snapshot_ref: {
            id: current.identity.snapshot_id,
            version: "1.0.0",
            content_hash: current.identity.snapshot_hash
          },
          snapshot_hash: current.identity.snapshot_hash,
          state_root: current.identity.state_root,
          created_at: current.identity.created_at
        };
      }

      if (!current.identity.parent_snapshot) break;
      current = await this.chain.get(current.identity.parent_snapshot.id);
    }

    return null;
  }

  async restore(context: RecoveryContext): Promise<RecoveryResult> {
    const latestTrusted = await this.findLatestTrustedSnapshot();
    if (!latestTrusted) {
      return { restored: false, snapshot: null, restored_entries: 0, restored_artifacts: [], errors: ["no_trusted_snapshot_found"] };
    }

    const snapshot = await this.chain.get(latestTrusted.snapshot_id);
    if (!snapshot) {
      return { restored: false, snapshot: latestTrusted, restored_entries: 0, restored_artifacts: [], errors: ["snapshot_not_found"] };
    }

    const verification = await this.verifier.verify(snapshot);
    if (!verification.valid) {
      return { restored: false, snapshot: latestTrusted, restored_entries: 0, restored_artifacts: [], errors: ["snapshot_invalid_during_restore", ...verification.errors] };
    }

    // capture previous world root before any mutation
    const previousRoot = this.worldState.calculateRoot ? await this.worldState.calculateRoot() : undefined;

    const provenanceBuilder = this.provenanceFactory.create();
    let restoredCount = 0;
    const restoredArtifacts: RegistryReference[] = [];
    const errors: string[] = [];

    for (const ref of snapshot.entries) {
      try {
        const trust = await this.registryResolver.resolve(ref);

        if (!trust.trust.hash || !trust.trust.provenance || !trust.trust.lineage) {
          errors.push(`untrusted_artifact:${ref.id}@${ref.version}`);
          continue;
        }

        const currentState = await this.worldState.get(ref.id);

        const artifact: TrustedArtifact<any> = {
          reference: ref,
          payload: trust.payload,
          verification: {
            verified: true,
            hash: trust.trust.hash,
            signature: trust.trust.signature,
            provenance: trust.trust.provenance,
            lineage: trust.trust.lineage
          }
        };

        const entry = {
          entity_id: ref.id,
          artifact_ref: ref,
          parent_ref: currentState?.artifact_ref,
          state: "active" as const,
          version: ref.version,
          provenance_ref: undefined,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          metadata: {
            recovery_snapshot_id: latestTrusted.snapshot_id,
            recovery_run_id: context.recovery_id
          }
        };

        const result = await this.worldState.apply(entry, artifact);

        if (result.applied) {
          restoredCount++;
          restoredArtifacts.push(ref);

          const artifactRecoveryRecord: ProvenanceRecord = {
            artifact_hash: ref.content_hash,
            created_by: context.actor,
            created_at: new Date().toISOString(),
            parent: ref,
            operation: "restored",
            metadata: { recovery_id: context.recovery_id, recovery_snapshot: latestTrusted.snapshot_id }
          };

          provenanceBuilder.addRecord(artifactRecoveryRecord);
        } else {
          // idempotent success is not an error; only record if real failure
          if (!result.idempotent) {
            errors.push(`world_state_apply_failed:${ref.id}@${ref.version}`);
          }
        }
      } catch (e) {
        errors.push(`restore_error:${ref.id}@${ref.version}`);
      }
    }

    const provenanceGraph = await provenanceBuilder.build();

    // compute restored world root after all applies
    const restoredRoot = this.worldState.calculateRoot ? await this.worldState.calculateRoot() : undefined;

    return {
      restored: errors.length === 0,
      snapshot: latestTrusted,
      restored_entries: restoredCount,
      restored_artifacts: restoredArtifacts,
      provenance: provenanceGraph,
      errors
    };
  }
}
