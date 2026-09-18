# LU-CANONICAL-PATH-01 — CANDIDATE

**Status:** CANDIDATE / NOT YET PROVEN  
**Base:** `9d8d39d8e879f1062c95db62175b8bbf11f82a9b`

## Purpose

Freeze the LU product to one canonical decision path now that AUTHORITY-CHAIN-PROMOTION-01 is
PROVEN on main.

This unit does **not** redesign authority, assessment semantics, spatial evidence, document
evidence, replay, or presentation. It closes the remaining API-level bypass by preventing product
code from entering the legacy/general LU engine through the public package root.

## Canonical product path

The supported LU decision spine is:

```text
authenticated project
  -> localizationOrchestrator
  -> localizationReportService
  -> GenerateLocalizationReportUseCase
  -> verified ProjectContextBinding + canonical property identity
  -> current LocalizationGeometry
  -> governed SpatialEvidence + governed DocumentEvidence / verified facts
  -> canonical product release
  -> deriveLuExecutionSeed
  -> runCanonicalLuProductAssessment
  -> exact V3 ExecutionIdentity subject
  -> ExecutionKernel admission
  -> capability invocation
  -> source-authority verification
  -> GovernedAssessmentPersistence
  -> LocalizationAssessmentArtifact
  -> durable non-authoritative assessment projection
  -> governed presentation / PDF
```

A compatibility wrapper such as `generateLocalizationReportLegacy` is permitted only because it
delegates directly to `GenerateLocalizationReportUseCase.execute()`. It is not a second assessment
implementation.

## Gap closed by this unit

Before this unit, `packages/mps-lu/src/index.ts` contained:

```ts
export * from "./execution/LuExecutionKernelClient";
```

That exported both:

- `runCanonicalLuProductAssessment`, whose type requires `identity_subject_v3`; and
- `runLuAssessmentViaKernel`, whose general/legacy contract intentionally permits V1/V2/no-subject
  callers for tests and historical ops.

The live product used the canonical wrapper correctly, but the package root still made the
legacy-capable engine available to any future product module importing `@miljobeslut/mps-lu`.
That is an API-level bypass surface even though no current production caller used it.

## Change

The package root now exports only:

```ts
runCanonicalLuProductAssessment
CanonicalLuKernelRunInput
LuKernelRunResult
LU_EXECUTION_PRINCIPAL_ID
```

from the execution-client boundary.

`runLuAssessmentViaKernel` and `createLuRuleEngineInvokeHandler` remain available only by an
explicit internal-module import. Existing tests and ops proofs that deliberately exercise the
legacy/general engine were changed to make that dependency explicit.

## Frozen invariants

1. Product code under `src/`, `server/`, `components/`, and package `src/` trees MUST NOT
   call or import `runLuAssessmentViaKernel` outside its implementation module.
2. The package root MUST NOT wildcard-export `LuExecutionKernelClient`.
3. The package root MUST expose `runCanonicalLuProductAssessment` explicitly.
4. `generate-localization-report.usecase.ts` MUST invoke the canonical wrapper and MUST NOT call
   the general engine.
5. The legacy report facade MAY exist only as delegation to the canonical usecase.
6. Existing NO_ALTERNATE_LU_DECISION_PATH rules remain load-bearing: no LU verdict exists without
   a governed `LocalizationAssessmentArtifact`.
7. Authority remains the already-PROVEN mainline authority boundary; this unit does not create or
   weaken authority.

## RED property

On the base SHA, the package root wildcard-exports `LuExecutionKernelClient`, thereby exposing the
general engine. The trusted RED command checks that public API property directly and fails on base
for the semantic reason under test; it does not depend on a candidate-only test file.

## GREEN proof set

- public package execution API is canonical-only;
- `LuCanonicalPath01.test.ts` passes its repository-wide production scan and negative fixture;
- `LuCutoverSinglePath.test.ts` remains green;
- `NoAlternateLuDecisionPath.test.ts` remains green;
- `LocalizationAssessmentReleaseBindingProof.test.ts` remains green;
- `LuSourceAuthorityTemporal04E.test.ts` remains green.

## Non-claims

This unit does not claim that every data source is available or complete. A source can still be
`degraded` or `unavailable`; that state must not become an ungoverned verdict.

This unit does not remove the legacy/general engine itself. Tests, replay proofs, migration proofs,
and explicit operator tooling may still import its internal module. The frozen rule is that it is
not a public product entrypoint.

## Finalization rule

This document remains CANDIDATE until the exact candidate SHA receives
`DEV-GOV-V0 / trusted-execution = success`, is merged with a merge commit, and the merge tree is
verified equal to the gated candidate tree. A separate protected PROVEN record must then be added.
