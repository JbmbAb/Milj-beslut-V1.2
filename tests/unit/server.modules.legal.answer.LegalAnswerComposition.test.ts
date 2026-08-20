import { describe, expect, it, vi } from 'vitest';
import {
  composeLegalAnswer,
  type ChunkContentLookup,
  type LegalAnswerDeps,
  type MaterializationSourceLookup,
} from '../../server/modules/legal/answer/LegalAnswerComposition';
import type {
  AnswerContextEntryForModel,
  AnswerGeneration,
  AnswerModelProvider,
} from '../../server/modules/legal/answer/GeminiAnswerModelProvider';
import type {
  ChunkRefLookup,
  LegalRetrievalDeps,
  SearchChunks,
  SearchHit,
} from '../../server/modules/legal/retrieval/LegalRetrievalComposition';
import type { EmbeddingProvider } from '../../server/modules/legal/retrieval/GeminiEmbeddingProvider';
import type { GovernedChunkRef } from '@miljobeslut/mps-legal-retrieval-contract';

const FAKE_VECTOR = [0.1, 0.2, 0.3];

function fakeEmbeddingProvider(): EmbeddingProvider {
  return {
    model_id: 'fake-model',
    model_version: '1',
    pipeline_version: 'fake-pipeline-v1',
    async embedBatch(texts) {
      return texts.map(() => FAKE_VECTOR);
    },
  };
}

function makeHit(overrides: Partial<SearchHit> = {}): SearchHit {
  return {
    fragment_id: 'frag:abc',
    materialization_id: 'mat:1',
    chunk_content_hash: 'hash:abc',
    structure_kind: 'law',
    distance: 0.1,
    ...overrides,
  };
}

function makeRef(overrides: Partial<GovernedChunkRef> = {}): GovernedChunkRef {
  return {
    fragment_id: 'frag:abc',
    materialization_id: 'mat:1',
    content_hash: 'hash:abc',
    structure_kind: 'law',
    ...overrides,
  };
}

/** Two distinct governed hits, resolvable and real, used across most scenarios below. */
function twoHitRetrievalDeps(): LegalRetrievalDeps {
  const hitA = makeHit({ fragment_id: 'frag:a', chunk_content_hash: 'hash:a' });
  const hitB = makeHit({ fragment_id: 'frag:b', materialization_id: 'mat:2', chunk_content_hash: 'hash:b' });
  const refA = makeRef({ fragment_id: 'frag:a', content_hash: 'hash:a' });
  const refB = makeRef({ fragment_id: 'frag:b', materialization_id: 'mat:2', content_hash: 'hash:b' });
  const searchChunks: SearchChunks = async () => [hitA, hitB];
  const lookupChunkRef: ChunkRefLookup = async (fragmentId) => (fragmentId === 'frag:a' ? refA : fragmentId === 'frag:b' ? refB : null);
  return { embeddingProvider: fakeEmbeddingProvider(), searchChunks, lookupChunkRef };
}

function fakeAnswerModel(generation: AnswerGeneration, spy?: (q: string, ctx: readonly AnswerContextEntryForModel[]) => void): AnswerModelProvider {
  return {
    model_id: 'fake-answer-model',
    model_version: '1',
    pipeline_version: 'fake-answer-pipeline-v1',
    async generateAnswer(query, context) {
      spy?.(query, context);
      return generation;
    },
  };
}

function fakeContentLookup(map: Record<string, string> = { 'frag:a': 'text A', 'frag:b': 'text B' }): ChunkContentLookup {
  return async (fragmentId) => map[fragmentId] ?? null;
}

function fakeSourceLookup(map: Record<string, string> = {}): MaterializationSourceLookup {
  return async (materializationId) => map[materializationId] ?? null;
}

