# LU-W3A-LEGACY-ENGINE-LABELLING-V1 -- SEM-2/SEM-3 legacy-engine labelling, permit-probability hiding, LocalizationStudyUI retirement

**Status:** CANDIDATE (not yet frozen, not yet dispatched, not pushed)
**Unit:** `governance/devgov/units/lu-w3a-legacy-engine-labelling-v1.json`
**Base:** `b48ed5e262793b0bf8086dad18a0729e399f84b9` (bumped from `f14e832e` per this revision's own §0a -- main advanced twice more,
PR #194 docs-only and PR #195/K1a governed-harvest work, neither touching any file this unit reads
or writes; confirmed via `git diff f14e832e b48ed5e2 --stat`, seven files, all under
`docs/architecture/`, `governance/devgov/units/`, `packages/mps-data-governance/`,
`scripts/import/harvest/`, `tests/unit/import/`, plus a one-line unrelated `package.json` script
rename -- no dependency change, confirmed via `git diff f14e832e b48ed5e2 -- package-lock.json`,
empty)
**Design authority:** the W3 design round (`W3-DESIGN-DECISION-2026-09-28.md`) named the
legacy-engine labelling problem (Group A/B) as W3a, sequenced after W3c per K-89. Jimmy authorized
starting W3a directly ("ja, sätt igång med W3a") after W3c merged (PR #192) and its PROVEN-record
was cold-verified (K-142, not yet pushed). The scope note
(`Claude outputs/w3a-design-2026-09-29/W3A-SCOPE-NOTE-2026-09-29.md`, written in this worktree since
the shared `Claude outputs/` path is blocked by worktree isolation) was cold-reviewed as K-146,
which recommended sharpening A1/B1/C1; A1 and B1 were accepted via `AskUserQuestion`, and C1's
wording was superseded entirely by Jimmy's own final text (quoted in §2 below), not the reviewer's
suggested sharpening.

## 0. Process deviation, disclosed up front

Unlike every prior W-unit's first candidate (W2's `1fbb5112`, W2b's `35085239`, W3c's `efac943c` --
all RED-probes-only, zero production code, shown to the verifier before any implementation), this
candidate's RED probes and production code were written in the same working session, without an
intermediate RED-only candidate sent for cold review first. This is a genuine deviation from the
K-28 ordering used for every prior unit's first candidate, not something to present as identical to
precedent. K-131 classifies every W-unit as fully semantic ("alla W-units är semantiska (full
ceremoni, RED-först, kall falsifiering)"), which this candidate does not fully satisfy on ordering,
even though every individual RED probe was independently confirmed failing against a freshly
isolated `f14e832e` worktree before its corresponding GREEN proof was written or run. Flagged here
for the cold reviewer and for Jimmy, not glossed over.

## 0a. Corrections made in this revision, per K-161

