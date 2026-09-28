# LU-W3C-FAIL-OPEN-WATER-AVAILABILITY-V1 -- D1/D2 fail-open fixes

**Status:** CANDIDATE (not yet frozen, not yet dispatched, not pushed)
**Unit:** `governance/devgov/units/lu-w3c-fail-open-water-availability-v1.json`
**Base:** `052582bd4ea8799de73ceffdb1c5744a48865b4b` (live main after the Dev-Gov invariant-packs
hardening PROVEN-record, PR #189)
**Design authority:** the W3 design round (`W3-DESIGN-DECISION-2026-09-28.md`, cold-reviewed
K-83, owner decision K-89: "enligt rekommendation") pulled D1 and D2 forward as the first W3
sub-unit (W3c), ahead of W3a/W3b/W3d. K-109 (cold review of the first RED candidate, `efac943c`)
required three test-design corrections (M1-M3) and recommended seven more (S1-S7) before any
production code; this candidate implements the fix those corrected tests describe.

## 1. Scope (OD-17)

W3's frozen owner decisions (ADR-28A: SEM-2, SEM-3, OD-04, OD-17) name "all non-LU paths that
currently fail-open on unknown water state" as W3's territory. This unit is **exactly two of the
ten findings** the W3 design round's discovery pass identified (D1 and D2), pulled forward by
Jimmy's own severity ordering (K-89: D1 sits in a real permit-application document; D2 reproduces
W1's own bug class in two more live paths). It does not touch:

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
returned `intersectingZones` array, from "queried and found nothing." `sewagePdfService.ts` (the
live consumer, via `drawMapToPdf`) printed an affirmative "Inga overlappande miljoskyddszoner
identifierades i kartanalysen" (no overlapping protection zones found) whenever that array was
empty -- including when it was empty because a query threw, in the official enskilt-avlopp permit
application PDF.

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
string[]` field, populated from **four** independent unavailability signals (the fourth, S5, was
not in the original design and was added on the cold reviewer's recommendation):

| Signal | Unresolved when | Never confused with |
|---|---|---|
| `distance-to-water-unavailable` | `distanceToWaterMeters === null && distanceToWaterAvailable !== true` | **M1**: a checked site with nothing within 500m *also* reports `distanceToWaterMeters: null`, but with `distanceToWaterAvailable: true` -- that is OD-03's own "genuinely dry" state, not unresolved. |
| `sgu-unavailable` | `sgu.flags?.includes('sgu:unavailable')` | **M2**: `sgu.manualReviewRequired` is `true` in the normal `'sample'` coverage default and on a genuine landslide finding -- not a failure signal. The real failure signal is `sgu.flags` containing `'sgu:unavailable'`, set only by `fallbackSguAudit()` on an actual query failure. |
| `insar-unavailable` | `insar.warningFlags?.includes('insar:unavailable')` | set only by `fallbackInSarAudit()` on an actual WFS failure. |
| `protected-area-unavailable` | `protectedAreaAvailable === false` | **S5**: the same failure class as the other three (`spatialAuditService.ts` sets this `false` only when the protected-area query itself failed), not previously read by either consumer. |

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
`protectedAreaAvailable`. Rather than expanding this unit's scope to that shared, unrelated test
file, both new signal reads use optional chaining (`sgu?.flags?.includes(...) ?? false`,
`insar?.warningFlags?.includes(...) ?? false`) and both `protectedAreaAvailable`/
`distanceToWaterAvailable` reads tolerate `undefined` (`!== true`, `=== false` are both false for
`undefined`). Verified: that file's existing 8 tests all still pass unmodified.

**Consumers of the new `spatialDataUnresolved` field**, traced directly (not assumed): both
`server/routes/cNotificationMass.routes.ts` handlers return their result objects wholesale --
`res.json({ ok: true, classification, ... })` for `classifyProjectRegulatoryTrack` (line ~204) and
`res.json({ ..., siteSensitivity, ... })` for `resolveMassSiteSensitivity` (line ~249) -- so the
new field reaches the API response with no route-level change needed. `server/modules/
c-notification-mass/massOrchestrator.ts` only reads `.isSensitiveArea`/`.source` from
`siteSensitivity` and is unaffected by the additive field.

## 3. Tests added/changed

- `tests/unit/staticMapGenerator.test.ts` (new): 8 tests -- `generateMap()`'s Natura 2000 failure
  case and all-succeed baseline; `drawMapToPdf()`'s three individual layer-failure cases (Natura
  2000, Skyddat omrade, Vattenskyddsomrade) plus its own all-succeed baseline; a property-not-found
  case for each method, asserting the lookup failure still throws/rejects (S2 -- confirmed
  pre-existing correct behavior, not part of this unit's fix, kept as a regression guard).
- `tests/unit/sewagePdfService.test.ts` (modified): the 3 pre-existing tests' mock updated from a
  bare `string[]` to `{intersectingZones, unavailableLayers}` (unaffected in substance); 3 new
  tests for the unavailable-only, mixed, and fully-clean (M3) cases, each pinning the exact
  `doc.text()` call containing both the caveat and the layer name (S3), not a `.join(' ')`-flattened
  substring match.
- `tests/unit/regulationOrchestratorUnresolved.test.ts` (new): 8 tests -- one per unresolved
  signal (distance, SGU-unavailable, InSAR, protected-area), the M1 dry-site distinction, the M2
  normal-sample-coverage-is-not-unresolved distinction, a combined regression test for the three
  pre-existing positive criteria (S4), and the fully-resolved-clean baseline.
- `tests/unit/massSpatialSensitivityResolve.test.ts` (new): 7 tests, mirroring the same structure
  for `resolveMassSiteSensitivity`.

## 4. Verified evidence

**RED probes**, each run via its exact JSON-embedded command, against the true `052582bd` in a
freshly created, separate worktree (`node_modules` robocopied + junction-repaired from this
candidate's own tree, per the K-29 precedent -- corrected after an initial methodology error where
the first re-check was accidentally run against this candidate's own already-fixed working tree
instead of a genuine base checkout; re-done properly before this doc was written):
- `w3c-static-map-unavailable-layers`: exit 1.
- `w3c-sewage-pdf-cannot-verify`: exit 1.
- `w3c-regulation-orchestrator-unresolved`: exit 1.
- `w3c-mass-spatial-sensitivity-unresolved`: exit 1.

All four fail for the exact assertion each test names (missing field / wrong text), no crashes,
under runner conditions (K-15 `prisma generate` preamble included in every probe, even though this
unit's own module graph does not require it, matching established precedent of erring toward
including it).

**GREEN**, run directly against this candidate (real committed-shape test files):
- `staticMapGenerator.test.ts`: 8/8 passed.
- `sewagePdfService.test.ts`: 6/6 passed (3 pre-existing + 3 new).
- `regulationOrchestratorUnresolved.test.ts`: 8/8 passed.
- `massSpatialSensitivityResolve.test.ts`: 7/7 passed.
- All four embedded GREEN probe commands (item 5 of the implementation brief): exit 0 each,
  against this candidate.

**Regression check (item 7 of the implementation brief):**
`tests/unit/serverLowCoverageServices.test.ts` (outside `allowed_paths`, S6's concern): 8/8 passed
unmodified, confirming the optional-chaining design choice above.

**Root `tsc -p tsconfig.json --noEmit`**, back-to-back, same install state (this candidate's own
`node_modules`, robocopied + junction-repaired into a separate `052582bd` worktree for the base
run):
- Base: **87** `error TS` lines.
- Candidate: **87** `error TS` lines.
- Diffed with `(line,col)` positions stripped: **zero** textual difference.

**`devgov-helper.mjs lint`**: 0 errors, 0 warnings.

## 5. Non-claims

This unit does **not**:
- claim to fix every fail-open pattern the W3 design round found -- D3, D4, D5, the legacy-engine
  labelling problem, and OD-04's bank-compliance/Gemini targets are explicitly out of scope,
  sequenced as separate later units (W3a, W3b, W3d) per K-89.
- change `spatialAuditService.ts`, `sgiInSarService.ts`, or `sguRiskService.ts` themselves -- all
  four availability signals this unit reads already existed in those files' output; this unit only
  adds readers that were previously missing them.
- claim `tests/unit/serverLowCoverageServices.test.ts` was strengthened to actually exercise the
  new signals -- it was deliberately left out of scope (S6); its existing mock simply does not
  break, verified by running it, not by assumption.
- change the `$queryRaw` call order in `static-map-generator.ts` -- the RED probes are coupled to
  the exact sequence (property, buildings, Natura 2000, protected area, water protection).
- claim `isSensitiveArea`'s new conservative-on-unresolved behavior was independently ratified as
  correct policy by Jimmy beyond what K-89's "behandla okant som okant, aldrig som lagrisk"
  instruction already establishes -- this unit's specific choice (an unresolved check forces
  `isSensitiveArea: true` rather than only being surfaced as a separate field with `isSensitiveArea`
  left unchanged) is this implementer's reading of that instruction, not a separately confirmed
  owner ruling on the exact mechanism.

## 6. Final disposition

Not yet frozen, not pushed. RED probes were cold-reviewed twice (K-109 on `efac943c`, requiring
M1-M3 revisions; the revision `dba743df` was itself confirmed COLD_VERIFIED, K-111) before any
production code was written. This candidate is that implementation. Awaiting cold review before
freezing the exact SHA, then the established chain: cold verification -> owner push-go -> PR ->
dispatch (owner only) -> attestation -> merge.
