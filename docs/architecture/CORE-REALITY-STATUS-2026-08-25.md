# Core Reality Status - 2026-08-25

> **Descriptive, not normative.** This is a frozen status snapshot, not an
> architecture authority. If it disagrees with canonical code, committed history, or
> executed proof, those sources win.

## Canonical Snapshot

```text
CANONICAL HEAD
95642c71e93b07a76a192a522f4a50ac55b1e68f
```

## Closed / Proven

| Area | Status | Canonical commit | Proof / independent reproving | Notes |
| --- | --- | --- | --- | --- |
| H4/H9 assessment currentness | PROVEN | `2f0af18a` | focused currentness regression | Zero, one, or multiple distinct eligible assessments resolve to none, current, or fail-closed ambiguity. Projection timestamps are not authority. |
| ViewerCapability currentness | PROVEN | `2f0af18a` | focused currentness/viewer regression | Currentness is derived from the exact verified subject; duplicate requests for one capability are deduplicated and distinct valid capabilities fail closed. |
| Destructive DB safety boundary | PROVEN | `9d375bdb` | `36/36` focused | A destructive test-DB operation requires an explicit disposable target before the first client is created. |
| Provisioning queue lease reclaim | PROVEN | `0b29818e` | `37/37` focused | Four governed queues reclaim expired leases only with observed-generation compare-and-set semantics. |
| A1 CAS live read integrity | PROVEN | `2b93ae4f` | backend, route, sync-reader, and replay proofs | Live CAS choke points verify content-addressed bytes before parsing or returning them. |
| ProductRelease resolver convergence | PROVEN | `95642c7` | `13/13` focused | Governed ops callers use `resolveCanonicalProductRelease`; `PRODUCT_RELEASE_ARTIFACT_ID` is required and no default resolver remains. |

## Independently Reproven

```text
A1 CAS read integrity
replay isolation
assessment and ViewerCapability currentness
```

The executable proofs named above remain the evidence. This section records that these
claims were rechecked while converging the current canonical state; it does not replace
their test suites or historical proof records.

## Open / Next

```text
- Claim 14 presentation/projection fact boundary
- C1 root-of-trust bootstrap reproducibility
- targeted core re-audit
- final LU PRODUCT-PROVEN authenticated end-to-end proof
```

## Known Debt

```text
- assessment duplicate-row defensive dedupe: latent, non-load-bearing hardening
- FileCASRepository verify-by-default: hardening only
- localizationGeometryProductProofs: baseline/environment drift; not an A3 semantic regression
- shared checkout dirty state: outside this canonical audit target
```

## Verification Boundary

The focused A3 proof at this snapshot is green. Broader product tests that require Prisma
credentials remain `BLOCKED_BY_ENVIRONMENT` when no disposable or configured test database is
available; that condition is not a green result and is not represented as one here.
