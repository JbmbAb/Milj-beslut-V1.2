# LEGAL-ANSWER-PRODUCT-WIRING-01 — PROVEN

**Status:** PROVEN. Closes `LEGAL-ANSWER-PRODUCT-CONVERGENCE-01`'s central `NOT_PROVEN` finding
(D1/D2): the canonical governed legal-answer chain now has a real, authenticated, end-to-end
product path — from a UI click through to rendered citations — proven by real execution, not
inferred from imports. `D3` (orphaned legacy `MvpLibrarianView`) and `D4` (`ChatBot.tsx` bypass)
are explicitly **not** addressed here — documented below as remaining findings for
`PRODUCT-RUNTIME-ANSWER-BYPASS-01`, per instruction not to broaden this unit.

## Scope discipline, confirmed

No change to retrieval algorithm, prompt, `topK` defaults, source routing, or any of the four
already-proven safety gates (specificity gate, named-source-consistency gate, multi-source
retrieval budget, citation contract). `ChatBot.tsx` and `MvpLibrarianView.tsx` were not touched.

## What was built

### Step 1 — canonical HTTP boundary

**`server/routes/legalAnswer.routes.ts`** (new) — `POST /api/legal/answer`. Mirrors
`legalRetrieval.routes.ts`'s exact auth/rate-limit/validation pattern (`requireAuth`,
`rateLimitByUser(20, 60_000)`, zod). Calls `composeLegalAnswer()` directly — imports nothing from
`legal.routes.ts`, `searchLegalCorpusTool`, or the `/api/gemini` router (verified both structurally,
by source inspection, and at runtime, proof P8 below). Response DTO (`legal-answer-serving-v1`)
passes every provenance/citation field straight through from each `CitationRef` — `citation_id`,
`fragment_id`, `materialization_id`, `source_provenance_refs`, `rank`, `score`,
`query_run_identity` — never reconstructed or reshaped. Also serializes `answer_trace`,
`query_specificity`, `named_source_consistency`, and a thin `retrieval.results_count` observability
field (not part of the citation contract — added specifically so P2/P3 below could prove which
retrieval path a real request actually took, not just that the code exists).

Wired into `server/createApp.ts` with a two-line diff, mirroring the existing `legalRetrievalRouter`
mount exactly.

### Step 2 — real Legal Support UI

