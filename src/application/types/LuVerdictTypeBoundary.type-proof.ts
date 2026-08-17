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

/* T3 — the union cannot be read for verdict fields before the discriminant is narrowed. */
// @ts-expect-error LU_VERDICT_TYPE_BOUNDARY_V1: narrow on assessment_status first.
void anyAnalysis.overallRisk;
// @ts-expect-error LU_VERDICT_TYPE_BOUNDARY_V1: narrow on assessment_status first.
void anyAnalysis.permitProbability;

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
  const probability: number = anyAnalysis.permitProbability;
  void risk;
  void probability;
}

/* T4b — the same narrowing through the published type guard. */
if (isGovernedVerdict(anyAnalysis)) {
  const risk: GovernedVerdictAnalysis['overallRisk'] = anyAnalysis.overallRisk;
  const probability: number = anyAnalysis.permitProbability;
  void risk;
  void probability;
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
