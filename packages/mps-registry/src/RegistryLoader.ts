import type {
  ContentReference,
} from "@miljobeslut/mps-core";

import type {
  RegistrySource,
} from "./RegistrySource";

import type {
  RegistryEntry,
  RegistrySnapshot,
  RegistryKind,
} from "./RegistryTypes";

import {
  RegistryLoadViolation,
} from "./RegistryErrors";

import {
  RegistryValidator,
} from "./RegistryValidator";

import {
  RegistryResolver,
} from "./RegistryResolver";

import {
  RegistrySnapshotBuilder,
} from "./RegistrySnapshotBuilder";

import {
  RegistryCompletenessValidator,
} from "./RegistryCompletenessValidator";

export class RegistryLoader {

  constructor(
    private readonly source: RegistrySource,
    private readonly validator: RegistryValidator,
    private readonly resolver: RegistryResolver,
    private readonly snapshotBuilder: RegistrySnapshotBuilder,
    private readonly completenessValidator: RegistryCompletenessValidator
  ) {}

  async load(): Promise<RegistrySnapshot> {

    const references = await this.source.list();

    const governance_profiles: RegistryEntry[] = [];
    const policy_sets: RegistryEntry[] = [];
    const replay_profiles: RegistryEntry[] = [];
    const archive_profiles: RegistryEntry[] = [];
    const promotion_profiles: RegistryEntry[] = [];

    for (const ref of references) {

      let artifact: unknown;

      try {
        artifact = await this.source.load(ref);
      } catch (err) {
        throw new RegistryLoadViolation(
          "REGISTRY_LOAD_FAILED",
          "Failed to load registry artifact",
          ref,
          err
        );
      }

      const verification = await this.validator.validate(artifact, ref);

      const kind: RegistryKind =
        this.resolver.resolveKind(ref.schema_ref);

      const entry: RegistryEntry = {
        reference: ref,
        kind,
        schema_version: ref.schema_ref?.schema_version ?? "unknown",
        verification,
      };

      switch (kind) {
        case "governance-profile":
          governance_profiles.push(entry);
          break;

        case "policy-set":
          policy_sets.push(entry);
          break;

        case "replay-profile":
          replay_profiles.push(entry);
          break;

        case "archive-profile":
          archive_profiles.push(entry);
          break;

        case "promotion-profile":
          promotion_profiles.push(entry);
          break;
      }
    }

    const snapshot = this.snapshotBuilder.build(
      governance_profiles,
      policy_sets,
      replay_profiles,
      archive_profiles,
      promotion_profiles
    );

    this.completenessValidator.validate(snapshot);

    return snapshot;
  }
}
