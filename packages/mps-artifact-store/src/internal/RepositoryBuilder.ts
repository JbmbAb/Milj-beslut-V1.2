import { CanonicalPipeline } from '@miljobeslut/mps-canonical';
import { DefaultArtifactRepositoryImpl } from './DefaultArtifactRepositoryImpl.js';
import { StorageBackend, ArtifactRepositoryMetrics, VerificationPolicy, ArtifactIndex, ArtifactLineage } from '../contracts/index.js';
import { VerificationContext } from './VerificationContext.js';
import { DefaultCanonicalDeserializer } from './DefaultCanonicalDeserializer.js';
import { DeterministicLineageGraph } from './LineageGraph.js';
import { ProjectionExporter } from './ProjectionExporter.js';
import { SnapshotFactory } from './SnapshotFactory.js';
import {
  AppendOnlyStore,
  ContentAddressResolver,
  HashVerifier,
  SchemaVerifier,
  SignatureVerifier,
  LineageVerifier,
  RepositoryVerifier,
  SnapshotManager,
  RetentionPlanner,
  RetentionExecutor
} from './stubs.js';

export interface RepositoryServices {
  readonly storageBackend: StorageBackend;
  readonly metrics: ArtifactRepositoryMetrics;
}

export interface RepositoryPolicies {
  readonly verificationPolicy: VerificationPolicy;
}

export interface RepositoryOptions {
  readonly services: RepositoryServices;
  readonly policies: RepositoryPolicies;
}

export class RepositoryBuilder {
  constructor(
    private readonly options: RepositoryOptions,
    private readonly canonicalPipeline: CanonicalPipeline,
    private readonly index: ArtifactIndex
  ) {}

  build(): DefaultArtifactRepositoryImpl {
    const deserializer = new DefaultCanonicalDeserializer(this.canonicalPipeline);
    const store = new AppendOnlyStore(this.options.services.storageBackend);
    const resolver = new ContentAddressResolver(store, deserializer);
    const verificationContext = new VerificationContext(this.options.services, this.options.policies);

    const hashVerifier = new HashVerifier(verificationContext);
    const schemaVerifier = new SchemaVerifier(verificationContext);
    const signatureVerifier = new SignatureVerifier(verificationContext);
    const lineageVerifier = new LineageVerifier(verificationContext);

    const verifier = new RepositoryVerifier(
      hashVerifier,
      schemaVerifier,
      signatureVerifier,
      lineageVerifier
    );

    const lineageGraph = new DeterministicLineageGraph(resolver);
    const lineage: ArtifactLineage = lineageGraph;

    const exporter = new ProjectionExporter(resolver);

    const snapshotFactory = new SnapshotFactory(this.canonicalPipeline);
    const snapshots = new SnapshotManager(snapshotFactory, resolver);

    const planner = new RetentionPlanner(this.options.policies);
    const retention = new RetentionExecutor(planner);

    return new DefaultArtifactRepositoryImpl(
      resolver,
      verifier,
      exporter,
      lineage,
      snapshots,
      retention,
      this.index
    );
  }
}