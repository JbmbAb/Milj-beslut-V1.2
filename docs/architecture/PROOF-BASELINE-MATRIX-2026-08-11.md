# Proof Baseline Matrix — 2026-08-11

> ```
> Document class:                    PROOF UNDERLAG  (ej roadmap-authority)
> Program parent:                    P0 (Proof semantics & baseline) / P8 (proof fabric)
> Program authority:                 P0–P8 → PROGRAM-P0-P8-AUTHORITY-2026-08-11.md
> May define local steps:            YES
> May redefine program dependencies: NO
> May redefine PROVEN semantics:     NO — se proven_criteria i architecture-authority-map.jsonc
> May redefine authority boundaries: NO
> ```

Status: DRAFT / NOT FROZEN. Purpose: define what each proof lane means before any Vitest project
split is implemented.

This document is part of the Codex non-colliding architecture lane. It does not change
`vitest.config.ts`, does not quarantine tests by itself, and does not authorize deletion of legacy
packages.

It must not be used as an execution plan until `ADR-28-LU-Definition-Scope.md` and
`ADR-DOCUMENT-INGESTION-MANIFEST-CONTRACT.md` are reconciled with the LU/MVP and legal-corpus
plans.

## Current Proven Claims

| Claim | Command / evidence | Status | Notes |
|---|---|---|---|
| Legal corpus import gate v1 | `npx vitest run packages/mps-legal-corpus/tests/CorpusImportGate.test.ts` | PROVEN | Windows run: 18/18. |
| Legal corpus package lane | `npx vitest run packages/mps-legal-corpus` | PROVEN | Windows run: 18/18. |
| Legal corpus collateral against compliance config | Stash-test of `vitest.config.ts` + `tsconfig.json`, then `npx vitest run --config vitest.config.ts --project compliance` | PROVEN FOR COLLATERAL | Same 16 failed files / 17 failed tests with and without the legal-corpus config additions. The additions did not cause the broad failures. |
| Governance Level 1 containment | `npx vitest run tests/unit/governanceRoutes.test.ts` at containment stage | PROVEN | Authenticated ADMIN gate for promote/reject. |
| Governance Level 2 crypto promotion | `tests/unit/governanceRoutes.test.ts` plus `tests/unit/mimers/approval.test.ts`, `tests/unit/mimers/tv-l1-e2e.test.ts`, `tests/unit/mimers/quarantinePromotionAttestation.test.ts` | PROVEN | Signed attestation binding is required before permanent promotion. |

## Current Blockers

| Blocker | Evidence | Meaning |
|---|---|---|
| Normal local full suite | `npx vitest run` fails in integration global setup with `password authentication failed for user "riskguard"` | BLOCKED BY ENV / DB AUTH. This is not evidence against `mps-legal-corpus`. |
| Broad compliance lane | `npx vitest run --config vitest.config.ts --project compliance` fails 16 files / 17 tests | BLOCKED BY PRE-EXISTING LEGACY / COMPLIANCE FAILURES. Stash-test proved the failure shape predates the legal-corpus config additions. |
| PostGIS compliance tests | Same compliance run reports `riskguard` auth failures in spatial-provider-postgis tests | BLOCKED BY ENV / DB AUTH until DB credentials or CI container are known. |

## Proposed Lanes

These lanes are definitions only. They become executable commands only after approval and a
separate config/script change.

| Lane | Intended contents | Required status for PROVEN | Owner |
|---|---|---|---|
| `proof:active` | ACTIVE authority packages, route exposure tests, authority map tests, legal-corpus gate, active LU/MVP smoke tests that do not require PostGIS credentials | Must be green | Codex owns lane definition; Opus/Claude owns LU tests inside the lane. |
| `proof:quarantined` | QUARANTINED packages and retired-candidate packages that are still useful as diagnostics | May be red without blocking active proof | Codex records and reports; user decides quarantine/removal. |
| `proof:integration-db` | Tests requiring PostGIS/test DB credentials | Must be green only when DB env is available | CI/env owner. |
| `diagnostic:compliance` | Current `--project compliance` behavior | Diagnostic until classification is frozen | Shared. |

## Active Architecture Minimum Gate

A change may be called PROVEN for active architecture only when all applicable items are true:

- It names the exact command(s) run.
- It names the environment if DB, signing keys, or OS-specific behavior matters.
- It does not depend on a quarantined package being green unless that package is being repaired.
- It does not hide failed tests by removing them from a lane without a classification reason.
- It does not treat DB-auth failure as product behavior.

## Current Interpretation

`mps-legal-corpus` is PROVEN v1 for its own gate and for collateral impact on the compliance
configuration. The normal full suite remains BLOCKED because the local integration setup cannot
authenticate as `riskguard`, and the current compliance lane contains pre-existing LU, CAS,
artifact-store, event-compliance, and governed-write failures.

Therefore the next architecture step is not to weaken proof discipline. The next step is to freeze
classification and then split proof lanes so active architecture can be proven independently from
quarantined diagnostic debt.
