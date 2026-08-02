import { StorageBackend, ArtifactResolver, ArtifactVerifier, ArtifactSnapshotManager, ArtifactRetentionExecutor } from '../contracts/index.js';
import { VerificationContext } from './VerificationContext.js';
import { CanonicalDeserializer } from '../contracts/CanonicalDeserializer.js';
import { SnapshotFactory } from './SnapshotFactory.js';
import { RepositoryPolicies } from './RepositoryBuilder.js';
import { ArtifactReference } from '../types/ArtifactReference.js';

export class AppendOnlyStore {
  constructor(private readonly backend: StorageBackend) {}
}

export class ContentAddressResolver implements ArtifactResolver {
  constructor(private readonly store: AppendOnlyStore, private readonly deserializer: CanonicalDeserializer) {}
  async resolve<T>(ref: ArtifactReference): Promise<Readonly<T>> { throw new Error('stub'); }
}

export class HashVerifier { constructor(ctx: VerificationContext) {} }
export class SchemaVerifier { constructor(ctx: VerificationContext) {} }
export class SignatureVerifier { constructor(ctx: VerificationContext) {} }
export class LineageVerifier { constructor(ctx: VerificationContext) {} }

export class RepositoryVerifier implements ArtifactVerifier {
  constructor(h: HashVerifier, s: SchemaVerifier, sig: SignatureVerifier, l: LineageVerifier) {}
  async verify(ref: ArtifactReference): Promise<any> { return true; }
}

export class SnapshotManager implements ArtifactSnapshotManager {
  constructor(private readonly factory: SnapshotFactory, private readonly resolver: ArtifactResolver) {}
  async createSnapshot(refs: ArtifactReference[]): Promise<any> { return {}; }
}

export class RetentionPlanner {
  constructor(private readonly policies: RepositoryPolicies) {}
}

export class RetentionExecutor implements ArtifactRetentionExecutor {
  constructor(private readonly planner: RetentionPlanner) {}
  async executeRetention(): Promise<void> {}
}