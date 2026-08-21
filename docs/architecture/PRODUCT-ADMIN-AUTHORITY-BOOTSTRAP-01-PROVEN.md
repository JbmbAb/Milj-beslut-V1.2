# PRODUCT-ADMIN-AUTHORITY-BOOTSTRAP-01 — IMPLEMENTED / PROVEN

**Status:** IMPLEMENTED / PROVEN. Closes the auth/authority gap discovered while assessing
`PRODUCT-LU-OWNER-PROVISIONING-01`: BankID proves identity; before this unit, nothing in the
codebase proved *authority* to hold product ADMIN role.

```
BankID establishes identity
!=
BankID grants ADMIN authority
```

## Scope, as approved

Not LU, not legal-answer. A separate platform authority boundary, closed once, explicitly. Does
**not** touch LU, does not use mock BankID, does not create users via SQL, does not run the LU
owner bootstrap, does not create the real BankID owner, does not touch ViewerCapability or
product-release authority.

## Phase 1 — read-only trace (reproduced live in the proof script)

Traced `BankID auth -> User creation/resolution -> role evaluation -> requireAuth/ADMIN checks`:

- `collectBankIdAuth()` (`server/services/bankIdService.ts`) -> `resolveAuthUser()` ->
  `findAuthUserByBankId()` / `ensureMockAuthUser()` (`server/repositories/userRepository.ts`).
  `ensureMockAuthUser` writes `role` directly from `BANKID_MOCK_USER_ROLE` (default `ADMIN`) at
  user-creation time — identity resolution and role assignment are the same write.
- `ensureAdminConsoleUser()` (same file) — the username/password admin-console login
  (`POST /api/admin/auth/login`) — writes `role: 'ADMIN'` unconditionally, with
  `bankidId = "admin:" + username`, a **synthetic**, non-BankID identity string. This is the
  identity every prior proof script in this whole track has authenticated as.
- `orgInvitationService.acceptInvitation()` — a third, independent write site: creates a `User`
  with `role: invite.role === 'ADMIN' ? 'ADMIN' : 'CONSULTANT'` at invitation-acceptance time.
- Every `requireAuth`-gated ADMIN route (`server/routes/admin.routes.ts` and others) checks
  `req.authUser.role !== 'ADMIN'` directly against the JWT claim. `requireAuth`
  (`server/security/auth.ts`) only verifies the JWT signature and checks token revocation — it
  never consults any authorization/grant record. Confirmed live: `requireAuth() consults any
  grant record: NO`.

**Conclusion, confirmed:** no legitimate grant/authority model existed anywhere in the codebase
before this unit. Three independent, uncoordinated code paths wrote `User.role = 'ADMIN'`
directly, none gated by a separate authorization decision. No existing artifact/issuer model
(`ProjectContextBindingIssuerArtifact`, LU execution-authority) was scoped to this concern — per
instruction, this justified proceeding to implementation rather than reusing one of them.

## What was built

**`AdminRoleGrantArtifact`** (`packages/mps-compliance/src/artifacts/AdminRoleGrantArtifact.ts`) —
immutable, content-addressed, Ed25519-attested grant:

```
subject_user_id, subject_bankid_id, granted_role="ADMIN"
issuer_ref, issuer_key_id, authority_scope="PRODUCT_ADMIN_ROLE_GRANT_V1"
issued_at, contract_version="admin-role-grant-v1"
content_hash, artifact_id, attestation (ArtifactAttestation: signer, signature, subjectDigest)
```

`authority_scope`, `granted_role`, and disqualified-subject rejection (`admin:*`, `mock-*`) are
baked into the canonical identity payload itself (`adminRoleGrantIdentityPayload`) — a grant with
the wrong scope, wrong role, or a synthetic subject cannot be constructed at all, let alone
signed; there is no separate field an issuer could omit or a caller could bypass.

**`AdminRoleGrantIssuerArtifact`** (`AdminRoleGrantIssuerArtifact.ts`) — issuer-purpose artifact,
`issuer_purpose = "PRODUCT_ADMIN_ROLE_ISSUER_V1"`, `allowed_artifact_types = ["admin_role_grant"]`.
A dedicated purpose, not reused from `PROJECT_CONTEXT_BINDING_ISSUER_V1`, the viewer-capability
issuer, or any dataset admission signer.

**Dedicated Ed25519 key, split by capability** (mirrors the existing
`LU_EXECUTION_AUTHORITY_*` / `LuExecutionAuthorityVerifier` pattern exactly):

- `server/security/adminRoleGrantSigningKey.ts` — the **only** place in the codebase holding
  `ADMIN_ROLE_ISSUER_PRIVATE_KEY_PEM`. Not imported by any runtime enforcement path.
- `server/security/adminRoleGrantVerifier.ts` — reads only `ADMIN_ROLE_ISSUER_PUBLIC_KEY_PEM`.
  Its return type, `VerificationKeyProvider`, has no `sign` method at all — verification is
  structurally unable to mint a grant, not merely convention-bound not to.

**`server/services/adminRoleGrantService.ts`**:

- `mintAdminRoleGrant()` — the only issuance path. Rejects `admin:*`/`mock-*` subjects before
  ever calling the signer. No HTTP route in this unit exposes issuance — it is an explicit,
  owner-run script operation, never a self-service "become admin" endpoint.
