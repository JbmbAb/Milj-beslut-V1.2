/**
 * LEGAL-RETRIEVAL-BOUNDED-PILOT-01.
 *
 * Real embeddings, real persistence, real retrieval -- over a deliberately bounded slice of the
 * frozen governed corpus (not the full 31,706 chunk rows; that is the next, separate bulk phase).
 *
 * Scope (source-level bounded, per instruction):
 *   - Miljöbalk (1998:808) v2.4.1: chapters "1" and "18" (36 chunks) -- diverse content
 *     (general aims/definitions vs. government review), small enough to be a real "bounded" set.
 *   - 15 real MMÖD decisions (excluding the known Part G duplicate identity and the two largest
 *     decisions in the sample window, to keep total volume bounded) -- ~397 chunks.
 *   - 1 real standard source: SGU "Vägledning för att borra brunn" (7 chunks).
 *
 * Provider: Gemini API-key path (verified live before this unit -- Vertex's ADC path is broken
 * in this environment, see GeminiEmbeddingProvider.ts's doc comment and the PROVEN report).
 *
 * Usage:
 *   npx tsx scripts/db/legal-retrieval-bounded-pilot-01.ts
 */
import '../../server/loadEnvFirst';
import { prisma } from '../../server/db/prisma';
import {
  bindEmbeddingIdentity,
  type EmbeddingIdentityFields,
} from '@miljobeslut/mps-embedding-identity';
import {
  buildRetrievalResult,
  createInMemoryGovernedChunkLookup,
  RetrievalResultError,
  type GovernedChunkRef,
} from '@miljobeslut/mps-legal-retrieval-contract';
import { evaluateLegalRetrieval } from '@miljobeslut/mps-retrieval-governance';
import { createRetrievalExecutionTrace } from '@miljobeslut/mps-retrieval-trace';
import {
  createGeminiEmbeddingProvider,
  EMBEDDING_PIPELINE_VERSION,
  type EmbeddingProvider,
} from '../../server/modules/legal/retrieval/GeminiEmbeddingProvider';
import {
  countChunkEmbeddings,
  countChunkEmbeddingsByIdentityHash,
  fetchGovernedChunkRefs,
  persistChunkEmbedding,
} from '../../server/modules/legal/retrieval/LegalCorpusChunkEmbeddingPersistence';

const MMOD_MATERIALIZATION_IDS = [
  'cmt14xxie00ftcwf79rzvh4hg', 'cmt14xy3800mlcwf7egfwql5b', 'cmt14xya900o1cwf7nx0akjb0',
  'cmt14xyl100pncwf7cx959tom', 'cmt14xyuz00rhcwf7p6f47e2j', 'cmt14xz1x00ujcwf7txjzsw3f',
  'cmt14xz6v00xncwf76meaaqpt', 'cmt14xzuz016tcwf7gunfm0k8', 'cmt14y027018rcwf7nucdh6be',
  'cmt14y08v01afcwf7umbp6zsn', 'cmt14y0hb01blcwf7qkxzi8ch', 'cmt14y0qf01ddcwf7adhwjays',
  'cmt14y0za01ebcwf7hk9e29v6', 'cmt14y18v01fbcwf7bmkpi3mt', 'cmt14y41902j3cwf7262f1c7y',
];

type PilotChunk = {
  fragment_id: string;
  materialization_id: string;
  content_hash: string;
  structure_kind: 'law' | 'court' | 'standard';
  chunk_text: string;
  source_family: string;
  chapter: string | null;
  court_section: string | null;
  case_title: string;
};

