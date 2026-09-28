# LU-W3C-FAIL-OPEN-WATER-AVAILABILITY-V1 -- D1/D2 fail-open fixes

**Status:** CANDIDATE (not yet frozen, not yet dispatched, not pushed)
**Unit:** `governance/devgov/units/lu-w3c-fail-open-water-availability-v1.json`
**Base:** `6f9b005907197389c3782ef5e4e2ff0e3aa38e94` (live main after the Dev-Gov repository-dispatch
adapter compat unit's own PROVEN-record, PR #191; history: `052582bd` -> bumped to `0a3e8d98` per
K-118 M3 -> bumped again to `6f9b0059` per K-125, since main advanced again -- docs-only both
times, a two-file PROVEN-record with no overlap with this unit's own files -- each bump merged
`origin/main` with no force and no conflicts)
**Design authority:** the W3 design round (`W3-DESIGN-DECISION-2026-09-28.md`, cold-reviewed K-83,
owner decision K-89: "enligt rekommendation") pulled D1 and D2 forward as the first W3 sub-unit
(W3c), ahead of W3a/W3b/W3d. K-109 (cold review of the first RED candidate, `efac943c`) required
three test-design corrections (M1-M3) and recommended seven more (S1-S7) before any production
code; that revision (`dba743df`) was itself confirmed COLD_VERIFIED (K-111). The first
implementation candidate (`4e0c412a`) was cold-reviewed as K-118: code semantics approved, but the
evidence chain was **FAIL_REOPEN** on three musts (M1-M3) and five recommendations (S1-S5); the
revision (`89ac2b32`) was confirmed COLD_VERIFIED on content (K-125), with one more base bump
required since main advanced again during that recheck. This document and this candidate are that
second bump -- no code or test change from `89ac2b32`, only `base_sha` and this section.

## 0. Corrections made in this revision, per K-118

This section exists so the corrections are visible in one place rather than scattered through the
sections they touch. Every item below was independently re-verified against source before being
accepted, not applied on the reviewer's word alone.

- **M1 (reproducibility defect, confirmed):** the `4e0c412a` commit changed
  `tests/unit/sewagePdfService.test.ts` (a case fix, `'kunde'` -> `'Kunde'`) but the unit JSON was
  never regenerated, so its embedded RED `TEST_SOURCE` still held the pre-fix text while the
  GREEN proof's `RUN_PATH` check only confirmed the committed file *existed*, never that it
  *matched* what the JSON embedded. RED and GREEN were provably exercising different test text.
  Confirmed directly: extracting `TEST_SOURCE` from the committed unit JSON and diffing it against
  the committed test file showed a real byte mismatch. Fixed two ways: (a) regenerated the unit
  JSON properly this time, verified byte-for-byte identity between every embedded `TEST_SOURCE`
  and its committed file for all four proof pairs, not just the one that broke; (b) added a
  self-check to every GREEN proof itself -- it now reads the committed file, compares it to its own
  embedded `TEST_SOURCE`, and exits 2 (harness error) on any mismatch, so this exact defect can
  never again pass silently. Verified the check actually fires: temporarily appended a comment to
  the committed test file and re-ran the GREEN proof, confirmed it failed with exit 2 and the
  expected message, then restored the file and re-confirmed exit 0.
- **M2:** this document's own §4 no longer claims proof "via exact embedded command" without the
  identity guarantee above backing that claim.
- **M3:** base bumped to `0a3e8d98`, then again to `6f9b0059` per K-125 (main advanced a second
  time during that recheck); RED re-verified failing on each exact new base in turn, GREEN
  re-verified passing on each new candidate built on top of it.
- **S1 (asymmetry, confirmed):** `distanceToWaterAvailable !== true` already treated an absent
  field as unresolved (fail-closed), but `protectedAreaAvailable === false` treated an absent field
  as *available* (fail-open) -- the opposite default for the same failure class. Changed to
  `protectedAreaAvailable !== true` in both `regulationOrchestrator.ts` and
  `massSpatialSensitivity.ts`, so all four signals now share one rule: a field that isn't
  affirmatively proven available is treated as unresolved, never silently as clean.
- **S2 (confirmed, serious):** the original "root tsc 87=87" claim was checked against
  `tsconfig.json`'s actual `exclude` list, which names `server`, `src/infrastructure`, and `tests`
  outright -- **none of this unit's eight changed files were ever type-checked by that command.**
  The number was real but proved nothing about this unit. Replaced with an honest, scoped check --
  see §4.
