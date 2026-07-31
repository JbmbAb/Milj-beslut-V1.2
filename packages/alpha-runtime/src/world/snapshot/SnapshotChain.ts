import { WorldStateSnapshot } from "./SnapshotTypes";
import { SnapshotHasher } from "./SnapshotHasher";

export interface SnapshotChain {
  append(snapshot: WorldStateSnapshot): Promise<void>;
  latest(): Promise<WorldStateSnapshot | null>;
  get(id: string): Promise<WorldStateSnapshot | null>;
  verifyChain(): Promise<boolean>;
  verifyAllSnapshots(hasher: SnapshotHasher): Promise<boolean>;
}

export class InMemorySnapshotChain implements SnapshotChain {
  private snapshots: WorldStateSnapshot[] = [];

  async append(snapshot: WorldStateSnapshot): Promise<void> {
    const latest = await this.latest();

    if (!latest) {
      if (snapshot.identity.parent_snapshot) {
        throw new Error("genesis_snapshot_cannot_have_parent");
      }
    } else {
      if (!snapshot.identity.parent_snapshot) {
        throw new Error("snapshot_parent_required");
      }

      if (snapshot.identity.parent_snapshot.content_hash.digest !== latest.identity.snapshot_hash.digest) {
        throw new Error("parent_state_root_mismatch");
      }
    }

    this.snapshots.push(snapshot);
  }

  async latest(): Promise<WorldStateSnapshot | null> {
    if (this.snapshots.length === 0) return null;
    return this.snapshots[this.snapshots.length - 1];
  }

  async get(id: string): Promise<WorldStateSnapshot | null> {
    return this.snapshots.find(s => s.identity.snapshot_id === id) ?? null;
  }

  async verifyChain(): Promise<boolean> {
    for (let i = 1; i < this.snapshots.length; i++) {
      const current = this.snapshots[i];
      const prev = this.snapshots[i - 1];
      if (!current.identity.parent_snapshot) return false;
      if (current.identity.parent_snapshot.content_hash.digest !== prev.identity.snapshot_hash.digest) return false;
    }
    return true;
  }

  async verifyAllSnapshots(hasher: SnapshotHasher): Promise<boolean> {
    for (const s of this.snapshots) {
      const calculated = await hasher.calculate(s);
      if (calculated.digest !== s.identity.snapshot_hash.digest) return false;
    }
    return true;
  }
}