async function loadPilotChunks(): Promise<PilotChunk[]> {
  const out: PilotChunk[] = [];

  // Miljöbalken v2.4.1, chapters 1 and 18
  const mbMat = await prisma.legalCorpusMaterialization.findFirst({
    where: { logicalSourceId: 'regeringskansliet-sfs-1998-808', chunkPolicyVersion: 'legal-chunker-v2.4.1' },
  });
  if (!mbMat) throw new Error('Miljöbalken v2.4.1 materialization not found -- prerequisite units not run');
  const mbChunks = await prisma.legalCorpusMaterializedChunk.findMany({
    where: { materializationId: mbMat.id, chapter: { in: ['1', '18'] } },
  });
  for (const c of mbChunks) {
    out.push({
      fragment_id: c.fragmentId, materialization_id: c.materializationId, content_hash: c.contentHash,
      structure_kind: 'law', chunk_text: c.chunkText, source_family: 'SFS', chapter: c.chapter,
      court_section: null, case_title: 'Miljöbalk (1998:808)',
    });
  }

  // 15 real MMÖD decisions
  for (const matId of MMOD_MATERIALIZATION_IDS) {
    const mat = await prisma.legalCorpusMaterialization.findUnique({ where: { id: matId }, include: { corpusRecord: true } });
    if (!mat) throw new Error(`MMÖD materialization ${matId} not found`);
    const chunks = await prisma.legalCorpusMaterializedChunk.findMany({ where: { materializationId: matId } });
    for (const c of chunks) {
      out.push({
        fragment_id: c.fragmentId, materialization_id: c.materializationId, content_hash: c.contentHash,
        structure_kind: 'court', chunk_text: c.chunkText, source_family: 'MMOD', chapter: null,
        court_section: c.courtSection, case_title: mat.corpusRecord.title,
      });
    }
  }

  // 1 standard source: SGU well-drilling guidance
  const sguMat = await prisma.legalCorpusMaterialization.findFirst({
    where: { logicalSourceId: 'sgu-well-drilling-guidance' },
    include: { corpusRecord: true },
  });
  if (!sguMat) throw new Error('SGU well-drilling materialization not found');
  const sguChunks = await prisma.legalCorpusMaterializedChunk.findMany({ where: { materializationId: sguMat.id } });
  for (const c of sguChunks) {
    out.push({
      fragment_id: c.fragmentId, materialization_id: c.materializationId, content_hash: c.contentHash,
      structure_kind: 'standard', chunk_text: c.chunkText, source_family: 'SGU', chapter: null,
      court_section: null, case_title: sguMat.corpusRecord.title,
    });
  }

  return out;
}

async function embedAndPersist(
  chunks: readonly PilotChunk[],
  provider: EmbeddingProvider,
  batchSize = 20,
): Promise<{ identities: EmbeddingIdentityFields[]; insertedCount: number; noopCount: number }> {
  const identities: EmbeddingIdentityFields[] = [];
  let insertedCount = 0;
  let noopCount = 0;

  for (let i = 0; i < chunks.length; i += batchSize) {
    const batch = chunks.slice(i, i + batchSize);
    const vectors = await provider.embedBatch(batch.map((c) => c.chunk_text));
    for (let j = 0; j < batch.length; j++) {
      const chunk = batch[j]!;
      const identity = bindEmbeddingIdentity({
        fragment_id: chunk.fragment_id,
        materialization_id: chunk.materialization_id,
        chunk_content_hash: chunk.content_hash,
        embedding_model_id: provider.model_id,
        embedding_model_version: provider.model_version,
        embedding_pipeline_version: provider.pipeline_version,
      });
      const result = await persistChunkEmbedding(identity, vectors[j]!);
      identities.push(identity);
      if (result.inserted) insertedCount++;
      else noopCount++;
    }
    console.log(`  embedded batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(chunks.length / batchSize)} (${batch.length} chunks)`);
  }

  return { identities, insertedCount, noopCount };
}

