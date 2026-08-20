# LEGAL-RETRIEVAL-SERVING-BOUNDARY-01 — PROVEN

**Status:** PROVEN. The first real HTTP endpoint over the governed retrieval chain:
`POST /api/legal/retrieval/search`. Deliberately thin — validates input, authorizes, calls
`performLegalRetrieval()`, serializes a versioned DTO. No retrieval logic lives in the route; it
never duplicates or bypasses what `performLegalRetrieval` already does.

**Not** the legacy `/api/legal/search` route (`searchLegalCorpusTool`, the old `legal_corpus_chunks`
table — see `LEGAL-RETRIEVAL-ARCH-RECON-01`). This is a new, separate path over the governed
corpus; the legacy route is untouched.

## Scope, exactly as specified

**Input:** authenticated caller (`requireAuth`, real bearer-token flow), `query`, optional
`family` (`'law' | 'court' | 'standard'`), optional `top_k`, optional
`allowed_source_constraints` (ADMIN-only). **Output:** results with exact `fragment_id`,
`materialization_id`, `source_provenance_refs`, `score`/`rank`, plus `trace`/`query_run_identity`.
**Explicitly not built:** freeform LLM answer generation, citation synthesis, query rewriting, a
reranker, hybrid BM25, or a hidden family classifier.

`family` remains frozen as an explicit caller hint, never inferred:

```
family omitted -> broad legal retrieval, unconstrained
family = law    -> law production strategy engaged (LEGAL-RETRIEVAL-LAW-MULTI-SOURCE-ROUTING-01)
family = court  -> court vector path, unchanged
family = standard -> standard vector path, unchanged
```

## Caller-authorized source constraints — a deliberately conservative default

`allowed_source_constraints` is gated to `ADMIN` role via a direct role check
(`req.authUser!.role !== 'ADMIN'` -> 403), **not** a new entry in the shared `rolePermissions` map
in `server/security/projectAccess.ts`. That map is a shared, security-sensitive surface other
routes also depend on; deciding which of `ADMIN`/`CONSULTANT`/`AUDITOR`/`BANK` should get this
specific new capability is a broader authorization-model decision out of this narrow unit's scope.
When provided, the override **replaces** the automatic law router's decision entirely (never
merged with it) — proven both at the unit level (fake deps) and against the real server (Proof 7).
Providing it for a non-`law` family is rejected outright (`LegalRetrievalRequestError`, HTTP 400),
never silently ignored — `court`/`standard` have no equivalent constraint mechanism to override.

## What was built

- **`server/routes/legalRetrieval.routes.ts`** — the route. `requireAuth` +
  `rateLimitByUser(30, 60_000)`, matching every other authenticated route in this codebase
  exactly. Zod schema validates the body (`query`, `family` enum, `top_k` bounds,
  `allowed_source_constraints` array). Calls
  `performLegalRetrieval({...}, createLegalRetrievalComposition())` and serializes
  `RetrievalResultFields`/`RetrievalExecutionTraceArtifact` directly — provenance identifiers are
  never re-derived or reshaped, only passed through.
- **`server/modules/legal/retrieval/LegalRetrievalComposition.ts`** extended with
  `sourceConstraintOverride` on `LegalRetrievalRequest` and `LegalRetrievalRequestError` for the
  family-mismatch rejection — the only change to the composed function itself in this unit.
- **`server/createApp.ts`** — one import + one `app.use()` line, mirroring the existing
  `legalRouter` mount exactly.
- **2 new unit tests** (fake deps, no live cost) added to the existing composition test file:
  override replaces automatic routing; override for a non-law family throws.

## Real end-to-end HTTP proof — all 8 required proofs, against the real server and real corpus

Deliberately run as a standalone script (`scripts/db/legal-retrieval-serving-boundary-01.ts`),
**not** a `tests/integration/*.test.ts` file: that project's `globalSetup`
(`tests/setup/database.ts`) truncates every Prisma-managed table in its target database before
each run. The 31,706 embedded governed chunks only exist in the real dev database — a formal
integration test would either wipe them (if pointed at dev) or prove nothing meaningful (if
pointed at an empty disposable test DB). A script driving the real `createApp()` via `supertest`
against the real, already-populated dev DB — using the real admin login flow
(`loginAsAdmin`/`authRequest`, the same helper `tests/integration/*.test.ts` already uses) and the
real double-submit-cookie CSRF flow (`GET /api/csrf-token` then echoing the token on every
mutating request) — is the correct proof vehicle here, consistent with every other real proof in
this track.

| Proof | Result |
|---|---|
| 1. Valid authenticated request -> governed results | PROVEN — 200, 5 real results, each with intact identity |
| 2. Invalid `family` -> reject | PROVEN — 400, zod's own enum validation message |
| 3. Missing/invalid auth -> 401, never reaches retrieval | PROVEN — both no-header and garbage-token cases |
| 4. Unresolvable/tampered hit never leaves the boundary | PROVEN — every returned result independently re-verified against the live DB to resolve to a real governed chunk row |
| 5. Trace corresponds exactly to the returned result set | PROVEN — response `query_run_identity` matches `trace.query_hash` exactly, not a separately-computed value that could drift |
| 6. HTTP response cannot omit provenance identifiers | PROVEN — every result carries `fragment_id`/`materialization_id`/`source_provenance_refs`/`score`/`rank` |
| 7. Caller-authorized source override replaces automatic routing | PROVEN — a query that would auto-route to Miljöbalken alone instead searched only the explicitly-overridden PBL source |
| 8. Same request + same corpus/model/policy state -> same governed retrieval semantics | PROVEN — two live calls to the identical request returned identical fragment order, identical routing decision, identical `query_run_identity` |

## What this does not claim

- No RAG answer/citation composition — explicitly the next, separately-scoped unit.
- No further `court`/`standard` retrieval-strategy work — unchanged per instruction, since
  quality-baseline evidence already shows them stronger than `law` was before its own fix.
- `allowed_source_constraints`'s ADMIN-only gate is a conservative default, not a designed
  permission model — a real multi-role authorization scheme for this capability, if ever needed,
  is a separate decision.
- No new vitest integration-test coverage was added for this route (see the DB-truncation
  rationale above) — the real script is the proof; a future decision could still add a properly
  isolated integration test against a disposable, pre-seeded test DB if that becomes worth the
  investment.

## Next

`LEGAL-RETRIEVAL-RAG-ANSWER-COMPOSITION-01` — a separate phase per instruction: retrieval ->
selected governed fragments -> answer model -> claims/citations, where the model must never cite
anything not actually present in a `RetrievalResult`. Not started here.
