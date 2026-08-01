import type {
  RegistryEntry,
  RegistrySnapshot,
} from "./RegistryTypes";

import type {
  CanonicalArtifactSerializer,
  CanonicalHashEngine,
  ArtifactIdentityStrategy,
} from "@miljobeslut/mps-core";

function sortEntries(
  entries: readonly RegistryEntry[]
): readonly RegistryEntry[] {
  return [...entries].sort((a, b) =>
    a.reference.id.localeCompare(b.reference.id)
  );
}

export class RegistrySnapshotBuilder {

  constructor(
    private readonly serializer: CanonicalArtifactSerializer,
    private readonly hashEngine: CanonicalHashEngine,
    private readonly identityStrategy: ArtifactIdentityStrategy,
    private readonly clock: { now(): Date }
  ) {}

  build(
    governance_profiles: readonly RegistryEntry[],
    policy_sets: readonly RegistryEntry[],
    replay_profiles: readonly RegistryEntry[],
    archive_profiles: readonly RegistryEntry[],
    promotion_profiles: readonly RegistryEntry[]
  ): RegistrySnapshot {

    const created_at = this.clock.now().toISOString();

    const snapshotCore = {
      created_at,
      governance_profiles: sortEntries(governance_profiles),
      policy_sets: sortEntries(policy_sets),
      replay_profiles: sortEntries(replay_profiles),
      archive_profiles: sortEntries(archive_profiles),
      promotion_profiles: sortEntries(promotion_profiles),
    };

    const bytes = this.serializer.serialize(snapshotCore);
    const hash = this.hashEngine.hash(bytes);
    const snapshot_id = this.identityStrategy.createArtifactId(hash);

    return {
      snapshot_id,
      registry_hash: hash.digest,
      created_at,
      governance_profiles: snapshotCore.governance_profiles,
      policy_sets: snapshotCore.policy_sets,
      replay_profiles: snapshotCore.replay_profiles,
      archive_profiles: snapshotCore.archive_profiles,
      promotion_profiles: snapshotCore.promotion_profiles,
    };
  }
}
