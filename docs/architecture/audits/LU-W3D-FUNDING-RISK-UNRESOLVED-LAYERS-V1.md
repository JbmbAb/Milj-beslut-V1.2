# LU-W3D-FUNDING-RISK-UNRESOLVED-LAYERS-V1 -- D3 RED-only candidate

**Status:** CANDIDATE -- RED probes only, zero production code. For cold review of test design
before any implementation begins, per the K-28 ordering (returning to it after W3b's own
RED-only-first candidate; not repeating W3a's disclosed deviation).
**Unit:** `governance/devgov/units/lu-w3d-funding-risk-unresolved-layers-v1.json`
**Base:** `81260bcf2fec45ddeb281fb32ea8680ecad457af` (W3b merged).
**Design authority:** `W3-DESIGN-DECISION-2026-09-28.writer-copy.md` §1 Group D, D3 -- last of the
four named W3 units (W3c/W3a/W3b already merged). Full scope note, including every fact re-verified
against current main and a finding the original design doc did not name (nothing currently
populates `mapLayerSelection.unavailable` with real content, so this unit's live exposure today is
narrower than D1/D2/C1/C2 were), cold-reviewed and confirmed with no corrections:
`Claude outputs/w3d-design-2026-09-29/W3D-SCOPE-NOTE-2026-09-29.md`.

## 0. Scope decisions confirmed by cold review (not reopened here)

- **Q-W3d-1:** additive-only fix. Surface which tracked map layers are unavailable; do **not**
  change `envScore`/`fundingScore`/`fundingRisk.rating`/`eligibleForGreenLoan`'s existing formulas.
  Building an actual producer for `mapLayerSelection.unavailable` (nothing currently populates it)
  is explicitly out of scope -- confirmed real scope creep into map-layer-availability detection
  this unit did not investigate.
- **Q-W3d-2:** the new field lists raw `MapLayerKey` values (`'GROUNDWATER'`, `'NATURA2000'`,
  `'FLOOD_RISK'`), matching `environmentalRisk`'s own existing raw-value style, not pre-formatted
  Swedish text.
- **Q-W3d-3:** no new `confidence` field on `environmentalRisk` -- `regulatoryRisk.confidence` is
  itself a pre-existing hardcoded constant (`0.85`, unrelated to any real computed signal); adding
  an analog here would be inventing a new metric next to an already-flagged, separately out-of-scope
  issue.
- **Independently confirmed during cold review, strengthening (not contradicting) the scope note's
  own finding:** `services/projectStructure.ts:611-627`'s `normalizeMapLayerSelection()` passes an
  arbitrary caller-supplied `unavailable` value through unfiltered (unlike `base`/`optional`/`enabled`,
  which fall back to template defaults when empty) -- the same ingestion path the scope note's
  "generic plan-save endpoint accepts arbitrary `Partial<ProjectPlan>`" point already covers, now
  named exactly. Confirms this unit's "currently-unreachable-in-practice input, not an observed live
  bug" framing holds even accounting for this specific function.

## 1. RED probe (this candidate's only content)

`tests/unit/predictiveScoringService.test.ts` (modified, +3 tests), all in a new describe block:
- names every one of three unavailable layers (`GROUNDWATER`, `NATURA2000`, `FLOOD_RISK`) in
  `environmentalRisk.unresolvedLayers` when all three are unavailable.
- names only the one specific unavailable layer (`NATURA2000`) when the other two are `enabled`
  instead -- proves the field reflects the actual unavailable set, not a blanket "something is
  wrong" flag.
- reports an empty `unresolvedLayers` array (not `undefined`, not omitted) when nothing is
  unavailable -- the clean baseline.

## 2. Verified RED

Run via the exact embedded command, against a freshly isolated worktree (`C:\wt-w3d-base`, pinned
to `81260bcf`, `node_modules` junctioned from `C:\wt-w3d`'s own tree since
`package.json`/`package-lock.json` are unchanged by this candidate): `w3d-unresolved-layers` exits
1 -- all three new assertions fail (`unresolvedLayers` is `undefined`, the field doesn't exist yet);
the 14 pre-existing tests in the same file all still pass, confirming no unrelated regression from
adding the new describe block.

## 3. Non-claims -- what this candidate does not do

No production code. No GREEN proof has been run or can meaningfully be run yet. This candidate
exists solely to let the RED probe be reviewed for design soundness before any implementation is
written, matching the K-28 ordering. Does not change the funding-score formula or green-loan
eligibility (Q-W3d-1). Does not build a producer for `mapLayerSelection.unavailable`. Does not touch
`regulatoryRisk.confidence` (Q-W3d-3, pre-existing, unrelated) or
`.cursor/rules/import-focus-product.mdc` (Q6, still unaddressed). This is the last named W3 unit
from the original design round.
