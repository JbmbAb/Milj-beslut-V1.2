# VIEWER-IDENTITY-AUTHORITY-BOOTSTRAP-01 — IMPLEMENTED / PROVEN

**Status:** IMPLEMENTED / PROVEN. Closes `VIEWER_IDENTITY_AUTHORITY_MISSING`
(`VIEWER-CAPABILITY-ISSUER-TRUST-CHAIN-V1-PROVEN.md`). `PRODUCT-LU-VIEWER-AUTHORITY-BOOTSTRAP-01`
step 7 was then resumed and completed in the same run: exactly one real
`ProductViewerCapabilityArtifact` was issued for the LU golden-path project, installed through
the V2-only runtime path, and proven via `ViewerKernel.exportAsGeoJSON` after a fresh reopen
holding only public keys.

## Frozen semantics, as specified

`viewer_identity_ref` identifies the **presentation/runtime component** producing a viewer
projection's provenance — "the governed LU ViewerKernel implementation admitted for release X."
It does not identify a project, property, project-context binding, human user, or
`ViewerCapability` grant. `ViewerIdentityArtifact`'s payload deliberately excludes
`project_id`/`property_id`/`project_context_binding_ref`/`capability_id`/any runtime-local UUID/
any timestamp from identity.

## What was built

`packages/mps-lu/src/artifacts/ViewerIdentityArtifact.ts` — `ViewerIdentityArtifact` (contract
`VIEWER_IDENTITY_V1`, `viewer_kind: LU_CANONICAL_PRESENTATION_VIEWER`, bound to
`product_release_ref`/`product_release_hash`) and `ViewerIdentityIssuerArtifact`
(`VIEWER_IDENTITY_ISSUER_V1`, a **new, dedicated** key — not delegated from or reused from
`VIEWER_CAPABILITY_ISSUER_V1`, since no explicit delegation model exists anywhere else in this
repo between issuer purposes). `createViewerIdentityArtifact`/`createViewerIdentityIssuerArtifact`
plus `validateViewerIdentityArtifact` (recomputes canonical identity/content_hash from the current
payload — see bug fix below).

`server/security/viewerIdentitySigningKey.ts` / `viewerIdentityVerifier.ts` — same split-capability
pattern as every other issuer in this repo: the verifier has no `sign` method at all, never
imports the signing module.

