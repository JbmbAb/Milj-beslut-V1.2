import { describe, expect, it } from 'vitest';
import type { CompilationResult, PipelineDefinition } from '../../../server/compiler';
import { BatchShadowEvaluator } from '../../../server/evolve';
import { hashArtifact } from '../../../server/utils/hashArtifact';

function compilation(definition: PipelineDefinition): CompilationResult {
  const executionHash = hashArtifact(definition);
  return {
    pipeline: {
      id: definition.id,
      version: definition.version,
      manifest: { pipelineId: definition.id, pipelineVersion: definition.version, nodes: [] },
      hashes: { manifestHash: executionHash, executionHash },
      executionOrder: [],
      nodes: [],
    },
    manifest: { pipelineId: definition.id, pipelineVersion: definition.version, nodes: [] },
    hashes: { manifestHash: executionHash, executionHash },
    warnings: [],
    durationMs: 0,
  };
}

describe('BatchShadowEvaluator', () => {
  it('returns deterministic batch results in candidate order', async () => {
    const baseline = compilation({ id: 'base', version: '1', nodes: [] });
    const candidates = [
      compilation({ id: 'c0', version: '1', nodes: [] }),
      compilation({ id: 'c1', version: '1', nodes: [] }),
    ];
    const shadow = new BatchShadowEvaluator();

    const first = await shadow.evaluateBatch(candidates, baseline);
    const second = await shadow.evaluateBatch(candidates, baseline);

    expect(first).toHaveLength(2);
    expect(first[0]?.metricsCandidate.qualityScore).toBeLessThan(
      first[1]?.metricsCandidate.qualityScore ?? 0,
    );
    expect(first).toEqual(second);
  });
});
