import {
  WorldStateEntry,
  WorldStateApplyResult,
  WorldStateRootCalculator
} from "./WorldStateTypes";
import { TrustedArtifact } from "./TrustedArtifact";
import { HashDescriptor } from "../types";

export interface WorldStateManager {
  get(entity_id: string): Promise<WorldStateEntry | null>;
  apply(
    entry: WorldStateEntry,
    artifact: TrustedArtifact
  ): Promise<WorldStateApplyResult>;
}

export class InMemoryWorldStateManager implements WorldStateManager, WorldStateRootCalculator {
  private state = new Map<string, WorldStateEntry>();

  async get(entity_id: string): Promise<WorldStateEntry | null> {
    return this.state.get(entity_id) ?? null;
  }

  async apply(entry: WorldStateEntry, artifact: TrustedArtifact): Promise<WorldStateApplyResult> {
    const current = await this.get(entry.entity_id);

    // Idempotent replay: same recovery_run_id => success but idempotent
    if (
      current?.metadata?.recovery_run_id &&
      current.metadata.recovery_run_id === entry.metadata?.recovery_run_id
    ) {
      return {
        applied: true,
        idempotent: true,
        previous: current,
        current,
        errors: []
      };
    }

    if (!artifact.verification.verified) {
      return {
        applied: false,
        previous: current ?? undefined,
        current: undefined,
        errors: ["untrusted_artifact"]
      };
    }

    if (
      artifact.reference.id !== entry.artifact_ref.id ||
      artifact.reference.version !== entry.artifact_ref.version ||
      artifact.reference.content_hash.digest !== entry.artifact_ref.content_hash.digest
    ) {
      return {
        applied: false,
        previous: current ?? undefined,
        current: undefined,
        errors: ["artifact_reference_mismatch"]
      };
    }

    // Strict lineage: if current exists, parent_ref must be present and match
    if (current) {
      if (!entry.parent_ref) {
        return {
          applied: false,
          previous: current,
          current: undefined,
          errors: ["missing_world_state_parent_ref"]
        };
      }

      if (
        entry.parent_ref.id !== current.artifact_ref.id ||
        entry.parent_ref.content_hash.digest !== current.artifact_ref.content_hash.digest
      ) {
        return {
          applied: false,
          previous: current,
          current: undefined,
          errors: ["world_state_parent_mismatch"]
        };
      }
    }

    this.state.set(entry.entity_id, entry);

    return {
      applied: true,
      idempotent: false,
      previous: current ?? undefined,
      current: entry,
      errors: []
    };
  }

  async calculateRoot(): Promise<HashDescriptor> {
    const entries = [...this.state.values()]
      .sort((a, b) => a.entity_id.localeCompare(b.entity_id))
      .map(e => ({ entity_id: e.entity_id, content_hash: e.artifact_ref.content_hash }));

    const payload = JSON.stringify(entries);
    const bytes = new TextEncoder().encode(payload);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    const hex = Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, "0")).join("");

    return { algorithm: "sha256-v1", digest: hex, bit_length: 256 };
  }
}
