Evolve legal corpus hybrid search parameters for Miljöbeslut.

You may only change code inside the EVOLVE-BLOCK in `program.py`. The block
defines a `SearchParams` dataclass or dict with these fields:

- RRF_K (int): reciprocal rank fusion constant
- FTS_CANDIDATE_LIMIT (int)
- VECTOR_CANDIDATE_LIMIT (int)
- RRF_CANDIDATE_LIMIT (int): top fused candidates before rerank
- RERANKER_FINAL_K (int): final chunk count
- LEGAL_RERANKER_RELATIVE_GAP (float): skip rerank when top-1 dominates

Goals:
- Maximize weighted recall on the fixed eval-set (must_include_terms in results)
- Minimize p95 latency (score uses neg_weighted_recall as primary, latency as tie-break)

Constraints:
- Stay within min/max bounds in eval-set.json
- Do not disable verification or manipulate the evaluator
- Do not import non-stdlib modules inside the evolve block

The seed values mirror production defaults from searchService.ts and
searchLegalCorpusTool.ts. Improved params require human review before prod.
