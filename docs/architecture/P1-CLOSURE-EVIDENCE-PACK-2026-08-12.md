# P1 Closure Evidence Pack — 2026-08-12

Status: READY_FOR_TOR_REVIEW
Program node: P1 — Authority & governance convergence
Scope: evidence pack only; no runtime architecture changes authorized by this document.

This pack collects the executed evidence needed for P1 closure review. It does not mark P1
`CLOSED`; that remains an owner/review decision after the normative artifacts are tracked and
reproducible.

## Closure Rule

P1 may be marked `CLOSED` only if all of the following are true:

1. Contract closure = `SATISFIED`.
2. Enforcement boundary = `PROVEN`.
3. Runtime authority convergence = `PROVEN_FOR_KNOWN_P1_SURFACES`.
4. Normative authority/proof artifacts are tracked and reproducible.
5. Closure regression remains green.
6. Closure review confirms no documented P1 classification blocker remains open.

## Current P1 Status

```text
P1 contract closure                    SATISFIED
P1 enforcement proof                   PROVEN
P1 runtime authority convergence       PROVEN_FOR_KNOWN_P1_SURFACES
P1 proof-registry integrity            RESTORED_PENDING_TOR_REVIEW
P1 reproducible release authority      STAGED_PENDING_COMMIT_AND_OWNER
P1 overall                             READY_FOR_CLOSURE_REVIEW
```

## Executed Evidence

| Surface | Red proof | Green/scoping proof | Status |
|---|---|---|---|
| A1 LU local promotion capability | `packages/mps-lu/tests/A1AuthorityBypass.red.test.ts.historical` | `packages/mps-lu/tests/A1AuthorityEnforcement.test.ts` | `PROVEN / CLOSED_FOR_P1` |
| SR1 Loke SourceRegistry parallel authority | `tests/unit/import/SR1SourceRegistryParallelAuthority.red.test.ts.historical` | `tests/unit/import/SR1SourceRegistryAuthorityEnforcement.test.ts` | `PROVEN / CLOSED_FOR_P1` |
| Domstol RSS route/source authority | `tests/unit/legalDomstolRssAuthority.red.test.ts.historical` | `tests/unit/legalDomstolRssAuthorityEnforcement.test.ts` | `PROVEN_FIXED / CLOSED_FOR_P1` |
| Property lookup fallback writes | expected-red first run of `tests/unit/propertyLookupFallbackAuthorityEnforcement.test.ts` | same test green after fallback removal | `PROVEN_FIXED / CLOSED_FOR_P1` |
| Open datasource sync | not authority-bearing after classification | `tests/unit/gisRoutes.test.ts` route-policy proof | `CLASSIFIED_NON_AUTHORITY / ROUTE_POLICY_FIXED` |
| Sync-manifest | classified project operational indexing | `tests/unit/searchRoutes.test.ts` guardrail proof | `CLASSIFIED_PROJECT_INDEXING / GUARDED` |

## Closure Regression

Command:

```bash
npx vitest run packages/mps-lu/tests/A1AuthorityEnforcement.test.ts tests/unit/import/SR1SourceRegistryAuthorityEnforcement.test.ts tests/unit/import/sourceRegistry.test.ts tests/unit/import/lokeHarvest.test.ts tests/unit/import/lokeScheduler.test.ts tests/unit/gisRoutes.test.ts tests/unit/searchRoutes.test.ts tests/unit/legalDomstolRssAuthorityEnforcement.test.ts tests/unit/domstolRssService.test.ts tests/unit/propertyLookupFallbackAuthorityEnforcement.test.ts tests/unit/propertyUnitService.test.ts tests/unit/server.security.projectAccess.test.ts
```

Latest local result:

```text
Executed 2026-08-12 21:37 local workspace
Test Files  12 passed (12)
Tests       93 passed (93)
```

## Negative Stale Checks

The following checks were run after C-P1-04:

```bash
rg -n "property lookup fallback remains|property fallback open|P1 remains open on property|Domstol RSS \\+ property|P1 overall\\s+OPEN|Varför P1 inte får stängas nu|not yet proven" docs/architecture/architecture-authority-map.jsonc docs/architecture/PROGRAM-P0-P8-AUTHORITY-2026-08-11.md
```

Result: no matches.

```bash
rg -n "INSERT INTO core\\.property_unit|INSERT INTO env\\.|documentRecord\\.create|documentContent\\.create|Mimers Brunn Harvester|harvested-test-key|ny-skördad|Kunde inte läsa ny" server/services/propertyUnitService.ts
```

