import { CanonicalPipeline } from '@miljobeslut/mps-canonical';
import { ArtifactIndex, ArtifactRepository, ArtifactResolver, ArtifactVerifier, ArtifactExporter, ArtifactLineage, ArtifactSnapshotManager, ArtifactRetentionExecutor } from './contracts/index.js';
import { DefaultArtifactRepositoryImpl } from './internal/DefaultArtifactRepositoryImpl.js';
import { RepositoryBuilder, RepositoryOptions } from './internal/RepositoryBuilder.js';

export class DefaultArtifactRepository implements ArtifactRepository {
  private readonly _impl: DefaultArtifactRepositoryImpl;

  constructor(
    canonicalPipeline: CanonicalPipeline,
    options: RepositoryOptions,
    index: ArtifactIndex
  ) {
    const builder = new RepositoryBuilder(options, canonicalPipeline, index);
    this._impl = builder.build();
  }

  get resolver(): ArtifactResolver { return this._impl.resolver; }
  get verifier(): ArtifactVerifier { return this._impl.verifier; }
  get exporter(): ArtifactExporter { return this._impl.exporter; }
  get lineage(): ArtifactLineage { return this._impl.lineage; }
  get snapshots(): ArtifactSnapshotManager { return this._impl.snapshots; }
  get retention(): ArtifactRetentionExecutor { return this._impl.retention; }
  get index(): ArtifactIndex { return this._impl.index; }
}