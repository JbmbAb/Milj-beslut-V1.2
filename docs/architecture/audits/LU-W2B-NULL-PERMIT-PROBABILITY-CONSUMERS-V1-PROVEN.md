# LU-W2B-NULL-PERMIT-PROBABILITY-CONSUMERS-V1 — PROVEN

**Final state:** PROVEN
**Promotion PR:** #186
**Gated candidate:** `939f27106dabc46a1093fb0482953564a2df7aa1`
**Merge commit:** `825a876bd8067f5307181d9033067217968892f2`
**Merge tree:** `4e061d33a0d6fcb2227e77b8e0b47c90ff0ad09f`
**Candidate tree:** `4e061d33a0d6fcb2227e77b8e0b47c90ff0ad09f`

This record is introduced by its own DEV-GOV unit, `LU-W2B-NULL-PERMIT-PROBABILITY-CONSUMERS-PROVEN-DOC-V1`.
The unit's final state takes effect when this record is itself merged through that gate. It does
not edit, and does not replace, the candidate record
`LU-W2B-NULL-PERMIT-PROBABILITY-CONSUMERS-V1.md`.

## Anchors

- Base before this merge (`main`): `cf33cc1318b4505ccbf57d6296136b99c41fdee1` (the W2 PROVEN-record
  merge, PR #185)
- Gated candidate: `939f27106dabc46a1093fb0482953564a2df7aa1`
- This record's own unit base (`main` at record creation): `825a876bd8067f5307181d9033067217968892f2`
  -- the W2b merge commit itself, since no other unit merged to `main` between W2b's merge and this
  record's creation.

The candidate record's own lineage (`LU-W2B-NULL-PERMIT-PROBABILITY-CONSUMERS-V1.md`) documents the
full implementation history: candidate `35085239` (unit-JSON + two RED probes only, no production
code, cold-reviewed and approved to start implementation per K-53), and `939f2710` (the M1/M2/M3/S1
implementation: the null-representation redesign, the third `TechnicalSluExpert.tsx` consumer, the
audit doc shipped in the same candidate, and ASCII-escaping the unit JSON) -- producing the final
gated candidate `939f2710`. The delta between `939f2710` and the pre-merge base `cf33cc13` is
exactly the files declared in `LU-W2B-NULL-PERMIT-PROBABILITY-CONSUMERS-V1`'s own `allowed_paths`:
the three consumer fixes, their three test files, and that unit's own two governance files (its
unit JSON and its audit doc).

This PROVEN-doc unit is a separate, later unit with its own base and its own two-file
`allowed_paths` (this record and its own unit JSON) -- its own delta is exactly those two files
against its base, `main` at record creation, `825a876bd8067f5307181d9033067217968892f2` (the W2b
merge commit itself), so none of W2b's own files appear in it -- they are already present
identically on both sides of that diff.

## Trusted execution evidence

- Protected Dev-Gov orchestration run: `36394111819`
- Canonical trusted evidence gate: `36394641828`
- Gate result: `proof_status: PROVEN` (`result`/`classification`/`reason_code`/`message`: `PASS`;
  job conclusion: `success`), 6 proof ids (3 RED + 3 GREEN)
- Gate trust-policy digest: `2c9ef79592495aba9dd2ddc7913e91f48b6f233b4aa35b9573848dfadec246d5`
- Gate OIDC audience bound to the exact candidate SHA:
  `devgov-v0-gate:2c9ef79592495aba9dd2ddc7913e91f48b6f233b4aa35b9573848dfadec246d5:939f27106dabc46a1093fb0482953564a2df7aa1`
- Repository workflow `devgov-v0-gate.yml@refs/heads/main`; environment `devgov-attestation`;
  GitHub-hosted runner
- Required commit status on the candidate:
  - context: `DEV-GOV-V0 / trusted-execution`
  - state: `success`
  - description: `Trusted RED/GREEN verified for exact candidate SHA; packs=v1:PASS:5be20e1bff4d9fe67471804192c80c1f1072da92f31f5481c34b2c6bb84ea8c3`

