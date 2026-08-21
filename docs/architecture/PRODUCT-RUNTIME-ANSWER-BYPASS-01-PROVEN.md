# PRODUCT-RUNTIME-ANSWER-BYPASS-01 — IMPLEMENTED / PROVEN

**Status:** IMPLEMENTED / PROVEN. Owner policy enforced: no reachable freeform natural-language
surface may produce a legal/factual answer outside the governed answer boundary. No legal-intent
classifier was introduced. `composeLegalAnswer()`, retrieval, the multi-source budget, prompts,
citations, and the safety gates were not touched.

## Owner policy, as frozen

```
NO REACHABLE FREEFORM USER SURFACE MAY PRODUCE A LEGAL/FACTUAL ANSWER
OUTSIDE AN EXPLICIT GOVERNED ANSWER BOUNDARY.
```

## What was changed

### 1. Global `ChatBot.tsx` — converted to a non-generative launcher

Previously: a freeform chat calling `POST /api/gemini {method:'askGeneralAssistant'}`, branded
"Legal AI Assistant" with UI text falsely claiming it "only answers from verified sources." Now:
zero conversation state, zero network calls, one button that navigates to the real `Juridiskt
Stöd` view (`onOpenLegalSupport` prop, wired from `AppShell.tsx` to `setActiveTab('legal')`).

### 2. `DetailModal.tsx` / `chatWithPermit` — freeform chat removed

The "Utredningsstöd (AI-Chatt)" section (`chatWithPermit`, permit-scoped but user-message
unconstrained) is replaced with a fixed CTA: *"Ställ juridisk fråga i Juridiskt Stöd"*, wired to
the same `onOpenLegalSupport` navigation. `analyzePermitRisk` (the separate, structured "AI
Riskbedömning" feature) is untouched — it was never a freeform Q&A surface.

### 3. Backend fail-closed for `askGeneralAssistant` and `chatWithPermit`

`server/geminiApi.express.ts`'s `POST /api/gemini` switch now returns `410` for both methods
without ever calling their underlying service functions — closing the surface even for a manual
or direct API call, not just hiding the UI. `services/geminiService.ts`'s `askGeneralAssistant()`
and `chatWithPermit()` were themselves gutted to always fail closed (`unavailable(...)`, which
throws) — no path in either function still reaches `VertexOrkester` (whose only tool is the
**legacy** search, never the canonical chain) or the bare, ungrounded `serverGenerateFromParts`
fallback, for any input, from any caller, not only the HTTP route.

**A real, live-caller finding not anticipated by the original brief**: `askGeneralAssistant()` had
a third live caller — `SewageMapView.tsx`'s siting-assessment feature, using a fixed,
app-constructed prompt template (never raw user text). Blanket fail-closing would have silently
broken that unrelated, legitimate, non-legal feature. Rather than either regress it or leave a
residual bypass surface open for its sake, its call was migrated to a new, narrowly-named function,
`generateSewageSitingAssessment()` — the same underlying mechanism, un-shared from the
freeform-chat-capable name. This is not a classifier: it is giving an already-distinct call site
(fixed template, no user text) its own name, exactly the same pattern already used for
`chatWithPermit` vs. `askGeneralAssistant` being separate named methods before this unit even
started.

### 4. Anonymous loopback carve-out — removed

`server/geminiApi.express.ts` no longer has the `isAnonymousLocalChatCall` exemption that skipped
`requireAuth` for a loopback-origin, unauthenticated `POST /api/gemini` request with
`method:'askGeneralAssistant'`. The unrelated Figma carve-out (`/api/figma/ai`) is untouched — out
of scope, not an answer-producing endpoint.

## Required runtime proof — real server, real DB, real auth, post-implementation

`scripts/db/product-runtime-answer-bypass-01.ts`:

| Required proof | Result |
|---|---|
| `LegalSupportView → /api/legal/answer → canonical governed chain` | **PASS** — 200, `contract_version: legal-answer-serving-v1`, `mode: ANSWERED` (regression check: canonical chain unaffected) |
| `global ChatBot freeform answer` | **UNREACHABLE** — proven at the component level (`tests/components/chatBot.test.tsx`): real render, real click, asserts `fetch` is never called and no chat panel/textarea exists |
| `DetailModal permit freeform answer` | **UNREACHABLE** — proven at the component level (`tests/components/detailModal.test.tsx`): real render, asserts no freeform chat input exists, and the CTA calls `onOpenLegalSupport` instead |
| `/api/gemini askGeneralAssistant bare/fallback answer` | **FAIL CLOSED** — live `410`, authenticated, real server: `"askGeneralAssistant är permanent inaktiverad..."` |
| `/api/gemini chatWithPermit freeform answer` | **FAIL CLOSED** — live `410`, authenticated, real server: `"chatWithPermit är permanent inaktiverad..."` |
| `unauthenticated loopback carve-out` | **ABSENT** — live `401` (`"Missing bearer token"`) for a loopback-origin request with a *valid* CSRF token but no `Authorization` header — isolates the auth question specifically from CSRF, confirms `requireAuth` now actually runs where the old carve-out used to skip it |
| `legacy /api/legal/search UI caller` | **1 file, 0 live** — fresh grep for the actual call shape (`'/api/legal/search'` as a quoted argument, not prose) found exactly `components/mvp/MvpLibrarianView.tsx`; independently confirmed (again, post-implementation) to have zero importers anywhere in the codebase |

**A grep-precision lesson surfaced during this unit's own proof-script development**: an initial,
naive substring grep for `/api/legal/search` also matched this doc's and `LegalSupportView.tsx`'s
own comments *mentioning* the legacy route (e.g. "never calls /api/legal/search") as false
positives. Fixed by grepping for the quoted call-argument shape instead and manually confirming the
one real hit is an actual `callApi(...)` invocation, not prose — exactly the "don't infer from grep
alone" discipline this whole unit was built around, caught in its own tooling.

**Regression check**: full unit + component test suites for every touched file — 62 tests, all
passing. A full-repo `tsc --noEmit` diff before/after this unit's changes shows **zero new type
errors** anywhere in the repository (the pre-existing, unrelated 166 errors from other in-flight
work are unchanged).

## What this does not claim

- Does not build a replacement general-purpose chatbot — explicitly out of scope, per instruction.
- Does not address `MvpLibrarianView.tsx`/`/api/legal/search` cleanup or deprecation — still dead
  code, still architecture debt, still not this unit's job (it was already unreachable before this
  unit and remains so).
- `generateSewageSitingAssessment()` is a new, narrow function, not a proven capability in the
  sense this track uses that word — it carries the exact same non-governed, non-cited behavior its
  predecessor always had for this one call site; it was never a legal-answer surface and isn't
  claimed to be one now.
- No general (non-legal) AI assistant capability exists in the product anymore. If one is wanted
  again, it is `GENERAL-ASSISTANT-GOVERNED-BOUNDARY` or an equivalent, separately proven capability
  — not a silent restoration of `ChatBot.tsx`'s old behavior.

## Closure

```
PRODUCT-RUNTIME-ANSWER-BYPASS-01
IMPLEMENTED / PROVEN
```

Per the owner's ordering, the product now has exactly one proven legal/factual answer path:
`Juridiskt Stöd → /api/legal/answer → composeLegalAnswer()`. Next per the frozen roadmap: legacy
`/api/legal/search`/`MvpLibrarianView.tsx` cleanup or formal deprecation, then a
`PRODUCT-PROVEN` candidate assessment. Not started here.
