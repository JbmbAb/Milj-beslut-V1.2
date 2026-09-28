# LU-W2B-NULL-PERMIT-PROBABILITY-CONSUMERS-V1 -- null `permitProbability` consumers

**Status:** CANDIDATE (not yet frozen, not yet dispatched, not pushed)
**Unit:** `governance/devgov/units/lu-w2b-null-permit-probability-consumers-v1.json`
**Base:** `cf33cc1318b4505ccbf57d6296136b99c41fdee1` (live main after W2's PROVEN-record, PR #185)
**Design authority:** W2's own audit doc (`LU-W2-SEM1-NOT-CHECKED-V1.md`, section 4) flagged this as a
follow-up; K-53 (relayed cold review of the RED-probes-only candidate `35085239`) is this unit's
design authority for M1 (null representation), M2 (scope), M3 (this doc), S1 (ASCII).

## 1. Scope (OD-17)

W2 introduced `GovernedVerdictAnalysis.permitProbability: number | null` -- `null` exactly when a
governed rule's required evidence could not be technically checked (SEM-1's `NOT_CHECKED` state) and
no completed check reached HIGH/MEDIUM. W2's own audit doc found, but explicitly left unfixed, that
every downstream reader of this field predates the type change and was written against the old
always-a-number contract.

**OD-17 (scope boundary): this unit is presentation-layer only.** It changes how three UI/PDF
surfaces *render* a `null` `permitProbability`. It does not:
- touch `src/application/generate-localization-report.usecase.ts` or any other producer of the
  value (forbidden path `src/**`) -- the null-vs-number decision itself is W2's, frozen, not
  reopened here;
- change water-distance, layer-availability, or any other governed-rule semantics;
- change what counts as `NOT_CHECKED` or when `overallRisk`/`permitProbability` are computed.

## 2. Inventory of `permitProbability` consumers

A full-repo search for non-test, non-forbidden production files referencing `permitProbability`
found exactly six source files. Three are this unit's targets; three are out of scope, for the
reasons below.

**In scope (fixed):**
- `server/services/localizationPdfService.ts` -- the live legacy-PDF route
  (`/api/localization/export-pdf`). Reads `GovernedVerdictAnalysis.permitProbability` directly.
