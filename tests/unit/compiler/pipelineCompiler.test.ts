import { describe, it, expect } from 'vitest';
import {
  PipelineCompiler,
  CapabilityResolutionPass,
  PolicyResolutionPass,
  canonicalJSONStringify,
  type PipelineDefinition,
  type CapabilityImplementation,
  type ExecutionPolicy,
} from '../../../server/compiler';

const implementations: CapabilityImplementation[] = [
  {
    id: 'impl-retrieve',
    capabilityId: 'retrieve',
    version: '1.0.0',
    runtimeProfile: 'cpu',
  },
  {
    id: 'impl-rerank',
    capabilityId: 'rerank',
    version: '1.0.0',
    runtimeProfile: 'cpu',
  },
];

/** Policy.name must equal node.capability (compiler contract). */
const policies: ExecutionPolicy[] = [
  { id: 'pol-retrieve', name: 'retrieve', config: {} },
  { id: 'pol-rerank', name: 'rerank', config: {} },
];

function fixtureDefinition(): PipelineDefinition {
  return {
    id: 'rag-demo',
    version: '1.0.0',
    nodes: [
      {
        id: 'n1',
        capability: 'retrieve',
        inputs: ['query'],
        outputs: ['docs'],
        resources: ['vector-index'],
      },
      {
        id: 'n2',
        capability: 'rerank',
        inputs: ['docs'],
        outputs: ['ranked'],
      },
    ],
  };
}

describe('canonicalJSONStringify', () => {
  it('is key-order independent for objects', () => {
    const a = canonicalJSONStringify({ b: 1, a: 2 });
    const b = canonicalJSONStringify({ a: 2, b: 1 });
    expect(a).toBe(b);
  });
});

describe('PipelineCompiler', () => {
  it('compiles deterministically (same hashes twice)', async () => {
    const compiler = new PipelineCompiler(
      new CapabilityResolutionPass(implementations),
      new PolicyResolutionPass(policies),
    );

    const def = fixtureDefinition();
    const first = await compiler.compile(def);
    const second = await compiler.compile(def);

    expect(first.hashes.manifestHash).toBe(second.hashes.manifestHash);
    expect(first.hashes.executionHash).toBe(second.hashes.executionHash);
    expect(first.pipeline.executionOrder).toEqual(['n1', 'n2']);
    expect(first.manifest.nodes[0]?.resources).toEqual(['vector-index']);
    expect(first.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('throws when capability implementation is missing', async () => {
    const compiler = new PipelineCompiler(
      new CapabilityResolutionPass([]),
      new PolicyResolutionPass(policies),
    );
    await expect(compiler.compile(fixtureDefinition())).rejects.toThrow(/No implementation/);
  });

  it('throws when policy is missing', async () => {
    const compiler = new PipelineCompiler(
      new CapabilityResolutionPass(implementations),
      new PolicyResolutionPass([]),
    );
    await expect(compiler.compile(fixtureDefinition())).rejects.toThrow(/No policy/);
  });

  it('throws on duplicate node ids', async () => {
    const compiler = new PipelineCompiler(
      new CapabilityResolutionPass(implementations),
      new PolicyResolutionPass(policies),
    );
    const bad: PipelineDefinition = {
      id: 'bad',
      version: '1',
      nodes: [
        { id: 'x', capability: 'retrieve' },
        { id: 'x', capability: 'rerank' },
      ],
    };
    await expect(compiler.compile(bad)).rejects.toThrow(/Duplicate node id/);
  });
});