Result: no matches.

## JSONC Parser Sanity

```text
JSONC parser sanity: PASS
tool: jsonc-parser@3.3.1
execution: temporary npm prefix outside the workspace; no dependency change
```

The authority map has now been validated with a real JSONC parser.

Preflight detail:

```text
initial local require: jsonc-parser not found
temporary parser install outside workspace: PASS
strip-json-comments: found, but not used as JSONC parser sanity
```

Support-only proof-registry text sanity:

```text
checked: "file" + "exists" claims in architecture-authority-map.jsonc
result: no claimed exists=true file mismatches found
note: support-only text scan, not JSONC parser validation
```

## Reproducibility Status Before P1 CLOSED

These artifacts are now staged in the index and reviewed for P1 scope. They must still be committed
before they can act as reproducible release authority from repo history:

```text
docs/architecture/architecture-authority-map.jsonc
docs/architecture/PROGRAM-P0-P8-AUTHORITY-2026-08-11.md
docs/architecture/P1-CLOSURE-EVIDENCE-PACK-2026-08-12.md
packages/mps-lu/tests/A1AuthorityEnforcement.test.ts
tests/unit/import/SR1SourceRegistryAuthorityEnforcement.test.ts
tests/unit/legalDomstolRssAuthorityEnforcement.test.ts
tests/unit/propertyLookupFallbackAuthorityEnforcement.test.ts
```

Scope preflight:

```text
git diff --cached --check: PASS
unrelated staged eval deletions: removed from index, worktree content not reverted
closure regression after staging: 12 files / 93 tests PASS
```

Tor/review must still decide whether any additional frozen/active authority documents referenced by
the program authority belong in the same release set.

## Proof Registry Integrity

Finding:

```text
finding_id: AUTHORITY_MAP_NONEXISTENT_REQUIRED_PROOF
status: RESOLVED_STALE_REFERENCE_REMOVED
affected_entry: lu-local-quarantine-promoter
claimed_required_proof: tests/unit/architectureAuthorityMap.test.ts
actual_state:
  file_exists: false
  executable: false
  lane_reachable: false
```

Resolution:

The false `required_proof` reference was removed from
`docs/architecture/architecture-authority-map.jsonc`. It was not replaced by a new empty test. The
removed reference was marked `INVENTORY_ONLY`, so the A1 proof status now rests only on the real
red/green proofs:

```text
packages/mps-lu/tests/A1AuthorityBypass.red.test.ts.historical
packages/mps-lu/tests/A1AuthorityEnforcement.test.ts
packages/mps-lu/tests/LokeIngestion.test.ts
```

This does not invalidate:

```text
A1 historical red proof
A1 enforcement green proof
SR1 proof
Domstol RSS proof
property fallback proof
```

Tor/review still needs to confirm the proof-registry diff before P1 is marked `CLOSED`.

## Remaining Known Broken Or Unproven Items

The following are not counted as closed by this pack:

| Item | Current meaning | P1 closure impact |
|---|---|---|
| `packages/mps-governance/tests/ADR23Compliance.test.ts` | File exists, but authority map records no matching Vitest lane. | P8/proof-lane blocker, not a known live P1 runtime authority path. |
| `loke-scheduler-import-side-effect` | `KNOWN_BROKEN` runtime lifecycle issue now classified under P7/HM-P. SR1-green proves this is not a competing source-authority blocker for P1. | No P1 closure impact after reclassification; still blocks HM-P. |
| `spatial-presentation-evidence-boundary` | Presentation/evidence boundary defect. | P4/HM-P issue; not an authority-source convergence blocker unless owner classifies it into P1. |

## Recommended Review Outcome

Tor preflight recommendation:

```text
CLOSE_PENDING_COMMIT_AND_OWNER
```

If the staged P1 set is committed without scope changes and owner accepts the closure evidence,
owner can mark:

```text
P1 contract closure                    SATISFIED
P1 enforcement proof                   PROVEN
P1 runtime authority convergence       PROVEN_FOR_KNOWN_P1_SURFACES
P1 proof-registry integrity            RESTORED
P1 reproducible release authority      SATISFIED
P1 overall                             CLOSED
```

Until then:

```text
P1 overall                             READY_FOR_CLOSURE_REVIEW
LU gate                                NOT_RELEASED
Codex next lane                        closure guardrail after tracking, then P8 proof fabric
Opus next lane                         wait for LU gate, then F4A
```
