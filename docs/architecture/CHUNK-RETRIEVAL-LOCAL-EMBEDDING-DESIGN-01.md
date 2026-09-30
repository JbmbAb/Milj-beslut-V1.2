# CHUNK-RETRIEVAL-LOCAL-EMBEDDING-DESIGN-01

Status: DESIGN ONLY — verifiering före kod.
Authority: K-116 / K-123 / A7.
No chunk implementation, model installation, DB migration or DB write is authorized by this document.

Review anchors (2026-09-29):

- base/main: dc78d44cd47c9a9cc46ffc805a53751861221765 (implementation worktree base; K1a already merged).
- D2.1c: K-138 cold-verified with no findings.
- K1a: PROVEN / MERGED via PR #195; trusted gate 36544372909.
- CHUNK-EVIDENCE-V2.4: NO-GO / RESEARCH_ONLY; A remains fallback.
- This candidate is design-only; no implementation or model/runtime installation is included.

## 0. Ordered lane

1. D2.1c freeze of out/demo-01-v2.
2. K1a (orthogonal, may run in parallel): canonical entrypoint / no-self-start / disposition matrix.
3. This design note -> cold verifier.
4. New chunk design implementation only after verifier accepts the design.
5. Frozen retrieval eval.
6. Local embedding-provider eval: BAAI/bge-m3 vs intfloat/multilingual-e5-large, one round.
7. Re-embed frozen sample corpus only with winning model.
8. Requirement extraction module (rules-v3).
9. K1b/K1c.
10. Full harvest/materialization/embeddings only after the above are accepted.

A remains the production fallback throughout.

## 1. Bound local evaluation evidence

The three v2.4 local evidence files are outside the chunk worktree by design and are local-only because they bind real gold documents:

- C:\wt-outlook-mimer-ingestion\out\demo-01\_work\eval-v24-results.json
  SHA-256 6A7E0F1252992671C92D5FD2288057F9B1D01EE0F034DACB9D2502C9A0C5B361
- C:\wt-outlook-mimer-ingestion\out\demo-01\_work\candidate-c-v24-chunks.jsonl
  SHA-256 D9EF9840A6BE14A513A203F249F1D6FFF27F9E5A0BF80CC42F595757FCD5EA79
- C:\wt-outlook-mimer-ingestion\out\demo-01\_work\retrieval-embedding-v24-results.json
  SHA-256 DC1DC24A285E84242BADFE2ED72EDB9DED0751B89F3FD28C13D77DD50E6D0487

These hashes are evidence inputs, never repo fixtures.

## 2. Corrected embedding baseline

Database baseline is authoritative:

- 31,718 materialized chunks.
- 31,711 embedding rows.
- 31,706 rows: gemini-embedding-001.
- 5 rows: gemini-embedding-2.
- existing vector dimension: 3072.

The Google embeddings are frozen historical A-evidence only. They are never called, extended or used as a fallback in the new path.

## 3. New chunk design: A+STRUCTURE, not “v2.5 tuning”

### Problem learned from v2.4

v2.4 improved marker coverage and citation precision but failed the frozen quality bars:

- marker 15/21 PASS
- citation 165/165 PASS
- administrative false hits 0 PASS
- section integrity 62/78 FAIL
- recall 67/78 FAIL
- BM25 retrieval lower than A

The failure mechanism was boundary mutation: structure detection became a segmentation authority and split source spans that A had kept intact.

### Design decision

The next candidate is an **annotation-first chunker**:

1. The frozen A algorithm remains the sole text-boundary authority:
   - max 3200 characters
   - paragraph boundaries
   - 400-character overlap only when splitting long paragraphs
2. Chunk body bytes and A chunk ordering are preserved.
3. A separate deterministic structure pass scans the original document and produces source-span annotations.
4. Each A chunk receives zero or more structural annotations by source-span intersection.
5. Structural annotation must never move, split, merge, truncate or rewrite an A chunk body.

This makes section integrity/recall preservation a construction invariant rather than a tuning target.

### Structural annotations

Each chunk may carry:

- document_type
- section_role
- heading_path
- paragraph_number
- requirement_block_id
- source_span
- page
- chunk_version / annotation_version
- marker_version