- **S3 (confirmed):** the phrase quoted as K-89 ("behandla okänt som okänt, aldrig som lågrisk")
  does not appear in K-89's own owner-decision text (`"enligt rekommendation" — Q1 W3c först...`);
  it was scope-note prose from the same relay message, paraphrasing ADR-28A's OD-03/OD-04
  ("Unknown water distance means UNKNOWN, never 'safe' or 'beyond range' by omission"). Citation
  corrected in §5.
- **S4 (confirmed):** `spatialAuditService.ts`'s `fallbackInSarAudit` is wired only via
  `auditInSarRiskAtPoint(...).catch(...)` -- but `auditInSarRiskAtPoint` itself
  (`sgiInSarService.ts`) already has its own internal try/catch and *resolves* (never rejects) with
  `warningFlags: ['insar:unavailable']` on a WFS failure. `spatialAuditService.ts`'s own `.catch()`
  wrapper is therefore not reached by this failure mode in practice; the flag's real origin is
  `sgiInSarService.ts` itself. Corrected in the table in §2.
- **S5 (confirmed, changes the severity framing):** `server/routes/sewage.applications.routes.ts`
  /`sewage.routes.ts` (D1's consumer) and `server/routes/cNotificationMass.routes.ts` (D2's
  consumer) are mounted in `server/createApp.ts` only inside `if (isLegacyRoutesEnabled())`
  (`server/security/legacyRoutes.ts`), which reads `LEGACY_ROUTES_ENABLED` and defaults to
  **false** -- the helper's own doc comment states this is "false in RC1, and only ever true via an
  explicit opt-in a developer sets deliberately for local work on these out-of-scope modules." By
  contrast, `bankComplianceRouter` (a different unit's future scope) is mounted unconditionally.
  Calling D1/D2 "live" or D1's PDF "official" overstated their default exposure; corrected
  throughout this document to "reachable only when `LEGACY_ROUTES_ENABLED=true`."

## 1. Scope (OD-17)

W3's frozen owner decisions (ADR-28A: SEM-2, SEM-3, OD-04, OD-17) name "all non-LU paths that
currently fail-open on unknown water state" as W3's territory. This unit is **exactly two of the
ten findings** the W3 design round's discovery pass identified (D1 and D2), pulled forward by
Jimmy's own severity ordering (K-89). Per S5 above, the original severity framing for that
ordering overstated D1's default exposure (gated behind `LEGACY_ROUTES_ENABLED`, default off, not
reachable in a standard deployment); this is noted for the record, not something this unit
resolves -- the ordering decision itself was Jimmy's and is not reopened here. It does not touch:

- D3 (`predictiveScoringService.ts`'s funding-risk scoring) -- separate unit, W3d.
- D4/D5 (the orphaned Dossier/VertexDirigent pair, `predictWeatherRisk`) -- separate disposition,
  per K-89's "radera Dossier-trion... D5 i W3b".
- The legacy-engine labelling problem (Group A/B, W3a) and OD-04's two named bank/Gemini targets
  (Group C, W3b) -- separate units, sequenced after this one per K-89.
- The governed LU chain (`src/application/**`), `packages/**`, and every prior W1/W2/W2b file --
  none of this unit's changes touch or depend on them.

## 2. What changed

### D1 -- `src/infrastructure/geo/static-map-generator.ts` + `server/services/sewagePdfService.ts`

`StaticMapGenerator.generateMap()` and `.drawMapToPdf()` each ran three independent PostGIS
queries (Natura 2000, `env.protected_area`, `env.water_protection_area`) inside their own
try/catch, logging a warning and silently continuing on failure -- indistinguishable, in the
returned `intersectingZones` array, from "queried and found nothing." `sewagePdfService.ts` (reached
only when `LEGACY_ROUTES_ENABLED=true`, per S5 -- not the default) printed an affirmative "Inga
overlappande miljoskyddszoner identifierades i kartanalysen" (no overlapping protection zones
found) whenever that array was empty -- including when it was empty because a query threw.

Fix: both methods now also return `unavailableLayers: string[]`, naming which of the three
protection-zone layers could not be queried (buildings is not a protection zone and is not
tracked). `$queryRaw` call order is unchanged (the RED probes are coupled to it, per K-109's own
note). `sewagePdfService.ts` now branches three ways instead of two:
- `intersectingZones.length > 0` -> the existing red warning, listing zones (unchanged).
- `unavailableLayers.length > 0` -> a new amber line, `"Kunde inte kontrollera: <lager1>,
  <lager2>"`, naming every unavailable layer in a single `doc.text()` call.
- both empty -> the original green affirmation, now correctly gated on genuine completeness
  rather than merely on an empty zones array.

