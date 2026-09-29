# LU-W3B-BANK-GEMINI-DOSSIER-CLEANUP-V1 -- C1/C2/D4/D5 RED-only candidate

**Status:** CANDIDATE -- RED probes only, zero production code. For cold review of test design
before any implementation begins, per the K-28 ordering used for W2's/W3c's own first candidates.
Learning from W3a's own disclosed process deviation (its RED probes and implementation were
written together, without an intermediate RED-only candidate) -- this unit does not repeat it.
**Unit:** `governance/devgov/units/lu-w3b-bank-gemini-dossier-cleanup-v1.json`
**Base:** `729a6bd6816e184f013b57677c3ed8594d0eefe3` (W3a merged).
**Design authority:** OD-04 (ADR-28A), K-89's W3 sequencing ("W3b bank/Gemini + D5"), and two
already-frozen dispositions in `MAP-2-SEMANTICS.md`'s Delta 2026-09-28 (independently re-read from
source, not taken from a relay): "Bank-endpointen ska avvecklas; den ska inte göras till governed
beslutsmotor" and "Dossier-trion ska raderas i beslutad W3-unit, inte semantiskt rehabiliteras."
Full scope note, including every fact below re-verified against current main rather than the
12-day-old design document, and four open questions with proposed defaults, all confirmed by cold
review: `Claude outputs/w3b-design-2026-09-29/W3B-SCOPE-NOTE-2026-09-29.md`.

## 0. Scope decisions confirmed by cold review (not reopened here)

- **Q-W3b-1:** D4 (the dossier trio) is folded into this unit alongside C1/C2/D5, despite K-89's
  sequencing line naming only "bank/Gemini + D5" -- same code neighbourhood, no other W3 unit
  plausibly covers it, and the Delta's own deletion decision for D4 needs a unit to land in.
- **Q-W3b-2:** `components/TechnicalSluExpert.tsx` (confirmed test-only, unmounted) is left
  untouched -- matches the no-drive-by-cleanup norm from W3a's own B1 decision.
- **Q-W3b-3:** resolved directly -- `services/dossier/` and `services/orchestrator/` each contain
  exactly the one named trio file, no other file supports them, and the near-identically-named but
  entirely unrelated, live `server/services/vertexDirigent.ts` (no trailing "Service") is
  confirmed untouched by this unit.
- **Q-W3b-4:** C1's retirement deletes the route file (`bankCompliance.routes.ts`, single-purpose)
  and unmounts it from `createApp.ts`; the underlying `bankComplianceService.ts` and its own test
  are left in place as unreferenced, forward-only dead code -- mirrors the `exportLocalizationPdf()`
  precedent from W3a exactly.

## 1. RED probes (this candidate's only content)

Four test files/changes, each proving one target still misbehaves on live/current main:

- **`tests/unit/bankComplianceRouteRetired.test.ts`** (new, 3 tests) -- C1. Asserts the route file
  doesn't exist, `createApp.ts`'s source no longer mentions `bankComplianceRouter`, and the
  underlying service file is still present (a forward-looking assertion that already passes today,
  kept as an explicit statement of intent alongside the two that currently fail).
- **`tests/unit/geminiApiAnalyzeBiodiversityUnavailable.test.ts`** (new, 2 tests) -- C2. Builds a
  minimal Express app mounting only `geminiApi.express`'s router, mocks the four upstream fetch
  functions (SLU/NVR/SGU/RAÄ) and `analyzeBiodiversityWithCompliance` itself (this unit's own
  change is scoped to the caller's try/catch splitting, not that function's internals), and asserts
  a new `unavailableSources: string[]` field on the response: `['slu-observations-unavailable']`
  when the SLU fetch throws, `[]` when all four succeed.
- **`tests/unit/dossierTrioRetired.test.ts`** (new, 4 tests) -- D4. The established
  "absence-as-proof-of-retirement" pattern for the three named files, plus one explicit
  regression-guard assertion that the unrelated `server/services/vertexDirigent.ts` is **not**
  deleted (the near-miss caught during scoping, made permanent as a test rather than just a note).
- **`tests/unit/services/geminiService.test.ts`** (modified, +1 test) -- D5. Reuses the file's own
  existing Vertex-mock harness (`mockGenerateContent`) to supply a non-empty AI response containing
  neither `'Hög'` nor `'Medel'`, and asserts `predictWeatherRisk()` now throws
  (`/verifierad AI-källa/`, the exact message the file's own `unavailable()` helper already
  produces for four other stubbed AI features) instead of silently returning `{level: 'Låg', ...}`.

**A debugging note, not a design issue:** the C2 test initially failed with an unrelated HTTP 401
(a real Postgres connection attempt inside `requireAuth`'s token-revocation check, unmocked) before
the actual RED assertion could even run. Fixed by adding the same
`vi.mock('../../server/repositories/tokenRepository', ...)` mock `localizationRoutes.test.ts`
already established in W3a -- confirmed this was purely a test-harness gap, not a signal about the
production code path itself.

## 2. Verified RED

All 4 probes run via their exact embedded command, against a freshly isolated worktree
(`C:\wt-w3b-base`, pinned to `729a6bd6`, `node_modules` junctioned from `C:\wt-w3b`'s own tree since
`package.json`/`package-lock.json` are unchanged by this candidate):
- `w3b-bank-compliance-route-retired`: exit 1 (2 of 3 assertions fail: route file still exists,
  `createApp.ts` still mentions `bankComplianceRouter`).
- `w3b-gemini-analyze-biodiversity-unavailable`: exit 1 (`unavailableSources` is `undefined` in both
  cases -- the field doesn't exist yet).
- `w3b-dossier-trio-retired`: exit 1 (3 of 4 assertions fail: all three trio files still exist).
- `w3b-predict-weather-risk-throws`: exit 1 (the promise resolves with `{level: 'Låg', ...}` instead
  of rejecting).

Full combined run of all 4 files together in the implementation worktree (not the isolated base,
where the same numbers were independently reconfirmed): 8 failed, 10 passed (18 total) -- the 10
passing are the pre-existing, untouched tests in `geminiService.test.ts` plus the one
forward-looking, already-true assertion in the bank-compliance and dossier probes each. No
unexpected failures anywhere outside the four targeted areas.

## 3. Non-claims -- what this candidate does not do

No production code. No GREEN proof has been run or can meaningfully be run yet -- the fixes
described in the scope note (§2) are proposed, not implemented. This candidate exists solely to let
the RED probes themselves be reviewed for design soundness (do they prove the right thing, precisely
worded, no false negatives) before any implementation is written, matching the K-28/K-53 ordering.
Does not touch W3d (`predictiveScoringService.ts`, D3) or the `.cursor/rules/import-focus-product.mdc`
stale-doc issue -- both remain out of scope, as documented in the scope note's own §4.
