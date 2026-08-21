# VIEWER-CAPABILITY-ISSUER-TRUST-CHAIN-V1 — IMPLEMENTED / PROVEN (steps 1-6)

**Status:** Trust chain, split signer/verifier, installer/runtime reconciliation, canonical
release binding, and full proof matrix are IMPLEMENTED / PROVEN. Step 7 (provisioning the real
production `ViewerCapability` for the LU golden-path project) is explicitly **NOT performed** —
see STOP CONDITION below.

## Owner decisions this unit executed

```
VIEWER-CAPABILITY-V2-WORK-OWNERSHIP-RECON-01 → OWNER_UNKNOWN_BUT_FILES_STABLE
ADOPT_EXISTING_VIEWER_V2_WORK
VIEWER-CAPABILITY-V2-CONTRACT-FORK → temporal validity preserved, viewer_identity_ref kept
  distinct from project_context_binding_ref, tests rewritten to V2
```

Concurrency fence held throughout: SHA-256 of every non-edited adopted file was recorded before
starting and re-verified identical immediately before commit; no external mutation occurred.

## What was adopted vs. changed

Adopted (kept, logic preserved): `ViewerCapabilityIssuerArtifact`/`ProductViewerCapabilityArtifact`
core shape and identity/hash pattern, the `VIEWER_CAPABILITY_ISSUER_V1` purpose constant, the
issuer-resolve-then-verify pattern (already closely modeled on the proven
`ProjectContextBindingIssuerArtifact`/`verifyProjectContextBindingArtifactAuthority` pattern).

Changed, with a concrete reason for each:

1. **Split signer/verifier.** `viewerCapabilityIssuerKey.ts` (bundled) → deleted; replaced by
   `server/security/viewerCapabilitySigningKey.ts` (private key, sole holder) and
   `server/security/viewerCapabilityVerifier.ts` (public key only, no `sign` method at all —
   structurally incapable, not just unused).
2. **Self-signed issuer + owner authority ref.** `ViewerCapabilityIssuerArtifact.payload` gained
   `allowed_artifact_type` and `owner_authority_ref`, plus a self-attestation
   (`attestViewerCapabilityIssuerArtifact`/`verifyViewerCapabilityIssuerArtifact`). Possession of
   the private key alone still does not establish trust: the verifier's env-configured
   `issuer_key_id` is the actual root of trust — an issuer self-signed by any other key is
   rejected regardless of internal consistency.
3. **Temporal validity preserved (owner decision, contract-fork item 1).** Added required
   `valid_from`/`valid_until` to `ProductViewerCapabilityArtifact.payload` — they participate in
   the canonical identity/hash, are covered by the attestation signature, and are checked
   fail-closed at both install and resolve time. V2 does not introduce an open-ended grant.
4. **`viewer_identity_ref` kept distinct from `project_context_binding_ref`** (contract-fork
   item 2) — added as its own required, signed field. Not fabricated: see STOP CONDITION.
5. **Capability scope renamed** to `PRESENT_PERSISTED_CANONICAL_LU_RESULTS` per explicit
   instruction (was `PERSISTED_CANONICAL_LU_RESULTS_VIEW_EXPORT`).
6. **Real installer/runtime now use ONLY V2 verification.**
   `installLocalizationViewerCapability.ts` and `createLocalizationViewerRuntime.ts`
   (`LocalizationViewerCapabilityProvider`) call `verifyProductViewerCapability` exclusively; the
   old V1 `admitViewerCapability` structural gate is never invoked from either. `ViewerKernel`
   itself is untouched — the runtime instead projects the verified V2 payload into the
   `ViewerCapabilityArtifact` shape it requires, with every field (including `viewer_identity_ref`
   and the temporal window) carried through faithfully from the verified V2 artifact, nothing
   invented by the adapter.
7. **Canonical release resolution fixed to the real contract.** Initial implementation compared
   against the release manifest's own CAS `content_hash` — live-proof against the real Mimer CAS
   showed the actual "release hash" contract is a separate `release_hash` field on the
   `product_release_manifest` artifact (distinct from its storage content_hash). Corrected in
   `verifyProductViewerCapability` before proving; caught by running against real data, not
   invented reasoning.

## Required positive proof — all executed live against the real Mimer CAS

`scripts/db/viewer-capability-issuer-trust-chain-v1.ts`, run with `MIMERS_ROOT` pointed at the
real `~/.mimers`:

