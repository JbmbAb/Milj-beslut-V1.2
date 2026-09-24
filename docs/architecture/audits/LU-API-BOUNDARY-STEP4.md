# LU-API-BOUNDARY-STEP4 â€” CANDIDATE

**Status:** CANDIDATE / NOT YET PROVEN
**Frozen base:** `70dbb4c66ca7ba4d662a54aa3e384b69349a2bd9`
**Implementation commit:** `321842c532c64e1f2edbcfec54582582b0f7df76`
**Unit:** `LU-API-BOUNDARY-STEP4-V1`

## Purpose

Step 4 of the frozen DEV-GOV optimization sequence: **export snapshot + import rule**.

This unit freezes the existing LU package boundary without changing runtime behavior or creating new
authority. Future product work must not silently widen `@miljobeslut/mps-lu` or add a new
production import into LU internals.

## Frozen claim

- The exact TypeScript-visible package-root export surface is snapshotted.
- TypeScript symbol resolution follows existing `export *` chains, so a transitive new export is
  detected even if `packages/mps-lu/src/index.ts` itself is unchanged.
- Production code cannot add a new deep import into `packages/mps-lu/src/**` or
  `@miljobeslut/mps-lu/**` below the root.
- The eight pre-existing production deep imports are grandfathered by exact file + specifier pair.
- Removing one of those eight also creates drift, forcing the baseline to shrink explicitly.
- `LURuleEngine`, `createLuRuleEngineInvokeHandler`, and `runLuAssessmentViaKernel` remain
  forbidden package-root exports.

## Frozen snapshot

The base exposes **268 public symbols** and contains **8 production deep imports**:

1. `packages/document-provider/src/MockDocumentProvider.ts` â†’ `../../mps-lu/src/domain/CanonicalGeometry`
2. `packages/document-provider/src/MockDocumentProvider.ts` â†’ `../../mps-lu/src/domain/DocumentDescriptor`
3. `packages/document-provider/src/MockDocumentProvider.ts` â†’ `../../mps-lu/src/providers/DocumentProviderContract`
4. `server/modules/localization/luExecutionIdentityV3Provisioning.ts` â†’ `../../../packages/mps-lu/src/execution/ExecutionIdentityAttestation`
5. `server/modules/localization/luExecutionIdentityV3Provisioning.ts` â†’ `../../../packages/mps-lu/src/execution/LuExecutionAuthorityVerifier`
6. `server/modules/localization/luExecutionIdentityV3Provisioning.ts` â†’ `../../../packages/mps-lu/src/execution/LuExecutionIdentityIssuer`
7. `server/modules/localization/luExecutionIdentityV3VerifyCli.ts` â†’ `../../../packages/mps-lu/src/execution/ExecutionIdentityAttestation`
8. `server/modules/localization/luExecutionIdentityV3VerifyCli.ts` â†’ `../../../packages/mps-lu/src/execution/LuExecutionAuthorityVerifier`

These are legacy exceptions, not endorsements. This unit prevents expansion; it does not migrate
them.

## Implementation

Frozen implementation `321842c532c64e1f2edbcfec54582582b0f7df76` adds exactly:

- `packages/mps-lu/api-boundary.snapshot.json`
- `scripts/dev-helpers/lib/luApiBoundary.mjs`
- `tests/unit/luApiBoundaryStep4.test.ts`

The helper is advisory and emits `authoritative: false`.

Production scanning uses the TypeScript AST over `src`, `server`, `components`, `services`,
`packages` and `integrations`, excluding the LU package itself, tests, fixtures, node_modules and
build output. Tests and ops scripts are intentionally outside this production boundary.

## Local verification

- boundary evaluator: PASS (268 exports, 8 deep imports, zero drift, zero forbidden exports)
- focused tests: **6/6 PASS**
- transitive `export *` mutation is detected
- new production deep-import fixture is detected
- comment/string fixtures do not create false positives
- root package import remains allowed
- added and removed snapshot entries are both drift
- targeted Prettier: PASS
- `git diff --check`: PASS
- typecheck differential: base 87 errors, candidate 87 errors, **0 new / 0 removed**

The typecheck comparison used `8a9b7464â€¦` as the code baseline; the only changes from that commit
to frozen base `70dbb4c6â€¦` are the two Step-3 PROVEN documentation/governance files.

## RED

The RED is deliberately absence-style because the new semantic property is the boundary artifact
itself. It first verifies the existing LU package root and
`runCanonicalLuProductAssessment` as a positive control. Only then does complete absence of the
three new boundary artifacts count as the expected semantic failure (exit 1). Partial/missing
harness state exits 2 and is blocked.

## GREEN

The exact candidate must pass:

1. boundary-artifact presence;
2. standalone boundary evaluator;
3. all six focused tests;
4. targeted Prettier for the three implementation files.

## Non-claims

This unit does not:

- remove or bless the eight grandfathered deep imports;
- change LU runtime, evidence, rules, authority, CAS or persistence semantics;
- add a package.json `exports` map or claim Node loader enforcement;
- govern other package APIs;
- forbid internal imports inside `packages/mps-lu`;
- forbid tests/ops/proof scripts from deliberate internal access;
- make a snapshot amendment automatically legitimate;
- change `scripts/devgov/**`, workflows, schema, signer or trust policy;
- make the helper authoritative or create a new trust root.

## Finalization

This record remains CANDIDATE until the exact packaged candidate receives
`DEV-GOV-V0 / trusted-execution = success`, is merged with a merge commit pinned to that SHA,
merge-tree equality is verified, and a separate PROVEN record is admitted.
