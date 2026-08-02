import {
  ArtifactRepository,
  ArtifactIndex,
  ArtifactResolver,
  ArtifactVerifier,
  ArtifactExporter,
  ArtifactLineage,
  ArtifactSnapshotManager,
  ArtifactRetentionExecutor
} from '../contracts/index.js';

export class DefaultArtifactRepositoryImpl implements ArtifactRepository {
  constructor(
    readonly resolver: ArtifactResolver,
    readonly verifier: ArtifactVerifier,
    readonly exporter: ArtifactExporter,
    readonly lineage: ArtifactLineage,
    readonly snapshots: ArtifactSnapshotManager,
    readonly retention: ArtifactRetentionExecutor,
    readonly index: ArtifactIndex
  ) {}
}