- `components/LocalizationStudyUI.tsx` -- confirmed unmounted on main (`components/app/lu/
  LuWorkspace.tsx:93` states outright: "Clean LU product surface -- no LocalizationStudyUI / hub /
  OperationsCenter"; the only other repo references are a code comment and a test-name string in
  `tests/unit/mapLayerCatalog.test.ts`, not a render). Still live, compiled, tested code -- not
  deleted -- so it still needs the fix per the original scope note ("rättas eller tas bort"; fixing
  is the smaller, more reversible change and keeps the file's own tests meaningful).
- `components/TechnicalSluExpert.tsx` -- see M2 below for why this is in scope despite being a
  structurally different data source from the other two.

**Out of scope, with reason:**
- `src/application/generate-localization-report.usecase.ts` -- the producer of the governed
  `null`, not a consumer; forbidden path.
- `src/application/evaluate-compliance-rules.usecase.ts` -- the **legacy** engine's own
  `SiteAnalysis.permitProbability: number` (always a computed number, `Math.min` chain starting at
  0.95, never null) -- a different, non-nullable field entirely; forbidden path, and not a null-risk
  regardless.
- `src/types/geo.ts` -- a type declaration only (`SiteAnalysis.permitProbability: number`, no
  `unresolvedChecks`), not a consumer that renders anything; forbidden path.
- `components/app/lu/LuWorkspace.tsx` -- forbidden path (`components/app/**`) and, checked directly,
  already safe: `typeof compliance.permitProbability === 'number'` at line 835 correctly excludes
  `null`. No action needed even if it were in scope.

## 3. M1 -- the null representation

**Decision (per K-53, recommended option): omit `permitProbability` when null; add structured
fields in its place.** This is the same rule this codebase already applies to `bestAlternativeId`
and to `overallRisk`/`permitProbability` themselves at the non-verdict boundary (see
`localizationPdfService.ts`'s own header comment: "Absence is the only representation that cannot
be mistaken for a finding"). A string sentinel in a `number | string` field was the fallback
option K-53 offered and was not used, for the same reason W2 itself rejected a fabricated `0.5`:
once a field's type admits a second kind of value to mean "not computed," every future reader of
that field has to remember to re-check for it, and nothing stops a new reader from not knowing to.
Structured, separately-named fields make "not computed" a compile-time-visible shape difference
instead of a runtime value to remember.

Applied per surface, since each has different existing shape:

- **`localizationPdfService.ts` / `LocalizationPdfData.sites[]`** (the fullest fix, because this
  surface already carries `unresolvedChecks` upstream in `GovernedVerdictAnalysis`): when
  `permitProbability === null`, the site object omits `permitProbability` and instead carries
  `permitProbabilityStatus: 'NOT_CHECKED'`, `permitProbabilityText: 'kan inte anges'`, and
  `unresolvedChecks: Array<{ruleId, findingId}>` (camelCased from the governed verdict's
  `rule_id`/`finding_id`, matching this file's existing camelCase convention for `rules[].ruleId`).
  `overallRisk` is still present and unchanged -- SEM-1's own point is that `NOT_CHECKED` is a
  non-severity state, not an absent verdict.
- **`LocalizationStudyUI.tsx`** and **`TechnicalSluExpert.tsx`**: neither surface's local API-response
  type carries `unresolvedChecks` (LocalizationStudyUI's `complianceAnalysis` type is a narrow local
  interface with only `permitProbability`/`requiredActions`/`notes`; TechnicalSluExpert's `compliance`
  is `SiteAnalysis` from `src/types/geo.ts`, which has no such field at all -- see M2). Plumbing
  `unresolvedChecks` to either would mean widening a type in a forbidden or out-of-scope surface, or
  inventing a value neither actually receives. Both instead fall through to their existing "not
  assessed" fallback UI (`typeof ... === 'number'` guard, same pattern originally used
  correctly elsewhere in this codebase e.g. `LuWorkspace.tsx:835`): LocalizationStudyUI already had
  an "Ej utredd" fallback badge for the undefined case; TechnicalSluExpert gained an equivalent
  "Ej utredd" fallback (previously had none at all -- see M2).

## 4. M2 -- `TechnicalSluExpert.tsx`, a third and *differently-caused* consumer

K-53 flagged `components/TechnicalSluExpert.tsx:186` as a third null-consumer and recommended
including it. Traced before deciding, since its `compliance` field comes from a different pipeline
than the other two surfaces:

- `TechnicalSluExpert.tsx`'s `data.compliance` is populated by `analyzeBiodiversity()`
  (`services/geminiService.ts`), which calls `callGeminiApi<{..., compliance?: SiteAnalysis, ...}>
  ('analyzeBiodiversity', {...})` -- a Gemini LLM call whose JSON response is typed but not
  runtime-validated against that type. This is **not** the LU governed verdict pipeline
  (`generate-localization-report.usecase.ts`) and **not** the legacy compliance engine
  (`evaluate-compliance-rules.usecase.ts`); it is a separate, disconnected biodiversity-analysis
  feature. Its `SiteAnalysis` type (`src/types/geo.ts`) declares `permitProbability: number`,
  non-nullable, with no `unresolvedChecks` field -- W2's SEM-1 `null` signal cannot reach this
  component through any code path that exists today.
- The real risk here is different in kind: an **untyped external LLM response** can omit or
  null out any field its TS type claims is always present, regardless of what that type says.
  `Math.round(data.compliance.permitProbability * 100)` at line 186 was completely unguarded
  (confirmed by reading `cf33cc13`'s own copy of the file directly, and empirically: the RED probe
  for this file fails on `cf33cc13` because the rendered output is `NaN%`, not because of any
  SEM-1-specific null).
- **Correction to a claim in W2's own merged audit doc**: `LU-W2-SEM1-NOT-CHECKED-V1.md` section 4
  states "`components/app/lu/LuWorkspace.tsx` and the test-only `components/TechnicalSluExpert.tsx`
  both guard with `typeof ... === 'number'`, which correctly excludes `null`." Independently
  re-verified directly against `git show cf33cc13:components/TechnicalSluExpert.tsx` (not taken on
  the prior doc's word, per this session's standing practice of re-verifying every claim): this is
  true for `LuWorkspace.tsx` but **false** for `TechnicalSluExpert.tsx` -- its line 186 had no guard
  at all. The RED probe for this file, run against the true `cf33cc13`, is direct empirical proof of
  the error (see section 5).
- **Decision: included**, per K-53's recommendation, since the underlying defect (an unguarded
  arithmetic read that can render `NaN%` or, coincidentally, `0%` for a missing/zero value from an
  untrusted external response) is real and the fix is the same minimal, non-design-bearing guard
  already used correctly elsewhere in this codebase. Fix: wrap the "Tillståndschans" read in
  `typeof data.compliance.permitProbability === 'number'`, falling back to an "Ej utredd" label --
  no new structured fields, since Gemini's response shape has nothing to plumb them from.

## 5. Tests added/changed

- `tests/unit/services/localizationPdfService.test.ts`: the one W2b test (added in `35085239`)
  rewritten to match M1's actual design -- asserts `permitProbability` is absent
  (`Object.prototype.hasOwnProperty`), `permitProbabilityStatus === 'NOT_CHECKED'`,
  `permitProbabilityText === 'kan inte anges'`, `unresolvedChecks` equals the mapped
  `{ruleId, findingId}` pair, and `overallRisk` is still `'LOW'`.
- `tests/components/localizationStudyUI.test.tsx`: the W2b test added in `35085239` needed **no
  change** -- it only asserted the fallback UI appears and the fabricated strings do not, which was
  already the correct M1-era assertion.
- `tests/components/technicalSluExpert.test.tsx`: new test (not present in `35085239`) --
  `analyzeBiodiversity` resolves with a `compliance` object that omits `permitProbability`
  (modelling a non-conforming Gemini response); asserts the "Ej utredd" fallback renders and neither
  `NaN%` nor `0%` appears.

## 6. Verified evidence

**RED probes** -- each run via its exact JSON-embedded command, against the true `cf33cc13` in a
separate, freshly created worktree (`node_modules` copied from this candidate's own tree via the
K-29 robocopy+junction procedure, so this is the same install state as the candidate run):
- `w2b-pdf-null-permit-probability`: exit 1 -- `expected true to be false` on
  `Object.prototype.hasOwnProperty.call(site, 'permitProbability')` (base code always sets the key).
- `w2b-ui-null-permit-probability`: exit 1 -- `findByText(/Ej utredd/i)` timed out; the rendered DOM
  shows the literal fabricated text `0% Godkänd`.
- `w2b-tse-null-permit-probability`: exit 1 -- `findByText('Ej utredd')` timed out (base renders
  `NaN%`, confirmed by DOM snapshot in the raw run output).

All three temp probe files were cleaned up (`finally` block) after each run.

**GREEN**, run directly against this candidate's working tree (all three real, committed-shape test
files, no temp-file trick needed):
- `localizationPdfService.test.ts`: 17/17 passed.
- `localizationStudyUI.test.tsx`: 4/4 passed.
- `technicalSluExpert.test.tsx`: 8/8 passed.

