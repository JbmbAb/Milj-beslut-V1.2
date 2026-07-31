import { HashDescriptor, RegistryReference } from "../../types";
import { WorldStateSnapshot } from "./SnapshotTypes";
import { HashEngine } from "../../crypto/HashEngine";
import { Canonicalizer } from "../../canonical/RFC8785Canonicalizer";
import { CanonicalizationProfile } from "../../canonical/CanonicalizationProfile";

export interface SnapshotHasher {
  calculate(snapshot: WorldStateSnapshot): Promise<HashDescriptor>;
}

export class DefaultSnapshotHasher implements SnapshotHasher {
  constructor(
    private hashEngine: HashEngine,
    private canonicalizer: Canonicalizer,
    private profile: CanonicalizationProfile
  ) {}

  async calculate(snapshot: WorldStateSnapshot): Promise<HashDescriptor> {
    const parent = snapshot.identity.parent_snapshot
      ? {
          id: snapshot.identity.parent_snapshot.id,
          version: snapshot.identity.parent_snapshot.version,
          content_hash: snapshot.identity.parent_snapshot.content_hash
        }
      : undefined;

    const payload = {
      identity: {
        snapshot_id: snapshot.identity.snapshot_id,
        parent_snapshot: parent,
        created_at: snapshot.identity.created_at
      },
      entries: snapshot.entries.map((ref: RegistryReference) => ({
        id: ref.id,
        version: ref.version,
        content_hash: ref.content_hash
      }))
    };

    const bytes = this.canonicalizer.serialize(payload, this.profile);
    return this.hashEngine.hash(bytes, "sha256-v1");
  }
}
