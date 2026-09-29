# LU-W3B-BANK-GEMINI-DOSSIER-CLEANUP-V1 -- C1/C2/D4/D5

**Status:** CANDIDATE (implementation complete). RED probes were cold-reviewed on their own first
(§1), confirmed sound and cleared for implementation, before any production code was written --
per the K-28 ordering used for W2's/W3c's own first candidates. Learning from W3a's own disclosed
process deviation (its RED probes and implementation were written together, without an intermediate
RED-only candidate) -- this unit does not repeat it.
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

## 2. What changed (implementation, after the RED-only candidate was cleared for it)

- **C1:** `server/routes/bankCompliance.routes.ts` deleted outright (single-purpose file). Its
  import and `app.use(bankComplianceRouter)` mount removed from `server/createApp.ts`, replaced
  with a comment explaining the retirement and citing the Delta decision. The underlying
  `server/services/bankComplianceService.ts` and its own test (`tests/unit/bankComplianceService.test.ts`)
  are untouched, left as unreferenced, forward-only dead code.
- **C2:** `server/geminiApi.express.ts`'s `analyzeBiodiversity` case now wraps each of the four
  upstream fetches (SLU, NVR, SGU, RAÄ) in its own try/catch instead of one shared one, pushing a
  distinct kebab-case identifier (`slu-observations-unavailable`, `nvr-protected-areas-unavailable`,
  `sgu-geological-data-unavailable`, `raa-monuments-unavailable` -- kept symmetric across all four,
  per the reviewer's own note) into a new `unavailableSources: string[]` array on failure. The array
  is spliced onto the result object at the call site (`result = { ...(await
  analyzeBiodiversityWithCompliance(...)), unavailableSources }`); `analyzeBiodiversityWithCompliance()`
  itself and `BiodiversityAnalysisResult`'s type are both untouched, since that function has no way
  to know *why* an input was empty -- only the caller does.
- **D4:** `services/dossier/dossierBuilderService.ts`, `services/orchestrator/vertexDirigentService.ts`,
  and `components/DossierDashboard.tsx` deleted outright. `server/services/vertexDirigent.ts` (the
  unrelated, live file) is untouched, confirmed both by the deletion itself and by the dedicated
  regression-guard test added in the RED-only candidate.
- **D5:** `services/geminiService.ts`'s `predictWeatherRisk()` now calls `unavailable('Väderrisk')`
  (throws) when `serverResult` is non-empty but contains neither `'Hög'` nor `'Medel'`, instead of
  silently defaulting to `{level: 'Låg', ...}`. Reuses the file's own existing convention rather than
  extending the `WeatherRisk.level` union.

## 3. Verified evidence

**RED**, re-confirmed against a fresh, separate worktree pinned to `729a6bd6`
(`C:\wt-w3b-base2`, junctioned `node_modules`, K-29 pattern) after cold review cleared the RED-only
candidate for implementation: all 4 probes still exit 1 on that base, unchanged from §1's own
figures (no drift between the reviewed RED-only candidate and this implementation's own base).

**GREEN**, run via the exact embedded command against this candidate (real committed-shape test
files): all 4 exit 0 -- `bankComplianceRouteRetired.test.ts`: 3/3; `geminiApiAnalyzeBiodiversityUnavailable.test.ts`:
2/2; `dossierTrioRetired.test.ts`: 4/4, including the vertexDirigent.ts-not-deleted guard;
`geminiService.test.ts`: 9/9, the 8 pre-existing plus the new D5 test (18/18 total). Includes the
K-118-style byte-identity self-check (each GREEN proof's embedded `TEST_SOURCE` byte-matches the
actually committed file it names), built in from the start for this unit -- verified the check
itself fires by deliberately appending a comment to `dossierTrioRetired.test.ts`, confirming the
GREEN proof then failed with exit 2 and the expected `W3B_HARNESS_ERROR ... does not byte-match ...`
message, then restoring the file and reconfirming exit 0 (4/4). Adjacent, untouched files re-run for
regression: `bankComplianceService.test.ts` (9/9), `geminiBiodiversityService.test.ts` (3/3),
`vertexDirigent.test.ts` (1/1) -- all still pass unmodified.

**Broken-import check:** repo-wide grep for `dossierBuilderService`, `orchestrator/vertexDirigentService`,
`DossierDashboard`, `bankComplianceRouter`, and `routes/bankCompliance` after the deletions returns
matches only in this unit's own two retirement-proof test files (string literals for `existsSync`
checks and explanatory comments) -- no live imports remain anywhere.

**Typecheck:** `tsconfig.json`'s own `exclude` list covers `server/**` and `tests/**` outright, so
two checks were needed. Root `tsc --noEmit` (covers `services/geminiService.ts`, which is *not*
excluded): **87 errors on both base and candidate**, and the two error sets are byte-identical
(`diff` of the sorted error lists, not just a count match) -- confirms `geminiService.ts`'s own D5
change introduces zero new errors. Scoped, explicit-file-list `tsc` (same `compilerOptions` as
`tsconfig.json`, covering `server/createApp.ts` and `server/geminiApi.express.ts`): **83 errors on
both sides**; the one line-number difference between the two sorted lists
(`geminiApi.express.ts(181,24)` at base vs `(202,24)` at candidate, both
`Cannot find name 'askGeneralAssistant'`) is the exact same pre-existing, unrelated bug merely
shifted down by the ~21 lines this unit's own try/catch-splitting inserted above it -- not a new
error.

## 4. Non-claims -- what this unit does not do

Does not claim to fix every fail-open pattern the W3 design round found -- W3d
(`predictiveScoringService.ts`, D3) remains a separate, later unit. Does not touch
`.cursor/rules/import-focus-product.mdc` (still unaddressed, out of scope for any W-unit so far).
Does not change `analyzeBiodiversityWithCompliance()`'s own signature, `BiodiversityAnalysisResult`'s
type, or `complianceRuleEngine.ts` -- C2's fix is scoped entirely to the caller. Does not touch
`components/TechnicalSluExpert.tsx` (confirmed test-only/unmounted, left as-is per Q-W3b-2). Does
not claim the root `tsc`/scoped `tsc` figures say anything about the project's overall type health
-- both are narrow, file-scoped comparisons against this unit's own touched files, matching the S2
precedent from W3c/W3a.

## 5. Final disposition

RED-only candidate cold-reviewed and cleared for implementation before any production code was
written. Implementation complete: all 4 RED probes still fail on a fresh base, all 4 now pass on
this candidate (18/18), zero regressions in adjacent tests, zero broken imports, typecheck clean
(identical error sets on both sides, the one apparent difference confirmed as a pre-existing bug at
a shifted line number). Awaiting cold review of the implementation itself before freezing the exact
SHA, then the established chain: cold verification -> owner push-go -> PR (branch
`w3b-bank-gemini-dossier-cleanup`, the unit's own `remote.branch`) -> dispatch (owner only) ->
attestation -> merge.
