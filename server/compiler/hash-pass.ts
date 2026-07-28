import crypto from 'node:crypto';
import type { CanonicalManifest, ExecutionHashes } from './types';
import { canonicalJSONStringify } from './canonical-json';

export class HashPass {
  private readonly cache = new WeakMap<object, ExecutionHashes>();

  compute(manifest: CanonicalManifest): ExecutionHashes {
    const cached = this.cache.get(manifest);
    if (cached) return cached;

    const manifestJson = canonicalJSONStringify(manifest);
    const manifestHash = crypto.createHash('sha256').update(manifestJson).digest('hex');

    const executionJson = canonicalJSONStringify({
      pipelineId: manifest.pipelineId,
      pipelineVersion: manifest.pipelineVersion,
      nodes: manifest.nodes.map((n) => ({
        id: n.id,
        capabilityId: n.capabilityId,
        implementationId: n.implementationId,
        policyId: n.policyId,
        resources: n.resources,
      })),
    });

    const executionHash = crypto.createHash('sha256').update(executionJson).digest('hex');

    const hashes: ExecutionHashes = { manifestHash, executionHash };
    this.cache.set(manifest, hashes);
    return hashes;
  }
}