async function main() {
  console.log('########## LEGAL-RETRIEVAL-BOUNDED-PILOT-01 ##########\n');

  const provider = createGeminiEmbeddingProvider();
  console.log('provider:', provider.model_id, provider.model_version, provider.pipeline_version);

  console.log('\n--- STEP 1: load pilot chunk scope from real DB ---');
  const chunks = await loadPilotChunks();
  const byFamily = new Map<string, number>();
  for (const c of chunks) byFamily.set(c.source_family, (byFamily.get(c.source_family) ?? 0) + 1);
  console.log('pilot chunk count:', chunks.length, 'by family:', Object.fromEntries(byFamily));

  console.log('\n--- STEP 2: embed + persist (run 1) ---');
  const countBefore = await countChunkEmbeddings();
  const run1 = await embedAndPersist(chunks, provider);
  const countAfterRun1 = await countChunkEmbeddings();
  console.log('run 1: inserted =', run1.insertedCount, '| already-existed =', run1.noopCount);
  console.log('DB row count before/after run 1:', countBefore, '/', countAfterRun1);

  console.log('\n--- STEP 3: REPLAY -- embed + persist the SAME inputs again ---');
  const run2 = await embedAndPersist(chunks, provider);
  const countAfterRun2 = await countChunkEmbeddings();
  console.log('run 2 (replay): inserted =', run2.insertedCount, '(MUST be 0) | already-existed =', run2.noopCount, '(MUST equal chunk count)');
  console.log('DB row count after replay (MUST be unchanged):', countAfterRun2, countAfterRun2 === countAfterRun1 ? 'UNCHANGED -- PROVEN' : 'CHANGED -- FAIL');

  console.log('\n--- STEP 4: model change -> new embedding identity (real second model) ---');
  const altProvider = createGeminiEmbeddingProvider('gemini-embedding-2');
  const sample = chunks.slice(0, 5);
  // gemini-embedding-2 does not reliably support multi-item batches (verified: a 5-item batch
  // returned only 1 embedding) -- embedBatch's own size-mismatch check caught this and failed
  // closed rather than silently padding. Falling back to batch size 1 for this model, not
  // relaxing the mismatch check.
  const altRun = await embedAndPersist(sample, altProvider, 1);
  const sameChunkDifferentModel = run1.identities
    .filter((id) => sample.some((s) => s.fragment_id === id.fragment_id))
    .map((id) => id.embedding_identity_hash);
  const altHashes = altRun.identities.map((id) => id.embedding_identity_hash);
  const collision = sameChunkDifferentModel.some((h) => altHashes.includes(h));
  console.log('same 5 chunks under', provider.model_id, 'vs', altProvider.model_id, '-> identity collision:', collision, '(MUST be false)');
  console.log('alt-model run: inserted =', altRun.insertedCount, '(MUST be 5, all new rows)');

  console.log('\n--- STEP 5: v2.3 vs v2.4.1 of the SAME underlying text -- never one embedding identity ---');
  const v23Mat = await prisma.legalCorpusMaterialization.findFirst({
    where: { logicalSourceId: 'regeringskansliet-sfs-1998-808', chunkPolicyVersion: 'legal-chunker-v2.3' },
  });
  const v241Chunk1 = chunks.find((c) => c.chapter === '1' && c.source_family === 'SFS')!;
  const v23Chunk1 = await prisma.legalCorpusMaterializedChunk.findFirst({
    where: { materializationId: v23Mat!.id, contentHash: v241Chunk1.content_hash },
  });
  if (!v23Chunk1) throw new Error('expected a shared-content_hash v2.3 counterpart to exist');
  console.log('v2.4.1 fragment:', v241Chunk1.fragment_id, '| v2.3 fragment:', v23Chunk1.fragmentId, '| same text (content_hash):', v241Chunk1.content_hash === v23Chunk1.contentHash);

  const v23Identity = bindEmbeddingIdentity({
    fragment_id: v23Chunk1.fragmentId,
    materialization_id: v23Chunk1.materializationId,
    chunk_content_hash: v23Chunk1.contentHash,
    embedding_model_id: provider.model_id,
    embedding_model_version: provider.model_version,
    embedding_pipeline_version: provider.pipeline_version,
  });
  const [v23Vector] = await provider.embedBatch([v23Chunk1.chunkText]);
  await persistChunkEmbedding(v23Identity, v23Vector!);
  const v241Identity = run1.identities.find((id) => id.fragment_id === v241Chunk1.fragment_id)!;
  console.log('v2.3 embedding_identity_hash:', v23Identity.embedding_identity_hash);
  console.log('v2.4.1 embedding_identity_hash:', v241Identity.embedding_identity_hash);
  console.log('distinct identities despite identical text:', v23Identity.embedding_identity_hash !== v241Identity.embedding_identity_hash, '(MUST be true)');

  console.log('\n--- STEP 6: retrieval results resolve to the exact governed chunk, for the whole real pilot set ---');
  const allFragmentIds = [...new Set([...chunks.map((c) => c.fragment_id), v23Chunk1.fragmentId])];
  const refs: GovernedChunkRef[] = await fetchGovernedChunkRefs(allFragmentIds);
  const lookup = createInMemoryGovernedChunkLookup(refs);

  const decision = evaluateLegalRetrieval('LEGAL_CORPUS_SEARCH');
  let resolvedCount = 0;
  for (const identity of run1.identities) {
    const ref = refs.find((r) => r.fragment_id === identity.fragment_id)!;
    const result = buildRetrievalResult(
      {
        fragment_id: identity.fragment_id,
        materialization_id: identity.materialization_id,
        source_provenance_refs: [`materialization:${identity.materialization_id}`, `source_family:${ref.structure_kind}`],
        embedding_identity: identity,
        retrieval_policy_version: decision.policy.policy_version,
        query_run_identity: 'pilot-resolution-check',
        score: 1,
        rank: 1,
      },
      lookup,
    );
    if (result.resolved_against_governed_chunk) resolvedCount++;
  }
  console.log('resolved', resolvedCount, 'of', run1.identities.length, 'real embedded chunks back to their exact governed chunk (MUST be all)');

  console.log('\n--- STEP 7: FAIL CLOSED -- missing governed chunk ---');
  try {
    const fakeIdentity = bindEmbeddingIdentity({
      fragment_id: 'frag:does-not-exist-in-corpus',
      materialization_id: v241Chunk1.materialization_id,
      chunk_content_hash: v241Chunk1.content_hash,
      embedding_model_id: provider.model_id,
      embedding_model_version: provider.model_version,
      embedding_pipeline_version: provider.pipeline_version,
    });
    buildRetrievalResult(
      {
        fragment_id: 'frag:does-not-exist-in-corpus',
        materialization_id: v241Chunk1.materialization_id,
        source_provenance_refs: ['x'],
        embedding_identity: fakeIdentity,
        retrieval_policy_version: decision.policy.policy_version,
        query_run_identity: 'fail-closed-check',
        score: 1,
        rank: 1,
      },
      lookup,
    );
    console.log('FAIL: missing governed chunk was NOT rejected');
  } catch (err) {
    console.log('missing governed chunk correctly rejected:', err instanceof RetrievalResultError ? err.code : String(err));
  }

  console.log('\n--- STEP 8: FAIL CLOSED -- tampered embedding/chunk binding (real v2.3 embedding claimed against the v2.4.1 chunk) ---');
  try {
    buildRetrievalResult(
      {
        fragment_id: v241Chunk1.fragment_id,
        materialization_id: v241Chunk1.materialization_id,
        source_provenance_refs: ['x'],
        embedding_identity: v23Identity, // bound to the v2.3 chunk, not this one
        retrieval_policy_version: decision.policy.policy_version,
        query_run_identity: 'fail-closed-check',
        score: 1,
        rank: 1,
      },
      lookup,
    );
    console.log('FAIL: tampered embedding binding was NOT rejected');
  } catch (err) {
    console.log('tampered embedding/chunk binding correctly rejected:', err instanceof RetrievalResultError ? err.code : String(err));
  }

  console.log('\n\n========== IDENTITY/PROVENANCE PROOF SUMMARY ==========');
  console.log(JSON.stringify({
    pilot_chunk_count: chunks.length,
    by_family: Object.fromEntries(byFamily),
    replay_no_duplicates: run2.insertedCount === 0 && countAfterRun2 === countAfterRun1,
    model_change_new_identity: !collision,
    v23_v241_distinct_despite_same_text: v23Identity.embedding_identity_hash !== v241Identity.embedding_identity_hash,
    all_resolved_to_governed_chunk: resolvedCount === run1.identities.length,
  }, null, 2));

  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error('FATAL:', error);
  await prisma.$disconnect();
  process.exitCode = 1;
});