| Required proof | Result |
|---|---|
| signed issuer artifact | **PASS** |
| issuer owner/trust-root verification | **PASS** |
| signer/verifier structurally separated | **PASS** (grep for real import statement, not substring) |
| verifier has no private-key access | **PASS** (`verifier.sign === undefined`) |
| canonical release resolves | **PASS** — resolved the real `product-release-772aceb600c4690777593ea8` from the real CAS, `release_hash.value` matches `772aceb6...` exactly |
| exact project subject | **PASS** — real project `cmt2m7bdj0000h0f7uj4jykis` |
| exact ProjectContextBinding | **PASS** — real `project-context-binding-32f1ff68cf89421ac4b75d86` |
| exact release binding | **PASS** |
| exact presentation scope | **PASS** |
| deterministic capability identity | **PASS** — same inputs built twice produce the same `artifact_id`/`content_hash` |
| real installer invokes V2 verification | **PASS** |
| V1 cannot independently activate viewer | **PASS** (installer contains zero references to `admitViewerCapability`) |
| persistent CAS install | **PASS** — installed into the real Mimer CAS |
| fresh reopen | **PASS** — separate `tsx` child process |
| public-key-only capability verification | **PASS** |
| private viewer key absent at reopen | **PASS** — child process confirmed `VIEWER_CAPABILITY_ISSUER_PRIVATE_KEY_PEM` absent from its own env |

## Required negative proof — all FAIL CLOSED

unsigned issuer, tampered issuer, wrong trust root, mismatched issuer key_id/public key, wrong
issuer purpose, unsigned capability, tampered capability, wrong project, wrong context binding,
wrong release, wrong capability scope, unknown issuer, dev-release-hash substitution, old
unsigned V1 activation attempt — **14/14 FAIL CLOSED**, live run.

Unit-level regression suite (`tests/unit/localizationViewerCapabilityInstall.test.ts`,
`tests/unit/localizationViewerRuntime.test.ts`, rewritten from V1 fixtures to the real V2 chain
per owner decision): **13/13 PASS**, including a real `ViewerKernel.exportAsGeoJSON` run proving
exported provenance carries the exact verified `viewer_identity_ref` and
`project_context_binding_ref` — neither masquerading as the other.

`npx tsc --noEmit`: 98 pre-existing errors, identical file set before and after this unit — zero
new errors from any file this unit touched.

## STOP CONDITION — `VIEWER_IDENTITY_AUTHORITY_MISSING`

Traced V1's `viewer_identity_ref` completely, per instruction, before any real issuance:

- **Type exists**: `ViewerIdentityArtifact` (`packages/mps-compliance/src/artifacts/ViewerIdentityArtifact.ts`)
  — `{viewer_name, internal_subject_id}`, intended to identify "the human/system observer."
- **No constructor function exists anywhere** in the codebase to mint one from a real
  authenticated session, BankID identity, or any other authority object (grepped for
  `internal_subject_id`/`createViewerIdentity` outside the type file itself — the only hit in the
  whole repo is the hardcoded test fixture below).
- **Every concrete value** ever assigned to `viewer_identity_ref` traces to a single hardcoded
  test fixture: `packages/mps-lu/tests/fixtures/admittedViewerCapability.ts`'s
  `VIEWER_IDENTITY` constant (`internal_subject_id: "sso|lu-granskare-1"`, a fake, non-computed
  `content_hash`). Every test that exercises `viewer_identity_ref`
  (`VerticalProof.test.ts`, `P4ALUViewerS6Reconciliation.test.ts`, `F8ViewerCapabilityAdmission.test.ts`)
  imports that same fixture constant.
- **No real `ViewerIdentityArtifact` exists in the real CAS**: grepped `~/.mimers/cas/objects`
  directly for the fixture's hash and for `internal_subject_id` — zero hits.
- `ViewerKernel.exportAsGeoJSON` requires `viewer_identity_ref.artifact_id` to be present but
  never resolves/verifies it against CAS — V1 never actually authenticated this reference either,
  it only asserted presence.

This is exactly the condition the owner specified as disqualifying: *"synthetic, runtime-local,
caller-selected, fixture-derived, or otherwise not a canonical authority object."* Per instruction,
no `ViewerIdentityArtifact` issuance mechanism was invented in this unit. Real capability
provisioning for the LU golden-path project (subject `cmt2m7bdj0000h0f7uj4jykis`) did not proceed.
The proof above used a clearly-labeled placeholder
(`viewer-identity-UNVERIFIED-PLACEHOLDER-do-not-treat-as-real-grant`) solely to exercise the
trust-chain machinery; nothing was written to a production `LU_VIEWER_CAPABILITY_ARTIFACT_ID`
pointer.

**What's needed before step 7 can run:** a real, canonical, persistent authority that issues
`ViewerIdentityArtifact` for an actual authenticated viewer (analogous to how `AdminRoleGrant`
now authorizes ADMIN role, or how BankID + org-invitation establish an ordinary `User`) — this
does not exist yet anywhere in the codebase and is a separate gap, not something to bridge with a
fabricated identity.

## Closure

```
VIEWER-CAPABILITY-ISSUER-TRUST-CHAIN-V1
IMPLEMENTED / PROVEN (steps 1-6)
STOP = VIEWER_IDENTITY_AUTHORITY_MISSING (step 7 not performed)
```

`PRODUCT-LU-VIEWER-AUTHORITY-BOOTSTRAP-01` may resume once a canonical `ViewerIdentityArtifact`
issuance authority exists; at that point capability provisioning becomes exactly: verified issuer
+ verified product release + project/context subject + verified viewer identity → signed
`ProductViewerCapabilityArtifact` → persistent CAS → fresh reopen — using the machinery proven
here.