A site can print both the red warning and the amber caveat together (some zones found, a
different layer unavailable); the green affirmation is reserved for the case where nothing is
outstanding at all.

### D2 -- `server/services/regulationOrchestrator.ts` + `server/modules/c-notification-mass/massSpatialSensitivity.ts`

Both files independently recomputed `isNearWater` and `hasHighSoilVulnerability` from
`spatialAuditService.ts`'s output without reading the availability signals that service already
provides for exactly this purpose. Both now compute and return a new `spatialDataUnresolved:
string[]` field, populated from **four** independent unavailability signals, all now using the
same fail-closed rule after S1 (a field that is not affirmatively proven available/true is treated
as unresolved, whether it is explicitly `false` or simply absent/`undefined`):

| Signal | Unresolved when | Never confused with | Real origin |
|---|---|---|---|
| `distance-to-water-unavailable` | `distanceToWaterMeters === null && distanceToWaterAvailable !== true` | **M1**: a checked site with nothing within 500m *also* reports `distanceToWaterMeters: null`, but with `distanceToWaterAvailable: true` -- that is OD-03's own "genuinely dry" state, not unresolved. | `spatialAuditService.ts` sets `distanceToWaterAvailable: false` only when `fetchDistanceToWater` itself threw. |
| `sgu-unavailable` | `sgu.flags?.includes('sgu:unavailable')` | **M2**: `sgu.manualReviewRequired` is `true` in the normal `'sample'` coverage default and on a genuine landslide finding -- not a failure signal. | `spatialAuditService.ts`'s `fallbackSguAudit()`, reached when `auditSguRiskAtPoint` rejects. |
| `insar-unavailable` | `insar.warningFlags?.includes('insar:unavailable')` | **S4 (corrected)**: NOT `spatialAuditService.ts`'s `fallbackInSarAudit` as originally documented -- that function is wired only via `auditInSarRiskAtPoint(...).catch(...)`, but `auditInSarRiskAtPoint` (`sgiInSarService.ts`) has its own internal try/catch and *resolves* (never rejects) with this flag on a WFS failure, so the `.catch()` wrapper is not reached by this failure mode in practice. | `sgiInSarService.ts`'s own internal catch block, directly. |
| `protected-area-unavailable` | `protectedAreaAvailable !== true` (changed from `=== false` per S1) | the same failure class as the other three, not previously read by either consumer. | `spatialAuditService.ts` sets this `false` only when the protected-area query itself failed. |

`isSensitiveArea` is `true` whenever any signal is unresolved, in addition to the three pre-existing
positive criteria (protected / near water / high soil risk) -- an unresolved check is
conservative-by-default: a false positive here means stricter MPF/mass-notification review, a
false negative means an actually-sensitive site goes undetected. `sensitiveReasons` gains a new
entry ("ofullständigt geodataunderlag (kräver manuell kontroll)") when `spatialDataUnresolved` is
non-empty, so `RegulatoryClassification.summary`'s prose reflects it too.