- `verifyAdminRoleGrant()` — structural validation, attestation/signature verification against
  the trusted public key, scope check, and (when an expected subject is supplied) subject/BankID
  binding check. Uses only the verification-only provider.
- `applyAdminRoleGrant()` — verifies, then and only then sets `User.role = 'ADMIN'`. The sole
  grant-based write path; `ensureAdminConsoleUser`/`ensureMockAuthUser`/`acceptInvitation` are
  untouched — they remain what they always were (dev/ops or invitation-time assignment), not
  reclassified as product ADMIN authority.
- A minimal, dedicated, content-addressed WORM store (`.data/admin-role-grants/<sha256>.json`) —
  built self-contained rather than wiring in the unrelated, not-integrated `mps-cas-boundary`
  package (confirmed via tsconfig path-mapping check: never wired into this app's module
  resolution) or the heavier `mps-artifact-store` generic repository, neither of which this
  single-artifact-type unit's persistence need warranted pulling in.

## Required negative proofs — all executed live, real DB, real Ed25519 keys

`scripts/db/product-admin-authority-bootstrap-01.ts`, live run:

| Required proof | Result |
|---|---|
| real BankID user + valid grant → ADMIN | **PASS** — `User.role` → `ADMIN` in DB; `GET /api/admin/app-status` with the resulting JWT → `200` |
| real BankID user without grant → NOT ADMIN | **PASS** — same user pre-grant → `403` |
| wrong subject → FAIL CLOSED | **PASS** |
| wrong bankid binding → FAIL CLOSED | **PASS** |
| unsigned grant → FAIL CLOSED | **PASS** |
| tampered grant → FAIL CLOSED | **PASS** (content_hash / canonical identity mismatch) |
| unknown issuer → FAIL CLOSED | **PASS** (signed with a different Ed25519 key; `attestation.signer` mismatch) |
| issuer with wrong scope → FAIL CLOSED | **PASS** (rejected at canonical construction — scope is embedded in identity, not a separate checkable field) |
| `admin:<username>` → not accepted as BankID owner | **PASS** — rejected at issuance against the live admin-console `User` row |
| `mock-bankid-*` → not accepted for product proof | **PASS** |
| direct caller-selected ADMIN role → FAIL CLOSED | **PASS** (a hand-built, unsigned "grant" object is rejected identically to any other structurally invalid artifact) |
| fresh reopen with public key only → PASS | **PASS** — a genuinely separate `tsx` child process, launched with only `ADMIN_ROLE_ISSUER_PUBLIC_KEY_PEM` set, read the grant back from disk by CAS hash and verified it successfully |
| private key absent during reopen → PASS | **PASS** — child process confirmed `ADMIN_ROLE_ISSUER_PRIVATE_KEY_PEM` absent from its own env; `adminRoleGrantVerifier.ts` confirmed to have no real import of `adminRoleGrantSigningKey.ts` (grepped for the actual import-statement shape, not a substring, after the earlier grep-precision lesson resurfaced a false positive on this file's own docstring) |

`ALL PROOFS PASS: true`. Full script output captured in this session's run; the one test-fixture
`User` row created (`bankidId="199001019876"`, a proof fixture representing "a User row as it
would exist after real BankID auth", *not* the real product owner) was reverted from `ADMIN` back
to `CONSULTANT` at the end of the run — the durable proof is the grant artifact and its CAS
record, not a live stray ADMIN account.

## Verification

- `npx tsc --noEmit`: zero new errors attributable to any file in this unit (98 pre-existing
  errors, all in concurrent-session LU/Topo10 files this unit never touched).
- `npx vitest run --project unit`: 167 passed, 0 new failures. Two failures
  (`dbAnalysis.test.ts`, `searchInfo.test.ts`) are a pre-existing, unrelated filesystem issue in
  `packages/mimers-brunn-core/src/cas/FileCASRepository.ts` (`.data/mimers/cas` tmp/objects not
  on the same filesystem link target) — a different CAS implementation than this unit's, in files
  this unit never touched.

## What this does not claim

- Does not create, authenticate, or grant ADMIN to the real product owner. That is the explicit
  next step, gated on this unit.
- Does not run `PRODUCT-LU-OWNER-PROVISIONING-01`.
- Does not touch `ViewerCapability` or product-release signing authority.
- Does not lock down `ensureAdminConsoleUser`/`ensureMockAuthUser`/`acceptInvitation`'s existing
  ADMIN-writing behavior — those remain live, unchanged dev/ops and invitation paths. This unit
  adds the legitimate grant mechanism; it does not remove the pre-existing ones. If the owner
  later wants those closed off too, that is a separate, explicit decision.

## Closure

```
PRODUCT-ADMIN-AUTHORITY-BOOTSTRAP-01
IMPLEMENTED / PROVEN
```

Next: the real product owner authenticates via a genuine BankID auth flow (not mock), an
`AdminRoleGrant` is issued and applied to that resulting `User` via this mechanism, and only then
does `PRODUCT-LU-OWNER-PROVISIONING-01` run — with real authority provenance instead of
`admin:<username>`.