describe('LEGAL-RETRIEVAL-RAG-ANSWER-COMPOSITION-01', () => {
  it('proof 1+2: valid retrieval results -> answer generated, citation referencing a returned fragment is ACCEPTED', async () => {
    const generation: AnswerGeneration = {
      insufficient_evidence: false,
      claims: [{ text: 'Claim about A.', cited_fragments: [{ fragment_id: 'frag:a', materialization_id: 'mat:1' }] }],
    };
    const deps: LegalAnswerDeps = {
      retrievalDeps: twoHitRetrievalDeps(),
      answerModel: fakeAnswerModel(generation),
      fetchChunkContent: fakeContentLookup(),
      lookupMaterializationSourceId: fakeSourceLookup(),
    };

    const outcome = await composeLegalAnswer({ query: 'test query', family: undefined }, deps);

    expect(outcome.mode).toBe('ANSWERED');
    expect(outcome.claims).toHaveLength(1);
    expect(outcome.claims[0]!.citations).toHaveLength(1);
    expect(outcome.claims[0]!.citations[0]!.fragment_id).toBe('frag:a');
  });

  it('proof 3+4: a citation to a fragment outside the retrieval set (nonexistent) is dropped, not fabricated', async () => {
    const generation: AnswerGeneration = {
      insufficient_evidence: false,
      claims: [
        {
          text: 'Claim citing something never retrieved.',
          cited_fragments: [{ fragment_id: 'frag:NEVER-RETRIEVED', materialization_id: 'mat:1' }],
        },
      ],
    };
    const deps: LegalAnswerDeps = {
      retrievalDeps: twoHitRetrievalDeps(),
      answerModel: fakeAnswerModel(generation),
      fetchChunkContent: fakeContentLookup(),
      lookupMaterializationSourceId: fakeSourceLookup(),
    };

    const outcome = await composeLegalAnswer({ query: 'legal query text' }, deps);

    // the whole claim is dropped, since it ends up with zero surviving citations
    expect(outcome.claims).toHaveLength(0);
    expect(outcome.mode).toBe('INSUFFICIENT_EVIDENCE');
  });

  it('proof 5: a real fragment_id claimed under the WRONG materialization_id fails closed and is dropped', async () => {
    const generation: AnswerGeneration = {
      insufficient_evidence: false,
      claims: [
        {
          text: 'Claim with a materialization mismatch.',
          cited_fragments: [{ fragment_id: 'frag:a', materialization_id: 'mat:WRONG' }],
        },
      ],
    };
    const deps: LegalAnswerDeps = {
      retrievalDeps: twoHitRetrievalDeps(),
      answerModel: fakeAnswerModel(generation),
      fetchChunkContent: fakeContentLookup(),
      lookupMaterializationSourceId: fakeSourceLookup(),
    };

    const outcome = await composeLegalAnswer({ query: 'legal query text' }, deps);

    expect(outcome.claims).toHaveLength(0);
    expect(outcome.mode).toBe('INSUFFICIENT_EVIDENCE');
  });

  it('proof 6: a result whose text cannot be resolved is excluded before context assembly -- never admissible for citation', async () => {
    const generation: AnswerGeneration = {
      insufficient_evidence: false,
      claims: [{ text: 'Claim about B only.', cited_fragments: [{ fragment_id: 'frag:b', materialization_id: 'mat:2' }] }],
    };
    const deps: LegalAnswerDeps = {
      retrievalDeps: twoHitRetrievalDeps(),
      answerModel: fakeAnswerModel(generation),
      // frag:a's text cannot be resolved -- only frag:b has real content
      fetchChunkContent: fakeContentLookup({ 'frag:b': 'text B' }),
      lookupMaterializationSourceId: fakeSourceLookup(),
    };

    const outcome = await composeLegalAnswer({ query: 'legal query text' }, deps);

    expect(outcome.mode).toBe('ANSWERED');
    expect(outcome.context!.selection_order).toEqual(['frag:b']);
  });

  it('proof 7: cited fragments can never exceed the retrieval set -- every citation resolves back to one of the actual retrieval results', async () => {
    const generation: AnswerGeneration = {
      insufficient_evidence: false,
      claims: [
        { text: 'About A.', cited_fragments: [{ fragment_id: 'frag:a', materialization_id: 'mat:1' }] },
        { text: 'About B.', cited_fragments: [{ fragment_id: 'frag:b', materialization_id: 'mat:2' }] },
      ],
    };
    const deps: LegalAnswerDeps = {
      retrievalDeps: twoHitRetrievalDeps(),
      answerModel: fakeAnswerModel(generation),
      fetchChunkContent: fakeContentLookup(),
      lookupMaterializationSourceId: fakeSourceLookup(),
    };

    const outcome = await composeLegalAnswer({ query: 'legal query text' }, deps);

    const retrievedFragmentIds = new Set(outcome.retrieval.results.map((r) => r.fragment_id));
    for (const claim of outcome.claims) {
      for (const citation of claim.citations) {
        expect(retrievedFragmentIds.has(citation.fragment_id)).toBe(true);
      }
    }
  });

  it('proof 8: the answer trace binds query_run_identity, the cited fragments, and the model identity', async () => {
    const generation: AnswerGeneration = {
      insufficient_evidence: false,
      claims: [{ text: 'Claim about A.', cited_fragments: [{ fragment_id: 'frag:a', materialization_id: 'mat:1' }] }],
    };
    const answerModel = fakeAnswerModel(generation);
    const deps: LegalAnswerDeps = {
      retrievalDeps: twoHitRetrievalDeps(),
      answerModel,
      fetchChunkContent: fakeContentLookup(),
      lookupMaterializationSourceId: fakeSourceLookup(),
    };

    const outcome = await composeLegalAnswer({ query: 'legal query text' }, deps);

    expect(outcome.answerTrace.query_run_identity).toBe(outcome.retrieval.trace.identity.query_hash);
    expect(outcome.answerTrace.cited_fragment_ids).toEqual(['frag:a']);
    expect(outcome.answerTrace.answer_model_id).toBe(answerModel.model_id);
    expect(outcome.answerTrace.answer_model_version).toBe(answerModel.model_version);
    expect(outcome.answerTrace.answer_pipeline_version).toBe(answerModel.pipeline_version);
    expect(outcome.answerTrace.answer_trace_hash).toHaveLength(64);
  });

  it('proof 9: zero retrieval results -> explicit INSUFFICIENT_EVIDENCE, no fabricated answer, and the model is never called', async () => {
    const spy = vi.fn();
    const answerModel = fakeAnswerModel({ insufficient_evidence: false, claims: [] }, spy);
    const emptyRetrievalDeps: LegalRetrievalDeps = {
      embeddingProvider: fakeEmbeddingProvider(),
      searchChunks: async () => [],
      lookupChunkRef: async () => null,
    };
    const deps: LegalAnswerDeps = { retrievalDeps: emptyRetrievalDeps, answerModel, fetchChunkContent: fakeContentLookup(), lookupMaterializationSourceId: fakeSourceLookup() };

    const outcome = await composeLegalAnswer({ query: 'legal query text' }, deps);

    expect(outcome.mode).toBe('INSUFFICIENT_EVIDENCE');
    expect(outcome.claims).toHaveLength(0);
    expect(spy).not.toHaveBeenCalled();
  });

  it('proof 10: identical retrieval state under deterministic fakes -> same cited evidence set on replay', async () => {
    const generation: AnswerGeneration = {
      insufficient_evidence: false,
      claims: [{ text: 'Claim about A.', cited_fragments: [{ fragment_id: 'frag:a', materialization_id: 'mat:1' }] }],
    };
    const makeDeps = (): LegalAnswerDeps => ({
      retrievalDeps: twoHitRetrievalDeps(),
      answerModel: fakeAnswerModel(generation),
      fetchChunkContent: fakeContentLookup(),
      lookupMaterializationSourceId: fakeSourceLookup(),
    });

    const outcomeA = await composeLegalAnswer({ query: 'legal query text' }, makeDeps());
    const outcomeB = await composeLegalAnswer({ query: 'legal query text' }, makeDeps());

    expect(outcomeA.answerTrace.cited_fragment_ids).toEqual(outcomeB.answerTrace.cited_fragment_ids);
    expect(outcomeA.context!.selection_order).toEqual(outcomeB.context!.selection_order);
  });

  it('the model itself reporting insufficient_evidence produces INSUFFICIENT_EVIDENCE, discarding any claims field', async () => {
    const generation: AnswerGeneration = {
      insufficient_evidence: true,
      claims: [{ text: 'should be ignored', cited_fragments: [{ fragment_id: 'frag:a', materialization_id: 'mat:1' }] }],
    };
    const deps: LegalAnswerDeps = {
      retrievalDeps: twoHitRetrievalDeps(),
      answerModel: fakeAnswerModel(generation),
      fetchChunkContent: fakeContentLookup(),
      lookupMaterializationSourceId: fakeSourceLookup(),
    };

    const outcome = await composeLegalAnswer({ query: 'legal query text' }, deps);

    expect(outcome.mode).toBe('INSUFFICIENT_EVIDENCE');
    expect(outcome.claims).toHaveLength(0);
  });

  it('answer confidence != evidence authority: a claim with a mix of valid and invalid citations keeps only the valid ones, never the whole set', async () => {
    const generation: AnswerGeneration = {
      insufficient_evidence: false,
      claims: [
        {
          text: 'Mixed claim.',
          cited_fragments: [
            { fragment_id: 'frag:a', materialization_id: 'mat:1' }, // valid
            { fragment_id: 'frag:FAKE', materialization_id: 'mat:1' }, // invalid
          ],
        },
      ],
    };
    const deps: LegalAnswerDeps = {
      retrievalDeps: twoHitRetrievalDeps(),
      answerModel: fakeAnswerModel(generation),
      fetchChunkContent: fakeContentLookup(),
      lookupMaterializationSourceId: fakeSourceLookup(),
    };

    const outcome = await composeLegalAnswer({ query: 'legal query text' }, deps);

    expect(outcome.mode).toBe('ANSWERED');
    expect(outcome.claims[0]!.citations).toHaveLength(1);
    expect(outcome.claims[0]!.citations[0]!.fragment_id).toBe('frag:a');
  });

  describe('LEGAL-ANSWER-QUERY-SPECIFICITY-GATE-01', () => {
    it('an underspecified query ("Vad gäller?") never reaches retrieval or the answer model', async () => {
      const searchSpy = vi.fn(async () => []);
      const answerSpy = vi.fn();
      const retrievalDeps: LegalRetrievalDeps = {
        embeddingProvider: fakeEmbeddingProvider(),
        searchChunks: searchSpy as unknown as SearchChunks,
        lookupChunkRef: async () => null,
      };
      const deps: LegalAnswerDeps = {
        retrievalDeps,
        answerModel: fakeAnswerModel({ insufficient_evidence: false, claims: [] }, answerSpy),
        fetchChunkContent: fakeContentLookup(),
        lookupMaterializationSourceId: fakeSourceLookup(),
      };

      const outcome = await composeLegalAnswer({ query: 'Vad gäller?' }, deps);

      expect(outcome.mode).toBe('QUERY_UNDERSPECIFIED');
      expect(outcome.claims).toHaveLength(0);
      expect(outcome.retrieval).toBeNull();
      expect(outcome.context).toBeNull();
      expect(outcome.querySpecificity.verdict).toBe('UNDERSPECIFIED');
      expect(searchSpy).not.toHaveBeenCalled();
      expect(answerSpy).not.toHaveBeenCalled();
    });

    it('a well-specified query proceeds through retrieval as normal, with querySpecificity=SPECIFIED on the outcome', async () => {
      const generation: AnswerGeneration = {
        insufficient_evidence: false,
        claims: [{ text: 'Claim about A.', cited_fragments: [{ fragment_id: 'frag:a', materialization_id: 'mat:1' }] }],
      };
      const deps: LegalAnswerDeps = {
        retrievalDeps: twoHitRetrievalDeps(),
        answerModel: fakeAnswerModel(generation),
        fetchChunkContent: fakeContentLookup(),
        lookupMaterializationSourceId: fakeSourceLookup(),
      };

      // Deliberately names no specific statute -- this test exercises the specificity gate only;
      // named-source consistency is covered separately below.
      const outcome = await composeLegalAnswer({ query: 'Vilka regler gäller för avfallshantering?' }, deps);

      expect(outcome.querySpecificity.verdict).toBe('SPECIFIED');
      expect(outcome.mode).toBe('ANSWERED');
      expect(outcome.retrieval).not.toBeNull();
    });

    it('the answer trace still binds a real query_run_identity for an underspecified query, even with no retrieval', async () => {
      const deps: LegalAnswerDeps = {
        retrievalDeps: twoHitRetrievalDeps(),
        answerModel: fakeAnswerModel({ insufficient_evidence: false, claims: [] }),
        fetchChunkContent: fakeContentLookup(),
        lookupMaterializationSourceId: fakeSourceLookup(),
      };

      const outcome = await composeLegalAnswer({ query: 'Vad gäller?' }, deps);

      expect(outcome.answerTrace.mode).toBe('QUERY_UNDERSPECIFIED');
      expect(outcome.answerTrace.query_run_identity).toHaveLength(64);
      expect(outcome.answerTrace.cited_fragment_ids).toEqual([]);
    });
  });

  describe('LEGAL-ANSWER-NAMED-SOURCE-CONSISTENCY-GATE-01', () => {
    const MB = 'regeringskansliet-sfs-1998-808'; // miljöbalken
    const MPF = 'regeringskansliet-sfs-2013-251'; // miljöprövningsförordningen

    function makeSourceHitDeps(materializationId: string, sourceId: string): { retrievalDeps: LegalRetrievalDeps; sourceMap: Record<string, string> } {
      const hit = makeHit({ fragment_id: 'frag:src', materialization_id: materializationId, chunk_content_hash: 'hash:src' });
      const ref = makeRef({ fragment_id: 'frag:src', materialization_id: materializationId, content_hash: 'hash:src' });
      const retrievalDeps: LegalRetrievalDeps = {
        embeddingProvider: fakeEmbeddingProvider(),
        searchChunks: async () => [hit],
        lookupChunkRef: async (fragmentId) => (fragmentId === 'frag:src' ? ref : null),
      };
      return { retrievalDeps, sourceMap: { [materializationId]: sourceId } };
    }

    it('"fiskelagen" named, no fiskelagen in corpus/context -> NAMED_SOURCE_NOT_AVAILABLE', async () => {
      const { retrievalDeps, sourceMap } = makeSourceHitDeps('mat:mpf', MPF); // some unrelated real source retrieved
      const answerSpy = vi.fn();
      const deps: LegalAnswerDeps = {
        retrievalDeps,
        answerModel: fakeAnswerModel({ insufficient_evidence: false, claims: [] }, answerSpy),
        fetchChunkContent: fakeContentLookup({ 'frag:src': 'some real text' }),
        lookupMaterializationSourceId: fakeSourceLookup(sourceMap),
      };

      const outcome = await composeLegalAnswer({ query: 'Vilka regler gäller för fiske enligt fiskelagen?', family: 'law' }, deps);

      expect(outcome.mode).toBe('NAMED_SOURCE_NOT_AVAILABLE');
      expect(outcome.claims).toHaveLength(0);
      expect(outcome.namedSourceConsistency!.verdict).toBe('NAMED_SOURCE_NOT_AVAILABLE');
      expect(outcome.namedSourceConsistency!.unrecognized_statute_mentions).toContain('fiskelagen');
      expect(answerSpy).not.toHaveBeenCalled(); // never reaches synthesis
    });

    it('"miljöbalken" named and present in context -> normal answer path, unaffected', async () => {
      const { retrievalDeps, sourceMap } = makeSourceHitDeps('mat:mb', MB);
      const generation: AnswerGeneration = {
        insufficient_evidence: false,
        claims: [{ text: 'Claim from Miljöbalken.', cited_fragments: [{ fragment_id: 'frag:src', materialization_id: 'mat:mb' }] }],
      };
      const deps: LegalAnswerDeps = {
        retrievalDeps,
        answerModel: fakeAnswerModel(generation),
        fetchChunkContent: fakeContentLookup({ 'frag:src': 'real miljöbalken text' }),
        lookupMaterializationSourceId: fakeSourceLookup(sourceMap),
      };

      const outcome = await composeLegalAnswer({ query: 'Vad säger miljöbalken om detta?', family: 'law' }, deps);

      expect(outcome.mode).toBe('ANSWERED');
      expect(outcome.namedSourceConsistency!.verdict).toBe('CONSISTENT');
    });

    it('query names statute A, only statute B actually retrieved -> NAMED_SOURCE_NOT_AVAILABLE, never a silent substitution', async () => {
      const { retrievalDeps, sourceMap } = makeSourceHitDeps('mat:mpf', MPF); // only MPF retrieved
      const answerSpy = vi.fn();
      const deps: LegalAnswerDeps = {
        retrievalDeps,
        answerModel: fakeAnswerModel({ insufficient_evidence: false, claims: [] }, answerSpy),
        fetchChunkContent: fakeContentLookup({ 'frag:src': 'mpf text' }),
        lookupMaterializationSourceId: fakeSourceLookup(sourceMap),
      };

      // query names ONLY miljöbalken (MB), but the fake retrieval only ever returns an MPF hit
      const outcome = await composeLegalAnswer({ query: 'Vad säger miljöbalken om detta?', family: 'law' }, deps);

      expect(outcome.mode).toBe('NAMED_SOURCE_NOT_AVAILABLE');
      expect(outcome.namedSourceConsistency!.missing_source_ids).toEqual([MB]);
      expect(answerSpy).not.toHaveBeenCalled();
    });

    it('query names no statute at all -> no fabricated source constraint, gate not evaluated', async () => {
      const { retrievalDeps, sourceMap } = makeSourceHitDeps('mat:mpf', MPF);
      const generation: AnswerGeneration = {
        insufficient_evidence: false,
        claims: [{ text: 'A generic claim.', cited_fragments: [{ fragment_id: 'frag:src', materialization_id: 'mat:mpf' }] }],
      };
      const deps: LegalAnswerDeps = {
        retrievalDeps,
        answerModel: fakeAnswerModel(generation),
        fetchChunkContent: fakeContentLookup({ 'frag:src': 'generic text' }),
        lookupMaterializationSourceId: fakeSourceLookup(sourceMap),
      };

      const outcome = await composeLegalAnswer({ query: 'Vilka regler gäller för jordbruk och djurhållning?', family: 'law' }, deps);

      expect(outcome.mode).toBe('ANSWERED');
      expect(outcome.namedSourceConsistency).toBeNull();
    });

    it('multiple named sources: all required must be accounted for -- one present, one missing still fails', async () => {
      const { retrievalDeps, sourceMap } = makeSourceHitDeps('mat:mb', MB); // only MB retrieved
      const answerSpy = vi.fn();
      const deps: LegalAnswerDeps = {
        retrievalDeps,
        answerModel: fakeAnswerModel({ insufficient_evidence: false, claims: [] }, answerSpy),
        fetchChunkContent: fakeContentLookup({ 'frag:src': 'mb text' }),
        lookupMaterializationSourceId: fakeSourceLookup(sourceMap),
      };

      const outcome = await composeLegalAnswer(
        { query: 'Vad gäller enligt både miljöbalken och miljöprövningsförordningen?', family: 'law' },
        deps,
      );

      expect(outcome.mode).toBe('NAMED_SOURCE_NOT_AVAILABLE');
      expect(outcome.namedSourceConsistency!.missing_source_ids).toEqual([MPF]);
      expect(answerSpy).not.toHaveBeenCalled();
    });

    it('the gate is scoped to family="law"/unspecified -- a court-family query naming miljöbalken is unaffected', async () => {
      const { retrievalDeps, sourceMap } = makeSourceHitDeps('mat:court', 'domstolsverket-puh-mmod');
      const generation: AnswerGeneration = {
        insufficient_evidence: false,
        claims: [{ text: 'A court claim citing 2 kap. 6 § miljöbalken in passing.', cited_fragments: [{ fragment_id: 'frag:src', materialization_id: 'mat:court' }] }],
      };
      const deps: LegalAnswerDeps = {
        retrievalDeps,
        answerModel: fakeAnswerModel(generation),
        fetchChunkContent: fakeContentLookup({ 'frag:src': 'court text' }),
        lookupMaterializationSourceId: fakeSourceLookup(sourceMap),
      };

      const outcome = await composeLegalAnswer({ query: 'Dom som tillämpar 2 kap. 6 § miljöbalken', family: 'court' }, deps);

      expect(outcome.mode).toBe('ANSWERED');
      expect(outcome.namedSourceConsistency).toBeNull();
    });
  });
});