Roles:

- DECISION_BLOCK
- REQUIREMENT_CONDITION
- REQUIREMENT_PRECAUTION
- REQUIREMENT_CONTROL
- REASONING
- ADMIN
- GENERAL

Roles are structural metadata only, never a legal-effect classification.

### Marker parser

Use the frozen v2.4 marker vocabulary plus verified observed heading variants, but only to create annotations.
No fuzzy matching, LLM heading inference or semantic rewriting.

Negative/admin headings remain:
BAKGRUND, LAGSTÖD, ÖVERKLAGANDE, AVGIFT, INFORMATION.

Numbered blocks may inherit an operative role only after an explicit operative heading.
A numbered list can never itself promote an unclassified/admin section into a requirement section.

### Multiple roles / partial overlap

If one A chunk crosses a structural boundary:

- body remains unchanged;
- metadata contains ordered span annotations with local offsets;
- the chunk-level primary role is the role covering the largest body span;
- consumers that need exact requirement spans use the annotation spans, not the primary role.

This avoids the v2.4 integrity loss while retaining precise downstream provenance.

## 4. Predeclared chunk acceptance

Frozen 21-document / 78-positive-row gold set. One implementation round after design approval.

Hard bars:

- A body preservation: 100% byte-identical A chunk bodies and order for the frozen corpus.
- section integrity >= 71/78.
- recall >= 73/78.
- citation precision >= 255/263 (A level).
- marker coverage >= 15/21.
- administrative false section hits = 0.
- deterministic replay: identical chunk+annotation hashes on two runs.

Because A bodies are preserved, any failure of the first three A-level bars is a harness/annotation defect and is a NO-GO, not a tuning invitation.

No second marker-tuning loop.

## 5. Retrieval eval, frozen before embedding

Use exactly the same 78 frozen questions/targets.

A lexical baseline already measured:

- Recall@1 = 0.858974
- Recall@3 = 0.910256
- Recall@5 = 0.910256
- Recall@10 = 0.910256
- MRR = 0.884615

The new A+STRUCTURE body-only BM25 must be byte-equivalent to A and therefore reproduce these metrics. Any difference is a defect.

Structural metadata is not allowed to alter retrieval ranking in this unit. The retrieval acceptance test is the byte-equivalent A body-only BM25 baseline only.

A structure-aware diagnostic may stratify/report the frozen BM25 results by structural annotation (for example section_role or document_type), but it must not filter, boost, rerank, rewrite the query, or otherwise change the ordered result list. Any future metadata-based ranking change is a separate design/eval unit with its ranking rule frozen before execution.

## 6. Local embedding provider — A7

Candidates only:

1. BAAI/bge-m3
2. intfloat/multilingual-e5-large

One model wins and becomes the single local embedding model for Mimer. No model routing and no Google fallback.

Both candidates expose 1024-dimensional dense embeddings. BGE-M3 supports a much longer input sequence (8192) while multilingual-e5-large is limited to 512 tokens; E5 requires the documented query/passage prefix convention for retrieval. These differences are part of the fixed pipeline identity and are not tuned during the single eval round.

### Runtime choice: Python + sentence-transformers + CUDA

Preferred evaluation/runtime for this unit:

- Python
- sentence-transformers
- PyTorch CUDA
- RTX 4050 Laptop GPU, 6 GB
- FP16 where the pinned model/runtime supports it
- conservative fixed batch size determined by a preflight memory check, not by retrieval quality
- exact Hugging Face revision hash pinned before first embedding is generated

Why Python first:

1. Both A7 candidates publish SentenceTransformers-compatible model artifacts.
2. It gives the shortest common implementation path for an apples-to-apples model comparison.
3. CUDA execution on the existing RTX 4050 is direct and observable.
4. Tokenization, pooling and normalization can be pinned and recorded with the model revision.
5. It avoids introducing an ONNX conversion/runtime as an additional variable during the model-selection eval.

Node/ONNX remains an implementation option only after the winning model is known. Moving to ONNX later is a separate equivalence unit because it changes pipeline/runtime identity and must demonstrate numerically/ranking-equivalent behavior.

### Model-specific fixed pipeline

BAAI/bge-m3:

- dense embedding mode only for A7 comparison;
- L2-normalized vectors;
- no sparse/ColBERT features in this unit;
- no query instruction prefix;
- tokenizer/model max length recorded from pinned revision.

multilingual-e5-large:

- dense embedding mode;
- L2-normalized vectors;
- queries prefixed exactly "query: ";
- chunks/passages prefixed exactly "passage: ";
- max_length = 512 with deterministic truncation;
- truncation count reported.

No candidate receives candidate-specific query rewriting or retrieval tuning beyond its documented required input convention.

## 7. Embedding identity — binding contract

packages/mps-embedding-identity, contract embed-identity-1 is authoritative.

Every persisted or evaluation embedding identity must bind:

- fragment_id
- materialization_id
- chunk_content_hash
- embedding_model_id
- embedding_model_version = exact Hugging Face revision hash
- embedding_pipeline_version

Proposed pipeline IDs for the eval (names fixed before run):

- local-st-bge-m3-dense-v1
- local-st-multilingual-e5-large-v1

The eval artifact additionally records:

- vector dimension
- normalization = l2
- tokenizer max length
- actual truncation count
- sentence-transformers version
- transformers version
- torch version
- CUDA version
- GPU name
- dtype
- batch size

These extra fields do not replace the six identity fields.

## 8. Dimension / persistence boundary

Both A7 candidates are expected to emit 1024 dimensions, while the existing table is vector(3072).

Therefore:

- do NOT write either candidate into the current 3072-dimensional embedding column/table;
- no schema mutation in this design/eval step;
- the 78-query sample eval is file/in-memory only;
- if a 1024-dimensional winner is selected for persistence, a new versioned table/column requires a dedicated Prisma migration Dev-Gov unit and Jimmy's explicit approval.

No overwrite or conversion of the historical 3072-dimensional baseline.

## 9. Frozen embedding eval protocol

Corpus:

- frozen A+STRUCTURE sample chunks only;
- 78 frozen queries;
- identical candidate corpus and target labels for both models.

Metrics:

- Recall@1
- Recall@3
- Recall@5
- Recall@10
- MRR
- source/document target hit rate at k=10
- citation-span hit rate, if the frozen gold row contains an explicit citation span (diagnostic only; not an eligibility bar in this unit)
- query/chunk truncation counts
- encode wall time and peak GPU memory (diagnostic only, not quality score)

### Predeclared acceptance bar

A candidate is eligible only if all are true:

- Recall@3 >= 0.910256
- Recall@10 >= 0.910256
- MRR >= 0.884615
- source/document target hit rate@10 >= 71/78 (the frozen A lexical Recall@10 baseline)
- 0 identity-contract violations
- deterministic top-10 ranking on replay using the same hardware/runtime/pinned revision
- no OOM/fallback-to-CPU events hidden from the report

Winner among eligible candidates:

1. higher MRR;
2. if tied within 0.005, higher Recall@3;
3. if still tied, higher Recall@1;
4. if still tied, lower truncation count;
5. if still tied, lower measured encode time.

If neither candidate meets every hard bar: NO-GO. A remains active and no full re-embedding/full harvest follows.

Exactly one comparison round. No query tuning, model-specific threshold tuning or second model pass.

## 10. Outputs expected after design approval

Local-only audit outputs:

- chunk-annotation-eval.json
- retrieval-a-structure-eval.json
- embedding-bge-m3-eval.json
- embedding-multilingual-e5-large-eval.json
- embedding-model-selection.json
- pinned-model-revisions.json
- SHA256 manifest for all eval artifacts

Repo-safe outputs:

- implementation and synthetic fixtures only;
- no real 21-document corpus, 78 queries, source quotes or embeddings in git.

## 11. Stop conditions

Stop immediately and report NO-GO if:

- A body bytes/order change;
- frozen chunk bars fail;
- a model cannot fit/run reproducibly on the RTX 4050 without hidden CPU/cloud fallback;
- exact HF revision cannot be pinned;
- identity fields are incomplete;
- vector dimension differs from declared model output;
- any code attempts Google/Vertex/Gemini;
- persistence would require touching the existing vector(3072) table without a separately approved migration unit.