`server/modules/localization/viewerIdentityAuthority.ts` — `attestViewerIdentityIssuerArtifact`,
`verifyViewerIdentityIssuerArtifact`, `attestViewerIdentityArtifact`, and
`verifyViewerIdentityArtifact` (the full runtime chain: resolves the identity AND its issuer from
the real repository, validates canonical identity, verifies the self-signed issuer against the
env-configured trust root, verifies canonical release binding against the real release manifest,
verifies the identity's own signature).

`server/modules/localization/productViewerCapabilityAuthority.ts`'s `verifyProductViewerCapability`
now additionally resolves and independently verifies the real `ViewerIdentityArtifact` referenced
by `viewer_identity_ref` (bound to the same release the capability itself declares) — `ViewerKernel`
provenance now traces to a verified, persisted artifact, never caller text or a fixture.

## Bug found and fixed while proving (not assumed away)

The "tampered identity" negative initially **failed to reject**. Root cause: neither
`ProductViewerCapabilityArtifact` nor the new `ViewerIdentityArtifact` had ever recomputed their
own canonical `content_hash` from the current payload during verification — the existing
(committed) `verifyProductViewerCapability` only checked that the attestation's `predicate`
(a narrow subset: project_id/release_hash/scope) matched, which silently missed tampering of any
field outside that subset (e.g. `valid_from`/`valid_until`, `viewer_identity_ref`). Added
`validateViewerIdentityArtifact`/`validateProductViewerCapabilityArtifact` (recompute-and-compare,
matching the pattern already used by `validateAdminRoleGrantArtifact`/
`validateProjectContextBindingArtifact`) and wired both into their respective verify functions.
This closes a real tamper-detection gap in the previously-committed
`VIEWER-CAPABILITY-ISSUER-TRUST-CHAIN-V1` code, found by testing against real data rather than
assumed correct.

## Required proof — Phase A (ViewerIdentity trust chain), live against the real Mimer CAS

`scripts/db/viewer-identity-authority-bootstrap-01.ts`:

| Required positive | Result |
|---|---|
| deterministic ViewerIdentity identity | **PASS** |
| canonical product release binding | **PASS** — real `product-release-772aceb600c4690777593ea8`, `release_hash` matches exactly |
| signed issuer authority | **PASS** |
| persistent CAS write | **PASS** |
| fresh reopen | **PASS** |
| public-key-only verification | **PASS** |
| private key absent at reopen | **PASS** |
| runtime can resolve exact viewer identity | **PASS** |

| Required negative | Result |
|---|---|
| fixture viewer identity (V1's hardcoded fixture id) | **FAIL CLOSED** — not found in real CAS |
| caller-selected viewer identity (arbitrary unbacked id) | **FAIL CLOSED** |
| wrong product release | **FAIL CLOSED** |
| tampered identity | **FAIL CLOSED** (after the fix above) |
| unsigned identity | **FAIL CLOSED** (rejected at the CAS write boundary itself — a bare/unsigned duplicate cannot even be substituted for an already-signed identity under the same declared identity) |
| unknown issuer | **FAIL CLOSED** |
| wrong issuer scope | **FAIL CLOSED** |

`PHASE A ALL GREEN: true`.

## Phase B — `PRODUCT-LU-VIEWER-AUTHORITY-BOOTSTRAP-01` step 7, resumed and completed

Issued exactly one real `ProductViewerCapabilityArtifact`:

```
project:            cmt2m7bdj0000h0f7uj4jykis
context binding:     project-context-binding-32f1ff68cf89421ac4b75d86
viewer_identity_ref: viewer-identity-191b27239041c6057e14f14d  (the verified artifact from Phase A)
release:             product-release-772aceb600c4690777593ea8
capability scope:    PRESENT_PERSISTED_CANONICAL_LU_RESULTS
valid_from:          2026-08-21T09:14:48.945Z
valid_until:         2027-08-21T09:14:48.946Z (1 year)
```

Installed through `installOwnerIssuedLocalizationViewerCapability` (V2-only path — the old V1
admission gate is never called), persisted to the real Mimer CAS, then a genuinely fresh child
process (only `VIEWER_IDENTITY_ISSUER_PUBLIC_KEY_PEM` and `VIEWER_CAPABILITY_ISSUER_PUBLIC_KEY_PEM`
present, both private keys absent) resolved the full runtime and ran
`ViewerKernel.exportAsGeoJSON` against one clearly-labeled proof-fixture evidence artifact
(`spatial-evidence-VIEWER-IDENTITY-AUTHORITY-BOOTSTRAP-01-PROOF-FIXTURE` — explicitly not real LU
evidence; real evidence binding is `PRODUCT-LU-CONTEXT-AND-EVIDENCE-BINDING-V1`'s job). Exported
GeoJSON feature properties carried the exact verified `viewer_capability_id`, `viewer_release_hash`,
and `viewer_identity_ref` — `PHASE B: ok: true`.

Private keys for both issuers exist only as this run's transient env vars — nothing was written
to the repository.

## Verification

`npx tsc --noEmit`: 98 pre-existing errors, identical file set before and after — zero new errors.
`npx vitest run --project unit` (viewer-scoped): 13/13 pass in
`localizationViewerCapabilityInstall.test.ts`/`localizationViewerRuntime.test.ts` (both extended
with real identity-chain seeding); 3 unrelated pre-existing failures elsewhere in the broader sweep
are the same `.data/mimers/cas` filesystem P-05 issue observed in the prior two units, in files
this unit never touched.

## Closure

```
VIEWER-IDENTITY-AUTHORITY-BOOTSTRAP-01          IMPLEMENTED / PROVEN
PRODUCT-LU-VIEWER-AUTHORITY-BOOTSTRAP-01 step 7  COMPLETED
```

The full viewer-authority chain is now closed end to end:

```
ProductRelease → ViewerIdentity → ViewerCapability issuer
→ project/release/context-scoped capability → V2 installer → ViewerKernel
```

No further authority design is queued. Next work returns to
`PRODUCT-LU-CONTEXT-AND-EVIDENCE-BINDING-V1` (removing `lu-workspace`, `proj-*`, `prop-*`,
`geom-*`, synthetic evidence, and the fixture-viewer from the active product path) — not
authority work.
