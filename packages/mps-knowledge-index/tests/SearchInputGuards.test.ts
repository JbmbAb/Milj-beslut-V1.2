import { describe, expect, it } from 'vitest';

import {
  buildIndexProjection,
  createDeterministicHashEmbeddingProvider,
  createGovernedKnowledgeLookup,
  searchKnowledgeIndex,
  validateFilters,
  validateRequest,
  type GovernedKnowledgeLookup,
  type KnowledgeEmbeddingProvider,
  type KnowledgeIndexProjection,
} from '../src';
import { fixtureCorpus, SFS, type FixtureCorpus } from './fixtures';

let corpus: FixtureCorpus;
let index: KnowledgeIndexProjection;
let governed: GovernedKnowledgeLookup;
const provider: KnowledgeEmbeddingProvider = createDeterministicHashEmbeddingProvider({ dimensions: 64 });
async function setup(): Promise<void> {
  if (!corpus) {
    corpus = await fixtureCorpus();
    index = (await buildIndexProjection(corpus.snapshot, provider)).index;
    governed = createGovernedKnowledgeLookup(corpus.snapshot);
  }
}

describe('K2.2 search input guards (round 2) — the validated filter IS the applied filter', () => {
  it('getter, non-enumerable, inherited and proxy-backed filter keys cannot pass validation with one value and apply with another', async () => {
    await setup();
    const baseline = await searchKnowledgeIndex(
      index,
      provider,
      { query: 'miljöfarlig verksamhet', filters: { source_ids: ['no-such-source'] } },
      governed,
    );
    expect(baseline.candidate_count).toBe(0);

    let n = 0;
    const flipping = {
      get source_ids() {
        n += 1;
        return n <= 2 ? ['no-such-source'] : undefined;
      },
    };
    const viaGetter = await searchKnowledgeIndex(
      index,
      provider,
      { query: 'miljöfarlig verksamhet', filters: flipping as never },
      governed,
    );
    expect(viaGetter.candidate_count).toBe(0); // read once: the validated value is the applied value
    expect(viaGetter.applied_filters).toEqual({ source_ids: ['no-such-source'] });

    const hidden = Object.defineProperty({}, 'source_ids', { value: ['no-such-source'], enumerable: false });
    expect(
      (await searchKnowledgeIndex(index, provider, { query: 'x', filters: hidden as never }, governed))
        .candidate_count,
    ).toBe(0);

    const inherited = Object.create({ source_ids: ['no-such-source'] }) as object;
    expect(
      (await searchKnowledgeIndex(index, provider, { query: 'x', filters: inherited as never }, governed))
        .candidate_count,
    ).toBe(0);

    const proxy = new Proxy(
      {},
      { ownKeys: () => [], get: (_t, k) => (k === 'source_ids' ? ['no-such-source'] : undefined) },
    );
    expect(
      (await searchKnowledgeIndex(index, provider, { query: 'x', filters: proxy as never }, governed))
        .candidate_count,
    ).toBe(0);

    const inheritedUnknown = Object.create({ sourceIds: [SFS.source_id] }) as object;
    expect(() => validateFilters(inheritedUnknown)).toThrow(/unknown filter/);
    let m = 0;
    const flipToBad = {
      get source_ids() {
        m += 1;
        return m === 1 ? ['x'] : ['x', 42];
      },
    };
    expect(validateFilters(flipToBad)).toEqual({ source_ids: ['x'] });
    const rolesFlip = {
      get roles() {
        return undefined;
      },
    };
    expect(validateFilters(rolesFlip)).toEqual({});
  });

  it('request fields are refused, never coerced: top_k, abstain_below_score and query must have their exact types', async () => {
    await setup();
    const bad: unknown[] = [
      { query: 'x', top_k: '2' },
      { query: 'x', top_k: Number.NaN },
      { query: 'x', top_k: 0 },
      { query: 'x', top_k: 2.5 },
      { query: 'x', abstain_below_score: Number.NEGATIVE_INFINITY },
      { query: 'x', abstain_below_score: { valueOf: () => -1 } },
      { query: 123 },
      { query: '   ' },
      { query: null },
      {},
      null,
    ];
    for (const request of bad) {
      expect(() => validateRequest(request), JSON.stringify(request)).toThrow(/REJECT_REQUEST|must be/);
      await expect(
        searchKnowledgeIndex(index, provider, request as never, governed),
        JSON.stringify(request),
      ).rejects.toMatchObject({ code: 'REJECT_REQUEST' });
    }
    expect(validateRequest({ query: 'x' })).toEqual({
      query: 'x',
      filters: {},
      top_k: 10,
      abstain_below_score: 0,
    });
  });
});
