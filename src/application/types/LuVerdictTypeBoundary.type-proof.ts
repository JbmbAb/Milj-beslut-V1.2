/**
 * LU_VERDICT_TYPE_BOUNDARY_V1 — compile-time proof fixture.
 *
 *   A governed LU verdict and a non-verdict result MUST be distinct TypeScript variants.
 *   No consumer may read verdict-only fields without first proving that the value is a
 *   governed verdict.
 *
 * This file contains no runtime assertions. Every claim here is checked by `tsc`, driven by
 * `src/application/unit/P3LuVerdictTypeBoundary.test.ts`.
 *
 * Why a compile proof and not another Vitest guard: P3-LU-CANONICAL-CHAIN-01 modelled absence
 * as optional fields (`overallRisk?`). The repository's tsconfig sets neither `strict` nor
 * `strictNullChecks`, so `RiskLevel | undefined` is assignable to `RiskLevel` and every
 * consumer that read a verdict field into a required slot compiled silently. The runtime
 * guards in `src/application/unit/` caught the consumers that existed; they cannot catch the
 * consumer somebody adds tomorrow. A discriminated union can, because reading a property that
 * is absent from one union member is an error under the loose config this repository actually
 * ships — no `strictNullChecks` migration required.
 *
 * Deliberately NOT compiled with `strictNullChecks`: the point is to prove the boundary holds
 * under today's compiler settings. See `tsconfig.lu-verdict.json`.
 */

import { isGovernedVerdict } from '../generate-localization-report.usecase';
import type {
  GovernedVerdictAnalysis,
  LuVerdictAnalysis,
  NonVerdictAnalysis,
  SiteAnalysisResult,
} from '../generate-localization-report.usecase';

declare const nonVerdict: NonVerdictAnalysis;
declare const anyAnalysis: LuVerdictAnalysis;
declare const result: SiteAnalysisResult;

/* T1 — a non-verdict result has no `overallRisk` to read. */
// @ts-expect-error LU_VERDICT_TYPE_BOUNDARY_V1: overallRisk is verdict-only.
void nonVerdict.overallRisk;

/* T2 — a non-verdict result has no `permitProbability` to read. */
// @ts-expect-error LU_VERDICT_TYPE_BOUNDARY_V1: permitProbability is verdict-only.
void nonVerdict.permitProbability;

/*
 * T2c — SEM-1 (W2): a non-verdict result has no `unresolvedChecks` either. It is meaningful
 * only alongside a real verdict (which checks were left out of THIS risk grade); a result with
 * no verdict at all has nothing for it to qualify.
 */
// @ts-expect-error LU_VERDICT_TYPE_BOUNDARY_V1: unresolvedChecks is verdict-only.
void nonVerdict.unresolvedChecks;

/* T3 — the union cannot be read for verdict fields before the discriminant is narrowed. */
// @ts-expect-error LU_VERDICT_TYPE_BOUNDARY_V1: narrow on assessment_status first.
void anyAnalysis.overallRisk;
// @ts-expect-error LU_VERDICT_TYPE_BOUNDARY_V1: narrow on assessment_status first.
void anyAnalysis.permitProbability;
// @ts-expect-error LU_VERDICT_TYPE_BOUNDARY_V1: narrow on assessment_status first.
void anyAnalysis.unresolvedChecks;

/*
 * T3b — the same, reached through the shape consumers actually hold. This is the access the
 * PDF projection performed for a caseworker-facing document.
 */
// @ts-expect-error LU_VERDICT_TYPE_BOUNDARY_V1: narrow on assessment_status first.
void result.complianceAnalysis.overallRisk;
// @ts-expect-error LU_VERDICT_TYPE_BOUNDARY_V1: narrow on assessment_status first.
void result.complianceAnalysis.permitProbability;

/* T4 — after narrowing on the discriminant, the verdict fields are present and typed. */
if (anyAnalysis.assessment_status === 'ASSESSED') {
  const risk: GovernedVerdictAnalysis['overallRisk'] = anyAnalysis.overallRisk;
  // permitProbability is `number | null` (SEM-1, K-35 M5) -- not a bare `number` -- so this reads
  // as its own declared type, not as `number` directly (that narrower assignment is T6 below).
  const probability: GovernedVerdictAnalysis['permitProbability'] = anyAnalysis.permitProbability;
  const checks: GovernedVerdictAnalysis['unresolvedChecks'] = anyAnalysis.unresolvedChecks;
  void risk;
  void probability;
  void checks;
}