- **K-161 (confirmed, doc-precision only, no code/test change):** §4's GREEN evidence originally
  claimed `generateLocalizationReportLegacyObservationLabel.test.ts` had 6 tests (both in §3's test
  list and in §4's own per-file breakdown), and separately claimed "60/60 passed (7/7 files)" for a
  combined run without ever naming which 7 files or reconciling that number against the per-file
  counts listed just above it (which summed to 53 even with the wrong 6, not 60). Independently
  re-verified by directly re-running the file in isolation: it has **5** tests, not 6 -- `5 + 19 = 24`
  is exactly the "(24/24 combined with the PDF service test file)" figure already in the document,
  which was itself correct throughout. Corrected the mislabeled 6 -> 5 in both §3 and §4, and
  replaced the unreconciled "60/60 across 7 files" line with two separate, named, independently
  re-run lines: **52/52** across the 5 real `allowed_paths` test files (`5 + 19 + 20 + 6 + 2 = 52`,
  now reconstructable from the numbers immediately above it), and, kept separate because it is not
  part of this unit's own proof, **8/8** across the two named B1 comment-only-reference files
  (`mapLayerCatalog.test.ts`, `mimerProductShell.test.tsx`) as an explicit regression check --
  `52 + 8 = 60`, which is where the original unqualified figure came from.
- **Base bump to `b48ed5e2`:** main advanced twice more during this review round (PR #194, #195);
  see the header above for the no-overlap confirmation. All 5 RED probes re-verified failing against
  a freshly isolated `b48ed5e2` worktree (same technique as the original `f14e832e` verification,
  `node_modules` re-junctioned since dependencies are still unchanged); all 5 GREEN probes
  re-verified passing against the merged candidate (`git merge origin/main --no-edit`, clean, no
  conflicts). No code or test content changed in this revision beyond the merge itself and the
  doc-precision fix above.

## 1. Scope (OD-17)

Per the W3 design round and K-89's sequencing, this unit covers exactly:
- **SEM-2/SEM-3 (ADR-28A) labelling** -- Q2's structured field + visible label for sites whose
  `restrictions`/`rules` came from the legacy compliance-rule engine, so a caseworker never reads
  them as part of the governed verdict.
- **J-2** -- hide the raw `permitProbability` percentage in `LuWorkspace.tsx` entirely; W3d decides
  any future calibration requirement.
- **Q3** -- retire `components/LocalizationStudyUI.tsx` and the `export-pdf` route together, since
  the component was the route's only caller and neither is the product path.
- **J-7/J-12** -- lock the human-in-the-loop disclaimer text (Jimmy's own final wording, §2).

It does **not** touch:
- D3/D4/D5, OD-04's bank/Gemini targets, or any other W3b/W3c/W3d/W3e-territory file.
- `server/services/complianceRuleEngine.ts` (`SiteAnalysis`, the legacy engine's own type) --
  left untouched; see §2's type-boundary note for why.
- The separate, pre-existing "Human in the Loop" disclaimer text already inside
  `localizationPdfService.ts`'s own `disclaimer` field (different wording from
  `HUMAN_IN_THE_LOOP`) -- noticed during this unit's work, not unified or touched here.
- The four newly-verified product blockers K-131 catalogued on main (municipality-fallback,
  `NullDocumentProvider`, `LuWorkspace.tsx` never sending `documentEvidenceRefs`) -- candidate
  scope for a future unit, not this one.
- `exportLocalizationPdf()` itself (the orchestrator function the retired route called) -- left in
  place as unreferenced, forward-only dead code; only the route registration that made it reachable
  is removed, per the established no-drive-by-cleanup norm.
- The two comment/test-name-only references to `LocalizationStudyUI` in
  `tests/unit/mapLayerCatalog.test.ts` and `tests/components/mimerProductShell.test.tsx` (B1) --
  left as-is, confirmed to be comments/test names, not live imports.

## 2. What changed

### A1 -- container-level legacy-observation tag

`src/application/generate-localization-report.usecase.ts` gains `legacyObservationTag()`, a pure
function of `Pick<SiteAnalysis, 'restrictions' | 'rules'>` that returns
`{ legacyObservation: { source: 'legacy_observation', version: 'v1' } }` when either array is
non-empty, `{}` otherwise. A single container-level tag, not a per-entry one: every
`restrictions`/`rules` entry in this codebase comes from exactly one call
(`evaluateComplianceRules()`), so tagging the pair once is factually equivalent to tagging each
entry, without forcing a breaking type change onto `restrictions: string[]` (bare strings cannot
carry a per-entry field without becoming an array of objects). Exported, mirroring
`governedVerdictFromFindings`'s own precedent, so this claim is provable without the full
DB-dependent `analyzeSite()` pipeline it is spliced into.

Spliced into both branches of the `complianceAnalysis` assignment (governed and non-verdict),
so a site can carry a legacy observation independent of its governed/ungoverned status.

**Type-boundary correction, found by this unit's own scoped `tsc` check (S2 methodology, §4):**
`legacyObservation` is declared on `GovernedVerdictAnalysis` and `NonVerdictAnalysis` directly (both
already `Omit<SiteAnalysis, ...> & {...}`), via a new shared `LegacyObservationTag` type alias --
**not** on `SiteAnalysis` itself, the legacy engine's own type, which this unit does not touch. The
first draft merged `legacyObservation` into `complianceAnalysis` at runtime without ever declaring
it on either verdict type, which compiled without the field being visible to any downstream
consumer's type -- a scoped `tsc` run (see §4) caught this as a genuine `TS2339: Property
'legacyObservation' does not exist on type 'LuVerdictAnalysis'` error in
`localizationPdfService.ts`. Fixed by adding the optional field to both verdict variants; verified
clean by re-running the same scoped check.

`server/services/localizationPdfService.ts` reads `analysis.complianceAnalysis.legacyObservation`
and adds `legacyObservationLabel?: string` to `LocalizationPdfData.sites[]`, present iff that tag is
set: `'Observation från äldre regelmotor — ej del av den styrda bedömningen'`.

### J-2 -- hide the raw permit-probability percentage

`components/app/lu/LuWorkspace.tsx` no longer renders
`· tillståndssannolikhet {(compliance.permitProbability * 100).toFixed(0)}%` at all, governed or
not. K-131/J-2: "'tillståndssannolikhet' is not shown until calibrated; W3a doesn't show it at all;
W3d decides the calibration requirement." This is a UI-only change; the underlying
`permitProbability` field and its `governedVerdictFromFindings`/SEM-1 semantics are untouched.

### Q3 -- retire `LocalizationStudyUI.tsx` and `export-pdf` together

`components/LocalizationStudyUI.tsx` and its own test file
(`tests/components/localizationStudyUI.test.tsx`) are deleted outright -- confirmed unreachable
from the live app during the W3 design round (only its own test imported it; `LuWorkspace.tsx` is
the live replacement surface). `server/routes/localization.routes.ts` drops the
`POST /api/localization/export-pdf` route registration (its only caller was the now-deleted
component); the `exportLocalizationPdf` import is removed, but the orchestrator function itself is
left in place, unreferenced, per the no-drive-by-cleanup norm (B1's sibling decision for this same
unit). `handleOrchestratorError` (also imported by this file) remains used 7 other times elsewhere
in the file, so its import is not orphaned by this change.

A repo-wide grep for `LocalizationStudyUI` after the deletion confirmed exactly 6 remaining
references, all inert: this unit's own new explanatory comment
(`localization.routes.ts`), two pre-existing header/body comments in `LuWorkspace.tsx`
("Clean LU product surface — no LocalizationStudyUI..."), a pre-existing test name in
`luWorkspace.test.tsx`, the intentional retirement-proof test itself
(`localizationStudyUiRetired.test.ts`), and the two B1-decided comment-only references in
`mapLayerCatalog.test.ts`/`mimerProductShell.test.tsx`. None is a live import; confirmed by running
every test file that transitively touches these paths (`tests/components/luWorkspace.test.tsx`:
20/20 passing after the deletion).

### J-7/J-12 -- human-in-the-loop disclaimer, Jimmy's own final wording

`HUMAN_IN_THE_LOOP` in `generate-localization-report.usecase.ts` is replaced with Jimmy's own final
text, sent directly in chat (not this implementer's draft, which was superseded, not confirmed):

> Human in the loop: Mimer är ett beslutsstödsystem och fattar inte myndighetsbeslut. Systemet
> sammanställer underlag, identifierar relevanta omständigheter och kan lämna förslag och
> rekommendationer med spårbara källor. En behörig handläggare ansvarar för att granska underlaget,
> bedöma dess relevans och tillförlitlighet samt fatta, motivera och expediera det formella
> beslutet.

Both `HUMAN_IN_THE_LOOP` and `legacyObservationTag` were previously module-private; both are now
exported, for the same direct-pure-function-testability reason as `governedVerdictFromFindings`.

## 3. Tests added/changed

- `tests/unit/generateLocalizationReportLegacyObservationLabel.test.ts` (new, 5 tests):
  `legacyObservationTag()` tags when `restrictions` is non-empty; tags when `rules` is non-empty
  even if `restrictions` is empty; does not tag when both are empty
  (`Object.prototype.hasOwnProperty.call(tag, 'legacyObservation')` is `false`, not merely
  falsy-checked); pins `HUMAN_IN_THE_LOOP`'s exact new text via `toContain` on its three key phrases.
- `tests/unit/services/localizationPdfService.test.ts` (modified, +2 tests): a site whose legacy
  engine contributed `restrictions` carries a truthy, string `legacyObservationLabel`; a site with
  neither `restrictions` nor `rules` carries no such key at all
  (`hasOwnProperty` check, not `undefined`-check).
- `tests/components/luWorkspace.test.tsx` (modified, +2 assertions on the existing MEDIUM-risk
  test): `screen.queryByText(/tillståndssannolikhet/)` and `screen.queryByText(/50\s*%/)` both
  `not.toBeInTheDocument()`, scoped to the whole rendered screen rather than the `lu-risk` testid's
  own element -- **a self-caught methodology bug**: the first version of this assertion scoped to
  `screen.getByTestId('lu-risk')` itself, which passed vacuously at both base and candidate, since
  the percentage renders as a sibling `<span>` outside the `lu-risk`-tagged element, not inside it.
  Caught by actually reading the RED run's output before trusting it; fixed by rescoping to a
  whole-document query, then reconfirmed genuinely RED at base and GREEN at candidate.
- `tests/unit/localizationRoutes.test.ts` (modified): the old "exports PDF binary" 200-status test
  replaced with a 404 assertion for the retired route.
- `tests/unit/localizationStudyUiRetired.test.ts` (new, 2 tests): `fs.existsSync` is `false` for
  both the deleted component and its deleted test file -- the established "absence as proof of
  retirement" pattern, mirroring the PROVEN-record doc-absence convention.

## 4. Verified evidence

**RED probes**, each run via its exact embedded command (via a temp `.cjs` file rather than
`node -e <script>` directly for the `luworkspace-no-percentage` probe specifically -- see note
below -- identical script content either way), against a freshly created, separate worktree
(`C:\wt-w3a-base`, `node_modules` junctioned directly from this candidate's own tree rather than
robocopied, since `package.json`/`package-lock.json` carry no dependency change across either base
-- confirmed via `git diff <base> HEAD -- package-lock.json`, empty both times). Run twice: first
pinned to `f14e832e`, then re-run in full after the base bump (§0a) pinned to `b48ed5e2`, with
identical results both times:
- `w3a-legacy-observation-label`: exit 1 (`HUMAN_IN_THE_LOOP` assertion throws on `undefined`,
  `legacyObservationTag` is not a function).
- `w3a-pdf-legacy-observation-label`: exit 1 (`legacyObservationLabel` is `undefined`).
- `w3a-luworkspace-no-percentage`: exit 1 (`tillståndssannolikhet 50 %` span found in the
  document).
- `w3a-export-pdf-retired`: exit 1 (route returns 200, not 404).
- `w3a-localization-study-ui-retired`: exit 1 (both files still exist on disk at base).

All five fail for the exact assertion each test names, no crashes, under runner conditions (K-15
`prisma generate` preamble included in every probe), on both the original and the bumped base.

**Windows-only local-verification note:** the `w3a-luworkspace-no-percentage` probe's embedded
script is ~41KB; invoking it via `node -e <script>` on this Windows machine fails with
`ENAMETOOLONG` (Windows' command-line length limit). Confirmed this is a local verification
artifact, not a defect in the unit itself: `devgov-v0-attest.yml` runs on `ubuntu-latest`, where
`ARG_MAX` is comfortably above 41KB. The unit JSON's own `required_red`/`required_green` entries for
this probe are unchanged (`node -e <script>`, identical to every other entry and every prior unit);
only this implementer's local pre-verification harness writes the script to a temp file first
(`node <tempfile>`) to work around the Windows-specific limit -- the script content executed is
byte-identical either way.

**GREEN**, run directly against this candidate (real committed-shape test files):
- `generateLocalizationReportLegacyObservationLabel.test.ts`: 5/5 passed (24/24 combined with the
  PDF service test file in the same run).
- `localizationPdfService.test.ts`: 19/19 passed.
- `luWorkspace.test.tsx`: 20/20 passed.
- `localizationRoutes.test.ts`: 6/6 passed.
- `localizationStudyUiRetired.test.ts`: 2/2 passed.
- All five embedded GREEN probe commands: exit 0 each, **including the K-118 self-check** (every
  GREEN proof's embedded `TEST_SOURCE` byte-matches the actually committed file it names) --
  verified the check itself fires by deliberately appending a comment to
  `localizationStudyUiRetired.test.ts`, confirming the GREEN proof then failed with exit 2 and the
  expected `W3A_HARNESS_ERROR ... does not byte-match ...` message, then restoring the file and
  reconfirming exit 0 (unlike W3c, this hardening was built into the wrapper template from the
  start for this unit, not added after a reproducibility defect was found).
- Full combined run of the 5 `allowed_paths` test files together: **52/52** passed (5/5 files) --
  `5 + 19 + 20 + 6 + 2 = 52`, exactly the sum of the individual counts above.
- Separately, as a B1 regression check (not part of this unit's own proof): the two comment-only
  `LocalizationStudyUI` references this unit deliberately left untouched --
  `tests/unit/mapLayerCatalog.test.ts` and `tests/components/mimerProductShell.test.tsx` -- still
  pass unmodified: **8/8** passed (2/2 files). `52 + 8 = 60`, which is where an earlier draft of
  this document's unqualified "60/60 across 7 files" line came from, without naming the two extra
  files or catching that the line above it had miscounted the first file as 6 tests instead of 5
  (found by cold review, K-161; corrected here).

**Typecheck (S2 methodology, ad-hoc CLI-file-list `tsc`, same `compilerOptions` as `tsconfig.json`,
bypassing its `exclude` list which names `server`, `src/application`, `src/infrastructure`, and
`tests` outright):**
- Base (`f14e832e`), the 9 files that exist there (7 continuously-existing files this unit modifies,
  plus the 2 files this unit deletes, so the pre-deletion state is included): **113** `error TS`
  lines.
- Candidate (this unit's `HEAD`), the 9 files that exist there (the same 7 modified files, plus the
  2 new test files replacing the 2 deletions): **111** `error TS` lines.
- Reconciled exactly: 113 base − 6 (the deleted `localizationStudyUI.test.tsx`'s own pre-existing
  errors, gone with the file) + 2 (`luWorkspace.test.tsx`, pre-existing `makeSiteAnalysis`-helper
  type-looseness pattern, hit twice more only because this unit added 2 more call sites using the
  same helper -- same error class as every pre-existing call, not a new kind of defect) + 2
  (`localizationPdfService.test.ts`, identical pre-existing helper pattern, same reasoning) + 0
  (this unit's own two production files, `generate-localization-report.usecase.ts` and
  `localizationPdfService.ts`, contribute **zero** errors after the A1 type-boundary fix above) =
  111. Confirmed by diffing errors file-by-file, not just by count: every transitively-pulled-in
  package/infrastructure file (`LuExecutionKernelClient.ts`, `PrismaExecutionTicketQueue.ts`,
  `ExecutionKernel.ts`, `ProductLuContextArtifacts.ts`, `CanonicalPropertyArtifacts.ts`,
  `stubs.ts`, `mps-runtime/index.ts`, `EvidenceRAGService.ts`) shows an **identical** error count on
  both sides.
- `node_modules` for the base worktree was junctioned (not robocopied) from this candidate's own
  tree, since dependencies are unchanged; `@prisma/client` was already generated in that shared
  tree, so no `prisma generate` preamble was needed for this check specifically (only for the
  vitest-based RED/GREEN probes, which do their own).
- Not re-run against the `b48ed5e2` bump (§0a): the diff between `f14e832e` and `b48ed5e2` is seven
  files under `docs/architecture/`, `governance/devgov/units/`, `packages/mps-data-governance/`,
  `scripts/import/harvest/`, `tests/unit/import/`, plus a one-line `package.json` script-name change
  -- none of the 9 files this scoped check examines imports any of them, so the same 113/111 result
  necessarily still holds.

## 5. Non-claims

This unit does **not**:
- claim the K-28 RED-probes-only-first ordering was followed for its own first candidate -- see §0.
- claim to resolve the SEM-2/SEM-3 legacy-engine problem beyond labelling -- the legacy engine
  itself (`complianceRuleEngine.ts`) still runs and still populates `restrictions`/`rules`; this
  unit only ensures its output is visibly and structurally distinguished from the governed verdict,
  per Q2. Removing or replacing the legacy engine is out of scope.
- claim W3d's calibration question is answered -- `permitProbability` is hidden, not fixed or
  recalibrated; W3d decides what (if anything) replaces it.
- claim the PDF export's own, separately-worded "Human in the Loop" disclaimer
  (`localizationPdfService.ts`'s `disclaimer` field) was unified with the new `HUMAN_IN_THE_LOOP`
  constant -- noticed, not touched, in this unit.
- claim `exportLocalizationPdf()` was deleted -- only the route registration that made it reachable
  was removed; the function itself remains as unreferenced, forward-only dead code, per the
  no-drive-by-cleanup norm.
- claim the four K-131-catalogued product blockers (municipality fallback, `NullDocumentProvider`,
  missing `documentEvidenceRefs`) are addressed -- out of scope, candidate territory for a future
  unit.
- claim `tsc`'s 111/113 figures say anything about the project's overall type-health -- per the S2
  precedent, this is a narrow, ad-hoc, file-scoped check against this unit's own touched files only,
  not a project-wide typecheck (no `tsconfig.*.json` in this repo covers `server/`,
  `src/application/`, `src/infrastructure/`, or `tests/` today).

## 6. Final disposition

Not yet frozen, not pushed. This candidate went through one cold-review round: K-161 found a
doc-precision defect in §4's evidence reporting (fixed in §0a; no code or test change) and noted
main had advanced again (base bumped to `b48ed5e2`, §0a). All 5 RED probes independently reconfirmed
failing against freshly isolated worktrees on both `f14e832e` and, after the bump, `b48ed5e2`; all 5
GREEN probes confirmed passing against this candidate on both, including the K-118-style
byte-identity self-check built in from the start. The type-boundary gap the scoped `tsc` check
surfaced (§2/§4) has been fixed and re-verified clean. Awaiting the next cold-review pass -- with the
§0 process deviation still disclosed up front -- before freezing the exact SHA, then the established
chain: cold verification -> owner push-go -> PR (branch `w3a-legacy-engine-labelling`, the unit's
own `remote.branch`) -> dispatch (owner only) -> attestation -> merge.
