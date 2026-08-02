import { ArtifactReference } from '../types/ArtifactReference.js';

export interface ArtifactRepository {
  readonly resolver: ArtifactResolver;
  readonly verifier: ArtifactVerifier;
  readonly exporter: ArtifactExporter;
  readonly lineage: ArtifactLineage;
  readonly snapshots: ArtifactSnapshotManager;
  readonly retention: ArtifactRetentionExecutor;
  readonly index: ArtifactIndex;
}

export interface ArtifactIndex {
  has(ref: ArtifactReference): Promise<boolean>;
}

export interface ArtifactResolver {
  resolve<T>(ref: ArtifactReference): Promise<Readonly<T>>;
}

export interface ArtifactVerifier {
  verify(ref: ArtifactReference): Promise<any>;
}

export interface ArtifactExporter {
  export(ref: ArtifactReference): Promise<any>;
}

export interface ArtifactLineage {
  parents(ref: ArtifactReference): Promise<ArtifactReference[]>;
  children(ref: ArtifactReference): Promise<ArtifactReference[]>;
  ancestors(ref: ArtifactReference): Promise<ArtifactReference[]>;
  descendants(ref: ArtifactReference[]): Promise<ArtifactReference[]>;
}

export interface ArtifactSnapshotManager {
  createSnapshot(refs: ArtifactReference[]): Promise<any>;
}

export interface ArtifactRetentionExecutor {
  executeRetention(): Promise<void>;
}

export interface StorageBackend {
  read(id: string): Promise<Uint8Array>;
  write(id: string, bytes: Uint8Array): Promise<void>;
}

export interface ArtifactRepositoryMetrics {
  incrementReadCount(): void;
  incrementWriteCount(): void;
}

export interface VerificationPolicy {
  readonly requireSignatures: boolean;
  readonly requireStrictLineage: boolean;
}