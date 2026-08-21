# LEGAL-ANSWER-LEGACY-PATH-DEPRECATION-01 — IMPLEMENTED / PROVEN (partial, honestly scoped)

**Status:** IMPLEMENTED / PROVEN for the part that was safe to do; **stopped, not forced**, on the
part that had real non-UI internal dependents. Per the explicit instruction: *"If deleting the
route would break non-UI internal callers, stop and report them instead of forcing removal."*

## Scope, as approved

```
MvpLibrarianView.tsx
/api/legal/search
searchLegalCorpusHandler
searchLegalCorpusTool
old legal_corpus_chunks path
```

## Reachability re-verified first, as instructed

Same conclusion as `PRODUCT-RUNTIME-ANSWER-BYPASS-01`'s trace: `MvpLibrarianView.tsx` had zero
importers anywhere in the codebase; `/api/legal/search` had exactly one real caller
(`MvpLibrarianView.tsx`'s own `callApi('/api/legal/search', ...)`), zero others.

## What was removed

**`components/mvp/MvpLibrarianView.tsx`** — deleted. Fully orphaned: zero importers, no dedicated
test file, and its shared dependency (`services/mvpApiClient.ts`'s `callMvp`) remains used by six
other live MVP components, so nothing else was touched there.

## What was NOT removed — real non-UI internal dependents found

Re-verification (not inferred from the earlier trace alone) found that `POST /api/legal/search`,
`searchLegalCorpusHandler`, and `searchLegalCorpusTool.ts` are **not** purely dead code — they have
substantial, real, existing internal dependents unrelated to the legal-answer-bypass concern this
whole track has been closing:

- **`tests/integration/shadowValidation.integration.test.ts`** — a full integration suite covering
  auth (401), query-length validation (400), search results + "shadow validation" metrics
  (latency, reranker status, `kendallTau`, `ndcg5`, `mrr`, `recall10`, municipal-decision scoring),
  and rate limiting (429 after 30 requests/min) for this exact route. This is real, dedicated
  coverage for a **reranker-quality monitoring initiative** — a different, separate concern from
  "does the product have a governed answer path."
- **`tests/integration/routesCoverage.integration.test.ts`** — a second, general route-coverage
  integration suite also asserting this route's auth/validation/200 behavior.
- **`tests/smoke/legal_rerank_staging.test.ts`** — a staging smoke test (gated on
  `STAGING_BASE_URL`) that calls this exact route against a real deployed staging environment,
  checking reranker metadata is present. Live operational monitoring tooling.
- **`server/modules/ai/orchestrator/VertexOrkester.ts`** — still imports and registers
  `searchLegalCorpusHandler`/`searchLegalCorpusDeclaration` as its one agentic tool. `VertexOrkester`
  itself is currently unreachable in practice (its only caller, `askGeneralAssistant`, was fail-closed
  in the prior unit) — but it is not itself in this unit's named scope, and deleting
  `searchLegalCorpusTool.ts` would break its import regardless of whether it's currently reachable.

Forcing removal of the route/handler/tool would silently break two integration test suites and a
staging monitoring smoke test — real existing investment, not incidental collateral. **Stopped
here, as instructed, rather than forcing it.**

The underlying `legal_corpus_chunks` Prisma table/data path was not touched at all — no schema
change, no data deletion, no ingestion-script change. That is a data-layer concern entirely
separate from "is this reachable from the product UI," and was never implicated by the reachability
question this unit answers.

## Required proof

Live, real server/DB/auth (`scripts/db/legal-answer-legacy-path-deprecation-01.ts`):

| Required proof | Result |
|---|---|
| `canonical LegalSupportView → /api/legal/answer` | **PASS** — 200, `contract_version: legal-answer-serving-v1`, `mode: ANSWERED`, 6 claims |
| `MvpLibrarianView live importers` | **0** — file deleted; a naive re-grep for the name matched only this unit's own proof scripts' comments/patterns (false positive, verified by eye and excluded — the same grep-precision lesson from the prior unit, caught again) |
| `/api/legal/search live UI callers` | **0** |
| `legacy search handler reachable from product UI` | **NO** |
| `canonical retrieval unaffected` | **PASS** — 6 results, within the requested `top_k` |
| `canonical citations unaffected` | **PASS** — every citation independently re-verified against the live DB, real, provenance-intact |
| `all relevant tests` | **PASS** — 62 unit/component tests across every file touched in this and the prior unit, all still green; the two `/api/legal/search` integration suites and the staging smoke test are untouched and were not run against a truncating `globalSetup` here (consistent with this whole track's established script-not-integration-test pattern for DB-populated proofs) |

## What this does not claim

- Does not remove or deprecate `POST /api/legal/search`, `searchLegalCorpusHandler`,
  `searchLegalCorpusTool.ts`, or `VertexOrkester.ts` — reported as a real, open finding, not
  silently left unaddressed. If the owner still wants this route gone, the next step is an explicit
  decision on the two integration suites and the staging smoke test (migrate their coverage
  elsewhere, formally retire the reranker-quality monitoring initiative they serve, or keep the
  route alive specifically for that purpose going forward) — a product/ops decision, not an
  engineering one, and out of this narrowly-scoped unit.
- Does not touch `legal_corpus_chunks`, its schema, or any ingestion pipeline.
- Does not touch the canonical `/api/legal/answer` chain in any way.

## Closure

```
LEGAL-ANSWER-LEGACY-PATH-DEPRECATION-01
IMPLEMENTED / PROVEN (MvpLibrarianView.tsx removed; /api/legal/search stack reported, not forced)
```

Per the owner's ordering, next is `LEGAL-ANSWER-PRODUCT-PROVEN-ASSESSMENT-01` — the single-question
assessment of whether an authenticated user can get a legal answer through any live path other than
the canonical chain. That assessment needs to account for this unit's finding: `/api/legal/search`
technically still exists as a live, authenticated endpoint (not reachable from any product UI, but
reachable by a direct authenticated API call) — worth naming explicitly in that assessment rather
than assuming "UI-unreachable" and "does not exist" are the same claim.