/* T4b — the same narrowing through the published type guard. */
if (isGovernedVerdict(anyAnalysis)) {
  const risk: GovernedVerdictAnalysis['overallRisk'] = anyAnalysis.overallRisk;
  const probability: GovernedVerdictAnalysis['permitProbability'] = anyAnalysis.permitProbability;
  const checks: GovernedVerdictAnalysis['unresolvedChecks'] = anyAnalysis.unresolvedChecks;
  void risk;
  void probability;
  void checks;
}

/* T5 — every non-verdict branch stays constructible without supplying verdict fields. */
const denied: NonVerdictAnalysis = {
  assessment_status: 'GOVERNANCE_DENIED',
  restrictions: [],
  rules: [],
  summary: '',
};
const notAssessed: NonVerdictAnalysis = {
  assessment_status: 'NOT_ASSESSED',
  restrictions: [],
  rules: [],
  summary: '',
};
const failed: NonVerdictAnalysis = {
  assessment_status: 'EXECUTION_FAILED',
  restrictions: [],
  rules: [],
  summary: '',
};
void denied;
void notAssessed;
void failed;

/*
 * T5b — and a non-verdict result cannot be built carrying a verdict. This is the leak the
 * optional-field model permitted: the strip point could be bypassed and nothing objected.
 */
const leaked: NonVerdictAnalysis = {
  assessment_status: 'GOVERNANCE_DENIED',
  restrictions: [],
  rules: [],
  summary: '',
  // @ts-expect-error LU_VERDICT_TYPE_BOUNDARY_V1: a non-verdict result cannot carry a verdict.
  overallRisk: 'LOW',
};
void leaked;

/* T5c — 'ASSESSED' is not a non-verdict status. */
const misStatused: NonVerdictAnalysis = {
  // @ts-expect-error LU_VERDICT_TYPE_BOUNDARY_V1: ASSESSED belongs to GovernedVerdictAnalysis.
  assessment_status: 'ASSESSED',
  restrictions: [],
  rules: [],
  summary: '',
};
void misStatused;

/* T5d — a governed verdict cannot be built without the verdict fields. */
// @ts-expect-error LU_VERDICT_TYPE_BOUNDARY_V1: a governed verdict must carry its verdict.
const hollow: GovernedVerdictAnalysis = {
  assessment_status: 'ASSESSED',
  restrictions: [],
  rules: [],
  summary: '',
};
void hollow;

/*
 * T5e — SEM-1 (W2): a governed verdict cannot be built without `unresolvedChecks` specifically,
 * even when `overallRisk`/`permitProbability` are both present. Isolates the new field from the
 * other two so a future edit cannot make it silently optional while T5d still passes.
 */
// @ts-expect-error LU_VERDICT_TYPE_BOUNDARY_V1: unresolvedChecks is required on a governed verdict.
const missingUnresolvedChecks: GovernedVerdictAnalysis = {
  assessment_status: 'ASSESSED',
  restrictions: [],
  rules: [],
  summary: '',
  overallRisk: 'LOW',
  permitProbability: 0.95,
};
void missingUnresolvedChecks;

/*
 * T6 — SEM-1 (W2), K-35 M5: `permitProbability` admits `null` (an incomplete assessment: at
 * least one governed check is unresolved) -- it is `number | null`, not a bare `number`.
 *
 * This is a WEAKER claim than the rest of this file's `@ts-expect-error` proofs, and
 * deliberately so: this repository's tsconfig has `strictNullChecks` off (see this file's own
 * header), under which `null` is assignable to `number` unconditionally -- reading
 * `incompleteVerdict.permitProbability` into a `number` slot compiles with or without narrowing,
 * so no `@ts-expect-error` here would ever be genuine (confirmed: writing one produces TS2578
 * "Unused '@ts-expect-error' directive", not the intended protection). Under this compiler
 * configuration, a discriminated union on a literal tag is the only mechanism this codebase has
 * that actually blocks an unguarded read (that is what the rest of this file tests) -- a nullable
 * *value* on a single variant does not. The real protection for this specific field is therefore
 * the runtime invariant proven in tests/unit/generateLocalizationReportVerdictNotChecked.test.ts:
 * `null` occurs only together with a non-empty `unresolvedChecks`. What this test DOES prove at
 * compile time is that the type was actually widened -- `null` is a legal value here, which it
 * was not before this unit.
 */
const incompleteVerdict: GovernedVerdictAnalysis = {
  assessment_status: 'ASSESSED',
  restrictions: [],
  rules: [],
  summary: 'incomplete',
  overallRisk: 'LOW',
  permitProbability: null,
  unresolvedChecks: [{ rule_id: 'LU-WATER-001', finding_id: 'finding-notchecked-water' }],
};
void incompleteVerdict;