**`components/legal/LegalSupportView.tsx`** (new) — the minimal usable view: query input, submit,
loading/error states, and per-mode rendering (`ANSWERED` claims+citations,
`INSUFFICIENT_EVIDENCE`/`QUERY_UNDERSPECIFIED`/`NAMED_SOURCE_NOT_AVAILABLE` banners with the real
reason text from the server). Talks only to the new endpoint via
**`src/ui/api-client/legalAnswer.client.ts`** (new), using `callApi()` from
`services/coreApiClient.ts` — the same authenticated client pattern already used for other real
product endpoints (`geo.client.ts`'s `fetchPropertyInfo`), not a new auth mechanism.

**`components/AppContentRouter.tsx`** — added the missing `if (normalizedTab === 'legal') return
<LegalSupportView />;` check, placed alongside the other mode-independent tabs
(`requirements`/`integrations`/`dossier`), matching how `AppSidebar.tsx`'s "Juridiskt Stöd" button
was already found to render outside any mode conditional. This is the exact, minimal fix for D2.

### Step 3 — runtime proof, not import inference

Two kinds of proof, matching what each hop actually requires:

**Real HTTP end-to-end** (`scripts/db/legal-answer-product-wiring-01.ts`) — real server
(`createApp()`), real dev DB, real admin login + CSRF flow, real Gemini calls:

| Proof | Result |
|---|---|
| P1 — authenticated legal UI request | **PASS** — 200, `contract_version: legal-answer-serving-v1`, `mode: ANSWERED`, 6 real claims |
| P2 — 0/1 recognized source path | **PASS** — court-family query, `retrieval.results_count: 6` (exactly the requested `top_k`, proving the single-query path, not the multi-source branch) |
| P3 — 2+ recognized source multisource path | **PASS** — `named_source_consistency.named_known_source_ids` has 2 entries AND `retrieval.results_count: 12` (exceeds the requested `top_k=6` — impossible under the single-query path; only the per-source multi-query branch can produce this) — **proves the already-proven multi-source retrieval budget is actually reached from a real HTTP request, not merely present in code** |
| P4 — named-source inconsistency | **PASS** — `fiskelagen` query → `mode: NAMED_SOURCE_NOT_AVAILABLE`, zero claims |
| P5 — `QUERY_UNDERSPECIFIED` | **PASS** — `"Vad gäller?"` → gated, `retrieval.results_count: null` (retrieval never ran) |
| P6 — citations survive API serialization | **PASS** — every citation in P1's response independently re-resolved against the live DB, all real, all provenance-intact |
| P8 — no legacy legal handler reached | **PASS** — P1's response carries `contract_version`; a live call to the legacy `/api/legal/search` in the same run returns 200 with **no** `contract_version` field at all — genuinely distinct, non-aliased implementations, confirmed at runtime, not just by absent imports |

**Component-level, real render + real user interaction** (not mocked away):

| Proof | File | Result |
|---|---|---|
| UI entry point reachability | `tests/unit/AppSidebarLegalWiring.test.tsx` | **PASS** — real `AppSidebar` rendered, real click fired on the "Juridiskt Stöd" button, asserts `setActiveTab('legal')` was actually called; also confirmed the button renders regardless of active mode |
| Content routing reachability | `tests/unit/AppContentRouter.test.tsx` | **PASS** — real `AppContentRouter` rendered with `activeTab='legal'` under two different modes, asserts `LegalSupportView` mounts both times |
| P7 — UI renders returned citations | `tests/unit/LegalSupportView.test.tsx` | **PASS** — real component rendered, real user input + submit simulated, a realistic mocked `ANSWERED` response asserted to produce visible `fragment_id`/`materialization_id`/`source_provenance_refs` in the DOM; a second test confirms the `NAMED_SOURCE_NOT_AVAILABLE` banner renders with zero claims when the gate blocks |

**39 unit tests total across all touched files, all passing.**

## Remaining findings — explicitly not fixed here

- **D3 (orphaned legacy path)** — `MvpLibrarianView.tsx` → `/api/legal/search` remains dead code,
  unreachable from the live app (confirmed again in this unit: nothing new imports it). Left as a
  documented finding for `PRODUCT-RUNTIME-ANSWER-BYPASS-01` to decide: delete or formally
  deprecate.
- **D4 (`ChatBot.tsx` bypass)** — still live on every page, still calls `/api/gemini` directly with
  zero retrieval, zero citations, zero safety gate. Confirmed untouched by this unit (no changes to
  `ChatBot.tsx` or its route). This remains the standing counter-example to "an authenticated
  product user cannot get an answer outside the safety gate" and is the explicit subject of
  `PRODUCT-RUNTIME-ANSWER-BYPASS-01`, the next unit per the owner's ordering.

## What this does not claim

- Does not claim `PRODUCT-PROVEN` for the legal-answer feature as a whole — that status is reserved
  for after `PRODUCT-RUNTIME-ANSWER-BYPASS-01` and the legacy-path cleanup/deprecation decision,
  per the owner's own stated ordering.
- No change to any retrieval, prompt, gate, or citation logic — this unit is product wiring only.
- The new UI is deliberately minimal (query/submit/claims/citations) — no history, no saved
  queries, no `family`/`allowed_source_constraints` selector exposed to the end user (the route
  accepts `family` but the UI does not yet surface it as a control).

## Next

Per the owner's frozen ordering:

```
LEGAL-ANSWER-PRODUCT-CONVERGENCE-01   NOT_PROVEN / TRACE COMPLETE        <- done
LEGAL-ANSWER-PRODUCT-WIRING-01        canonical vertical slice           <- this unit, done
PRODUCT-RUNTIME-ANSWER-BYPASS-01      ChatBot owner decision/enforcement <- next
legacy legal path cleanup/deprecation
PRODUCT-PROVEN candidate
```