**S6 (scope decision, not a code change to the file it concerns):**
`tests/unit/serverLowCoverageServices.test.ts` (outside this unit's `allowed_paths`) has a
pre-existing test for `classifyProjectRegulatoryTrack` whose mock supplies `sgu: {riskLevel,
groundLayer}` with no `flags`, no `insar`, and no `distanceToWaterAvailable`/
`protectedAreaAvailable` at all (all `undefined`). Rather than expanding this unit's scope to that
shared, unrelated test file, both new signal reads use optional chaining
(`sgu?.flags?.includes(...) ?? false`, `insar?.warningFlags?.includes(...) ?? false`), which
resolve to `false` (not unresolved) for that mock's missing `sgu.flags`/`insar` fields specifically.
`distanceToWaterAvailable !== true` and, after S1, `protectedAreaAvailable !== true` both resolve
to `true` (unresolved) for that same mock's missing fields -- this **does** add
`distance-to-water-unavailable` and `protected-area-unavailable` to `spatialDataUnresolved` for
that test's input, which the test does not check for. The test's own three assertions
(`permitClass`, `isSensitiveArea`, `summary` containing `'känslig'`) are unaffected, since
`isProtected: true` in that mock already makes `isSensitiveArea` true regardless. Verified: that
file's existing 8 tests all still pass unmodified, both before and after the S1 change.

**Consumers of the new `spatialDataUnresolved` field**, traced directly (not assumed): both
`server/routes/cNotificationMass.routes.ts` handlers return their result objects wholesale --
`res.json({ ok: true, classification, ... })` for `classifyProjectRegulatoryTrack` (line ~204) and
`res.json({ ..., siteSensitivity, ... })` for `resolveMassSiteSensitivity` (line ~249) -- so the
new field reaches the API response with no route-level change needed, when that router is mounted
(`LEGACY_ROUTES_ENABLED=true`, per S5 -- not the default). `server/modules/c-notification-mass/
massOrchestrator.ts` only reads `.isSensitiveArea`/`.source` from `siteSensitivity` and is
unaffected by the additive field; it does not itself surface `spatialDataUnresolved` further
(a W3a-territory observation, not addressed here).

## 3. Tests added/changed

- `tests/unit/staticMapGenerator.test.ts` (new): 8 tests -- `generateMap()`'s Natura 2000 failure
  case and all-succeed baseline; `drawMapToPdf()`'s three individual layer-failure cases (Natura
  2000, Skyddat omrade, Vattenskyddsomrade) plus its own all-succeed baseline; a property-not-found
  case for each method, asserting the lookup failure still throws/rejects (S2 of K-109 -- confirmed
  pre-existing correct behavior, not part of this unit's fix, kept as a regression guard).
- `tests/unit/sewagePdfService.test.ts` (modified): the 3 pre-existing tests' mock updated from a
  bare `string[]` to `{intersectingZones, unavailableLayers}` (unaffected in substance); 3 new
  tests for the unavailable-only, mixed, and fully-clean (M3 of K-109) cases, each pinning the exact
  `doc.text()` call containing both the caveat and the layer name (S3 of K-109), not a
  `.join(' ')`-flattened substring match.
- `tests/unit/regulationOrchestratorUnresolved.test.ts` (new): 8 tests -- one per unresolved
  signal (distance, SGU-unavailable, InSAR, protected-area), the M1 dry-site distinction, the M2
  normal-sample-coverage-is-not-unresolved distinction, a combined regression test for the three
  pre-existing positive criteria (S4 of K-109), and the fully-resolved-clean baseline.
- `tests/unit/massSpatialSensitivityResolve.test.ts` (new): 7 tests, mirroring the same structure
  for `resolveMassSiteSensitivity`.

No test file changed in this revision -- K-118's M1-M3/S1-S5 were all either unit-JSON regeneration,
production-code fixes, or documentation corrections.

## 4. Verified evidence

**RED probes**, each run via its exact JSON-embedded command, against the true `6f9b0059` in a
freshly created, separate worktree (`node_modules` robocopied + junction-repaired from this
candidate's own tree, per the K-29 precedent). Also independently re-verified against the prior
base `0a3e8d98` before that base advanced again (K-125):
- `w3c-static-map-unavailable-layers`: exit 1.
- `w3c-sewage-pdf-cannot-verify`: exit 1.
- `w3c-regulation-orchestrator-unresolved`: exit 1.
- `w3c-mass-spatial-sensitivity-unresolved`: exit 1.

All four fail for the exact assertion each test names (missing field / wrong text), no crashes,
under runner conditions (K-15 `prisma generate` preamble included in every probe).

**GREEN**, run directly against this candidate (real committed-shape test files):
- `staticMapGenerator.test.ts`: 8/8 passed.
- `sewagePdfService.test.ts`: 6/6 passed (3 pre-existing + 3 new).
- `regulationOrchestratorUnresolved.test.ts`: 8/8 passed.
- `massSpatialSensitivityResolve.test.ts`: 7/7 passed.
- All four embedded GREEN probe commands: exit 0 each, against this candidate, **including the
  new self-check** (M1) that each GREEN proof's embedded `TEST_SOURCE` byte-matches the actually
  committed file it names -- verified the check itself works by deliberately drifting a committed
  file, confirming the GREEN proof then fails with exit 2 and a clear message, then restoring the
  file and reconfirming exit 0.
- Byte-identity confirmed independently for all four proof pairs (not just the one that broke in
  `4e0c412a`): every embedded RED and GREEN `TEST_SOURCE` matches its committed file exactly.

**Regression check:** `tests/unit/serverLowCoverageServices.test.ts` (outside `allowed_paths`,
S6's concern): 8/8 passed unmodified, both before and after the S1 fix.

**Typecheck (S2 -- corrected methodology):** root `tsc -p tsconfig.json --noEmit` was the wrong
instrument -- `tsconfig.json`'s own `exclude` list names `server`, `src/infrastructure`, and
`tests` outright, so it never touches any of this unit's eight files. Replaced with an explicit,
file-list `tsc` invocation (same `compilerOptions` as `tsconfig.json`, passed on the command line
to bypass its `exclude`, since TypeScript's `exclude` only governs implicit file discovery, not
explicit CLI arguments), run back-to-back on the same install state:
- The 4 production files, base `0a3e8d98` vs the `89ac2b32` candidate: **4** pre-existing
  `error TS2339` lines both times, all in `server/repositories/sewageApplicationRepository.ts` (an
  unrelated `PrismaClient` model-name mismatch this unit does not touch or cause), zero textual
  difference after diffing. Not re-run against the `6f9b0059` bump in this revision: the diff
  between `0a3e8d98` and `6f9b0059` is two new files under `docs/architecture/audits/` and
  `governance/devgov/units/` only (a PROVEN-record for an unrelated unit) -- neither path is
  imported by, or affects the compiled output of, any file this scoped check examines, so the same
  result necessarily still holds.
- The 4 new test files, checked standalone on the candidate (no base comparison is possible for
  files that do not exist at base): the same 4 pre-existing errors (transitively reached via
  `sewagePdfService.test.ts` -> `sewagePdfService.ts` -> ... -> the same repository file), zero
  errors from the new test files themselves.
- This is a narrower claim than "introduces zero new errors project-wide" -- it is "introduces zero
  new errors in the files this unit actually touches, checked by an ad-hoc command with the same
  compiler options as the project's own `tsconfig.json`." No `tsconfig.*.json` in this repo covers
  `server/`, `src/infrastructure/`, or `tests/` today (confirmed: only `tsconfig.json` and
  `tsconfig.lu-verdict.json` exist, and `npm run typecheck` is a bare `tsc --noEmit`, i.e. the same
  excluding config) -- adding one is outside this unit's scope.

**`devgov-helper.mjs lint`**: 0 errors, 0 warnings.

## 5. Non-claims

This unit does **not**:
- claim to fix every fail-open pattern the W3 design round found -- D3, D4, D5, the legacy-engine
  labelling problem, and OD-04's bank-compliance/Gemini targets are explicitly out of scope,
  sequenced as separate later units (W3a, W3b, W3d) per K-89.
- claim D1's or D2's consumer routes are reachable in a default deployment -- both are mounted only
  behind `LEGACY_ROUTES_ENABLED=true` (default false, an explicit developer opt-in per that flag's
  own doc comment), per S4/K-118. The fix is still correct and worth having for whenever that flag
  is on, and the underlying PostGIS query failure mode it addresses is real, but this document does
  not repeat the earlier, overstated "live"/"official permit document" framing.
- change `spatialAuditService.ts`, `sgiInSarService.ts`, or `sguRiskService.ts` themselves -- all
  four availability signals this unit reads already existed in those files' output; this unit only
  adds readers that were previously missing them.
- claim `tests/unit/serverLowCoverageServices.test.ts` was strengthened to actually exercise the
  new signals -- it was deliberately left out of scope (S6); its existing mock simply does not
  break, verified by running it, not by assumption.
- change the `$queryRaw` call order in `static-map-generator.ts` -- the RED probes are coupled to
  the exact sequence (property, buildings, Natura 2000, protected area, water protection).
- claim the root `tsc -p tsconfig.json --noEmit` figure (87 errors, unchanged) says anything about
  this unit's own files -- per S2, that command's project excludes them entirely; see the scoped
  check in §4 for the claim this unit actually makes.
- claim `isSensitiveArea`'s conservative-on-unresolved behavior was independently ratified as exact
  mechanism by Jimmy. The frozen principle it implements is ADR-28A's OD-03/OD-04 ("Unknown water
  distance means UNKNOWN, never 'safe' or 'beyond range' by omission"; W3 extends this to "all
  non-LU paths that ... fail-open on unknown water state") -- not, as an earlier draft of this
  document incorrectly quoted, a literal phrase from K-89's own owner-decision text (corrected per
  S3/K-118). The specific mechanism chosen here (an unresolved check forces `isSensitiveArea: true`
  rather than only being surfaced as a separate field) is this implementer's reading of that
  principle, not a separately confirmed owner ruling on the exact mechanism.

## 6. Final disposition

Not yet frozen, not pushed. RED probes were cold-reviewed twice (K-109 on `efac943c`, requiring
M1-M3 revisions; the revision `dba743df` was confirmed COLD_VERIFIED, K-111) before any production
code was written. The first implementation candidate (`4e0c412a`) was cold-reviewed as K-118:
code semantics approved, evidence chain FAIL_REOPEN on M1-M3/S1-S5, all addressed in this revision.
Awaiting cold review before freezing the exact SHA, then the established chain: cold verification
-> owner push-go -> PR (branch must be named `w3c-fail-open-water-availability`, the unit's own
`remote.branch`) -> dispatch (owner only) -> attestation -> merge.
