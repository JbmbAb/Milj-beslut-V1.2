import type {
  RegistrySnapshot,
} from "@miljobeslut/mps-registry";

import type {
  ArtifactStore,
} from "@miljobeslut/mps-artifact-store";

import type {
  ReplayEngine,
} from "@miljobeslut/mps-replay";

import type {
  DecisionClock,
  UniqueIdGenerator,
  ArtifactVerifier,
  ContentReference,
} from "@miljobeslut/mps-core";

export interface GovernancePolicyEngine {
  evaluate(reference: ContentReference): Promise<unknown>;
}

export interface ArchiveEngine {
  archive(reference: ContentReference): Promise<unknown>;
}

export interface PromotionEngine {
  promote(reference: ContentReference): Promise<unknown>;
}

export interface ExecutionContext {
  readonly registry: RegistrySnapshot;
  readonly store: ArtifactStore;

  readonly governance: GovernancePolicyEngine;
  readonly archive: ArchiveEngine;
  readonly promotion: PromotionEngine;
  readonly replay: ReplayEngine;

  readonly artifactVerifier: ArtifactVerifier;

  readonly clock: DecisionClock;
  readonly idGen: UniqueIdGenerator;
}
