import { RecoveryManifest } from "./RecoveryManifest";
import { RecoveryResult, RecoveryPoint } from "./RecoveryTypes";
import { RecoveryContext } from "./RecoveryContext";
import { HashDescriptor } from "../types";

export class RecoveryManifestBuilder {
  build(
    context: RecoveryContext,
    point: RecoveryPoint,
    result: RecoveryResult,
    previousWorldStateRoot?: HashDescriptor,
    restoredWorldStateRoot?: HashDescriptor
  ): RecoveryManifest {
    return {
      recovery_id: context.recovery_id,
      recovery_actor: context.actor,
      source_snapshot: point.snapshot_ref,
      state_root: point.state_root,
      restored_artifacts: result.restored_artifacts,
      verifier_version: "snapshot-verifier-v1",
      created_at: context.requested_at,
      provenance: result.provenance!,
      metadata: {
        recovery_reason: "disaster_recovery",
        trigger_type: "manual",
        previous_world_state_root: previousWorldStateRoot,
        restored_world_state_root: restoredWorldStateRoot
      }
    };
  }
}