### Trusted RED (executed at `cf33cc13…`, observed `FAIL`, exit 1)

- `w2b-pdf-null-permit-probability` -- a self-contained probe (the test file's exact source, as
  updated for the M1 redesign, is embedded in the probe script and written to a temporary path at
  run time) proving `buildLocalizationPdfData()` still unconditionally sets `permitProbability` at
  this base: `Object.prototype.hasOwnProperty.call(site, 'permitProbability')` is `true` when the
  governed verdict's own value is `null`.
- `w2b-ui-null-permit-probability` -- the same self-contained-embed technique, proving
  `LocalizationStudyUI.tsx`'s `permitProbability !== undefined` check at this base lets `null`
  through and renders the literal fabricated text `0% Godkänd` instead of the expected
  `Ej utredd` fallback.
- `w2b-tse-null-permit-probability` -- the same technique, proving `TechnicalSluExpert.tsx`'s
  unguarded `Math.round(data.compliance.permitProbability * 100)` at this base renders `NaN%`
  (never falling back to `Ej utredd`) when the biodiversity-analysis response omits
  `permitProbability`.

### Trusted GREEN (executed at the candidate, observed `PASS`, exit 0)

- `w2b-pdf-null-permit-probability` (the committed `tests/unit/services/localizationPdfService
  .test.ts`, 17/17: `permitProbability` is absent and `permitProbabilityStatus`/
  `permitProbabilityText`/`unresolvedChecks` are present exactly when the governed verdict's value
  is `null`, all other cases unchanged)
- `w2b-ui-null-permit-probability` (the committed `tests/components/localizationStudyUI.test.tsx`,
  4/4: the `typeof === 'number'` guard falls through to `Ej utredd`, never `0% Godkänd`)
- `w2b-tse-null-permit-probability` (the committed `tests/components/technicalSluExpert.test.tsx`,
  8/8: the same guard falls through to `Ej utredd`, never `NaN%` or a fabricated `0%`)

Regression guards, re-run green against the candidate outside the gate's own proof set (local
evidence, per this candidate's own audit doc section 6): `P3LuVerdictPdfProjection.test.ts` (5/5,
the omit-pattern for verdict-less sites is unaffected), `generateLocalizationReportVerdictNotChecked
.test.ts` (8/8, W2 itself untouched), `NoAlternateLuDecisionPath.test.ts` (9/9). Root
`tsc -p tsconfig.json --noEmit`, same install state: 87 errors on base `cf33cc13`, 87 on the
candidate, zero textual difference after stripping line/column positions.

## Merge topology and tree verification

The candidate was merged with a merge commit only, through PR #186, pinned to the exact candidate
head SHA. Squash and rebase were not used for this merge.

Merge commit parents:

1. `cf33cc1318b4505ccbf57d6296136b99c41fdee1`
2. `939f27106dabc46a1093fb0482953564a2df7aa1`

Immediately after the merge:

```text
tree(825a876bd8067f5307181d9033067217968892f2)
==
tree(939f27106dabc46a1093fb0482953564a2df7aa1)
==
4e061d33a0d6fcb2227e77b8e0b47c90ff0ad09f
```

Therefore the integration result is identical to the gated candidate tree. A diff between the
merge commit and the candidate is empty.

## Proven claims

LU-W2B-NULL-PERMIT-PROBABILITY-CONSUMERS-V1 proves only the following, as stated in the candidate
record:

1. `server/services/localizationPdfService.ts`'s PDF projection never presents a governed verdict's
   `null` `permitProbability` as `0` or any other number. The key is omitted from the site object,
   and `permitProbabilityStatus: 'NOT_CHECKED'`, `permitProbabilityText: 'kan inte anges'`, and
   `unresolvedChecks` (mapped from the governed verdict's own `rule_id`/`finding_id` pairs) take its
   place -- the same "absence, never a placeholder" rule this file already applies to
   `bestAlternativeId`. Numeric cases are unchanged.
2. `components/LocalizationStudyUI.tsx` -- the exact risk W2's own audit doc flagged and left
   unfixed -- no longer lets a `null` `permitProbability` pass its presence check and render a
   fabricated `0% Godkänd`; it falls through to the pre-existing `Ej utredd` fallback.
3. `components/TechnicalSluExpert.tsx`, a third consumer identified during cold review (K-53 M2),
   no longer performs unguarded arithmetic on a value an untyped external (Gemini) response may
   omit; it falls through to the same `Ej utredd` fallback rather than rendering `NaN%`. This is a
   structurally different risk from the other two surfaces (an external response not matching its
   declared type, not the SEM-1 null signal), documented as such rather than conflated with it.
4. A factual error in W2's own merged audit doc -- the claim that `TechnicalSluExpert.tsx` already
   guarded correctly -- is corrected in this unit's own audit doc, independently re-verified
   against both the true base source and a live RED-probe run, without modifying W2's document.
5. This unit is presentation-layer only (its own OD-17): no governed-rule semantics, no producer of
   `permitProbability`, and no water-distance/layer-availability behavior were touched.

## Non-claims

This unit does **not**:

- change any governed-rule semantics, water-distance/layer-availability behavior, or when/how
  `NOT_CHECKED`/`overallRisk`/`permitProbability` are computed -- OD-17, unchanged from the
  candidate record.
- claim `TechnicalSluExpert.tsx`'s `compliance` data is, or ever was, sourced from the LU governed
  verdict pipeline -- it is not; its risk is a differently-caused but structurally similar defect.
- claim `components/LocalizationStudyUI.tsx` is reachable from the live app -- it remains confirmed
  unmounted (`components/app/lu/LuWorkspace.tsx` is the live replacement surface); this unit fixes
  it anyway rather than deleting still-tested, still-compiled code.
- **claim staging validation.** Per the same delegated-decision basis as W1/W2 (K-11): no staging environment runs `main`
  today, so no staging run was performed or could have been performed for
  this unit. The evidence this PROVEN record rests on is Dev-Gov trusted RED/GREEN execution
  (above) and the candidate's own local regression-guard/tsc evidence -- not staging evidence. Real
  staging validation for the Lokaliseringsutredning flow remains tracked separately (D-P5/K-6)
  against a future release SHA that includes this unit.
- reopen or re-litigate W2's SEM-1/OD-03 design. The one correction this unit makes to W2's own
  audit doc is limited to a single factual sentence about `TechnicalSluExpert.tsx`'s existing guard
  state, made in this unit's own document, not in W2's.
- **claim `permitProbability`'s consumers are now exhaustively covered repo-wide.** The inventory in
  the candidate's own audit doc (section 2) found exactly three production, non-test files
  affected and fixed; `src/application/generate-localization-report.usecase.ts` (the producer),
  `src/application/evaluate-compliance-rules.usecase.ts` (the legacy engine's own non-nullable
  field), `src/types/geo.ts` (a type declaration only), and `components/app/lu/LuWorkspace.tsx`
  (already correctly guarded) were checked and found out of scope or already safe, not left
  unchecked.

### Non-required PR checks at merge time

Branch protection on `main` requires only `DEV-GOV-V0 / trusted-execution`, which passed. The same
non-required checks that were red on W1's and W2's PRs (per delegated decision K-12/K-11) were also
red on PR #186 at merge time: `Typecheck` (87 errors, unchanged baseline, confirmed by an exact
root-`tsc` diff as part of this candidate's own cold review), `Lint`, `Format check`, `Security
audit` (pre-existing, unrelated to this unit), and `Require staging proof in PR` (waived by the
same K-11-class basis, see Non-claims above).

## Final disposition

`LU-W2B-NULL-PERMIT-PROBABILITY-CONSUMERS-V1 = PROVEN`

Further LU work may rely on the PDF projection's omit-and-structured-fields representation of an
incomplete governed verdict, and on both UI surfaces' correct `typeof === 'number'` guarding, as
proven, mechanical protections -- not as cover for `TechnicalSluExpert.tsx`'s underlying disconnect
from the governed pipeline (a separate, pre-existing feature boundary this unit did not change) or
for any consumer outside this unit's own inventory. W3 (SEM-2/SEM-3) is next, on the owner's word.