**Root `tsc -p tsconfig.json --noEmit`**, back-to-back, same install state (this candidate's own
`node_modules`, robocopied+junction-repaired into a separate `cf33cc13` worktree for the base run,
exactly as for the candidate run):
- Base (`cf33cc13`): **87** `error TS` lines.
- Candidate: **87** `error TS` lines.
- Diffed with `(line,col)` positions stripped so an unrelated line shift doesn't register as a
  difference: **zero** textual difference. This unit introduces no new type errors.

**`devgov-helper.mjs lint`** on the final unit JSON: 0 errors, 0 warnings, 2 info (audit doc not yet
present at lint time -- expected, since it is being generated in the same pass; 3 RED + 3 GREEN
proofs planned).

## 7. Non-claims

This unit does **not**:
- change any governed-rule semantics, water-distance/layer-availability behavior, or what
  `NOT_CHECKED`/`overallRisk`/`permitProbability` mean or when they are computed -- OD-17.
- claim `TechnicalSluExpert.tsx`'s `compliance` data is, or ever was, sourced from the LU governed
  verdict pipeline -- it is not; see section 4.
- claim `LocalizationStudyUI.tsx` is reachable from the live app -- it is confirmed unmounted; this
  unit fixes it anyway rather than deleting it, since deleting a live, still-tested file is a larger
  and less reversible change than the scope note asked for.
- widen `LocalizationStudyUI.tsx`'s or `TechnicalSluExpert.tsx`'s local API-response types to carry
  `unresolvedChecks` -- neither surface's actual data source can populate it (see section 3).
- re-litigate W2's own SEM-1/OD-03 design; the one factual correction in section 4 is about a
  single sentence in W2's audit doc's own consumer inventory, not about SEM-1/OD-03 itself.

## 8. Final disposition

Not yet frozen, not pushed. Per the established order: RED probes were shown to the verifier and
cold-reviewed before any production code was written (candidate `35085239`); this candidate is the
M1/M2/M3/S1 implementation requested in response. Awaiting cold review before freezing the exact
SHA, then the established chain: cold verification -> owner push-go -> PR -> dispatch (owner only)
-> attestation -> merge.
