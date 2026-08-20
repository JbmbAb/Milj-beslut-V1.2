# LEGAL-RETRIEVAL-PRODUCTION-COMPOSITION-01 — PROVEN

**Status:** PROVEN. The first real, callable composed retrieval function in this track — every
prior unit was script-only proof. Wires the frozen pieces together exactly as specified:

```
query -> family routing -> LegalRetrievalPolicy -> law metadata router (family=law only)
  -> governed embedding search -> exact fragment/materialization resolution
  -> RetrievalExecutionTrace -> RetrievalResult -> provenance
```

No new retrieval strategy is invented. `law` uses the frozen production strategy
(`LEGAL-RETRIEVAL-LAW-MULTI-SOURCE-ROUTING-01`). `court`/`standard` stay on the plain
vector-only path, unchanged, per instruction.

## "Family routing" is an explicit hint, not a classifier

`request.family?: 'law' | 'court' | 'standard'` is a caller-supplied parameter, not inferred from
query text. No unit in this track has built or proven a query -> family classifier, and inventing
one now — silently guessing whether a query is "about law" or "about a court case" — would be
exactly the kind of fabrication this whole track has consistently refused to do elsewhere (the
router itself never guesses a statute; the composition layer does not start guessing a family
either). A caller with no family signal passes `family: undefined` and gets the same unconstrained
cross-family search every prior baseline run used by default.

## What was built

- **`server/modules/legal/retrieval/LegalRetrievalComposition.ts`** —
  `performLegalRetrieval(request, deps)`: the orchestration. `LegalRetrievalPolicy` gate first
  (read-only, unchanged). Routes through `routeLawQuery()` only when `family === 'law'`. Embeds
  the query once via the real pinned provider. Searches via an injected `SearchChunks` port.
  For each hit: resolves the exact governed chunk via an injected `ChunkRefLookup` port (keyed by
  the *compound* `(fragment_id, materialization_id)`, not fragment_id alone — avoiding the
  ambiguity bug found and fixed in `LEGAL-RETRIEVAL-LAW-METADATA-ROUTING-01`'s test helpers),
  binds the embedding identity, and calls `buildRetrievalResult()` — a hit that fails any
  governed check (unresolvable, or embedding identity mismatch) is **dropped, never returned**,
  never surfaced as a fabricated result. Builds one real `RetrievalExecutionTrace` per call:
  `query_hash` (real sha256 of the query text), `policy_version`, `selected_artifact_refs`
  (exactly the fragment_ids that survived the fail-closed checks — not the raw hit list),
  `expansion_path` carrying the routing decision (or the family/composition-version label when
  routing did not engage).
- **Dependency-injected** (`embeddingProvider`, `searchChunks`, `lookupChunkRef`) so the
  orchestration logic is unit-testable with fakes, real defaults are Prisma/Gemini-backed via
  `createLegalRetrievalComposition()`.
- **`tests/unit/server.modules.legal.retrieval.LegalRetrievalComposition.test.ts`** — 8 tests
  against fakes (no live API/DB cost): family=law engages the router and its decision reaches
  search; family=court/standard bypass it entirely (`routing: null`); no family -> unconstrained;
  a resolved hit produces a `RetrievalResultFields` with exact identity/provenance; an
  unresolvable hit is dropped; a hit with a mismatched content hash (stale/tampered) is dropped;
  the trace's `selected_artifact_refs` reflects only the *surviving* results, not the raw search
  output.
- **`scripts/db/legal-retrieval-production-composition-01.ts`** — the real end-to-end proof
  against the live corpus and the real Gemini provider, one case per family plus the
  no-family-specified case.

## Real end-to-end proof (live corpus, live provider)

| Case | Routing | Results |
|---|---|---|
| law, multi-statute query | 2 candidates admitted (Miljöprövningsförordningen + Miljöbalken, both unrestricted) | 5/5 resolved |
| law, single statute + chapter | 1 candidate, `ch.7` bound | 5/5 resolved |
| court | `routing: null` (bypassed, `expansion_path` records `family=court`) | 5/5 resolved, including **both** real materializations of the known Part G duplicate decision (M 307-24) — correctly and unambiguously resolved via the compound key, no collision |
| standard | `routing: null` | 5/5 resolved |
| no family specified | `routing: null`, cross-family search | 5/5 resolved |

Every result across all 5 cases carries `resolved_against_governed_chunk: true` by construction —
a result only ever appears in the output after surviving `buildRetrievalResult`'s checks, so
"printed" and "provenance-intact" are the same guarantee, not two things to separately verify.

## What this does not claim

- No text-based family classifier — an explicit caller hint only, as described above.
- No HTTP/API route or UI wiring — this is the composed *function*, not a served endpoint. A
  route/controller layer calling `performLegalRetrieval()` would be a separate, later unit.
- `court`/`standard` retrieval strategy is unchanged — this unit only wires the existing
  vector-only path through the same composed function, it does not modify their behavior.
- Does not revisit `H20`/`H22` or any other known limitation already documented in
  `LEGAL-RETRIEVAL-LAW-MULTI-SOURCE-ROUTING-01-PROVEN.md` — those stand as frozen, accepted
  trade-offs.

## Next

Not decided here — candidates include an actual HTTP-served endpoint calling this function,
broader `court`/`standard` strategy evaluation once evidence motivates it, or expanding the
golden-query coverage further before either.
