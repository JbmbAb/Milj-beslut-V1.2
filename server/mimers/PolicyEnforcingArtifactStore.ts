import {
  PROMOTION_ARTIFACT_POLICY,
  assertDeleteAllowed,
  assertPutAllowed,
  type ArtifactPolicy,
} from '@miljobeslut/mimers-brunn-core';
import type { ArtifactStore } from '../artifact/ArtifactStore';

export type PolicyEnforcingArtifactStoreOptions = {
  readonly policies?: readonly ArtifactPolicy[];
};

/**
 * WORM enforcement layer over any ArtifactStore (ADR-042).
 * Denies overwrite/delete for immutable namespaces such as `promotion/`.
 */
export class PolicyEnforcingArtifactStore implements ArtifactStore {
  private readonly policies: readonly ArtifactPolicy[];

  constructor(
    private readonly inner: ArtifactStore,
    options: PolicyEnforcingArtifactStoreOptions = {},
  ) {
    this.policies = options.policies ?? [PROMOTION_ARTIFACT_POLICY];
  }

  async put<T>(key: string, value: T): Promise<void> {
    const policy = this.matchPolicy(key);
    if (policy) {
      const existing = await this.inner.get(key);
      assertPutAllowed(policy, existing !== undefined);
    }
    await this.inner.put(key, value);
  }

  async get<T>(key: string): Promise<T | undefined> {
    return this.inner.get<T>(key);
  }

  async list(prefix: string): Promise<readonly string[]> {
    return this.inner.list(prefix);
  }

  async delete(key: string): Promise<void> {
    const policy = this.matchPolicy(key);
    if (policy) assertDeleteAllowed(policy);
    const deletable = this.inner as ArtifactStore & { delete?(k: string): Promise<void> };
    if (typeof deletable.delete !== 'function') {
      throw new Error('Underlying ArtifactStore does not support delete()');
    }
    await deletable.delete(key);
  }

  private matchPolicy(key: string): ArtifactPolicy | undefined {
    const normalized = key.replace(/\\/g, '/').replace(/^\/+/, '');
    return this.policies.find(
      (p) => normalized === p.namespace || normalized.startsWith(`${p.namespace}/`),
    );
  }
}
