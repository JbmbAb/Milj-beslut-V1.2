# MINIMUM-AUTHORITY-DELTA-03B — Existing Authority Convergence

**Status:** IMPLEMENTED / UNPROVEN  
**Base:** MINIMUM-AUTHORITY-DELTA-03A @ `a7fb96626a7a3024c78241ba9416d722af862a3c`

## Purpose

Converge the generic ADR-24-21 authority model with authority/identity chains that were already
proved in LU and Product Admin work. This delta MUST reuse those proofs. It MUST NOT create a
parallel root of trust, reinterpret an authority grant as identity, or broaden an existing issuer key.

## Existing PROVEN sources

### LU execution authority

`LU-EXECUTION-AUTHORITY-BOOTSTRAP-01-PROVEN.md` already proves:

```
owner-provisioned LU execution root
  -> delegated LU execution issuer
  -> signed/canonical ExecutionIdentityArtifact
  -> exact actor_ref + capability_ref + release/context subject
  -> RuntimeAdmissionKernel
  -> admitted real LU execution
```

The golden-path proof further exercised this through the real CAS/DB/product path.

### Product Admin authority

`PRODUCT-ADMIN-AUTHORITY-BOOTSTRAP-01-PROVEN.md` already proves:

```
BankID-authenticated User
  -> signed AdminRoleGrantArtifact
  -> exact user + BankID subject binding
  -> verified grant
  -> ADMIN materialization
  -> protected route
```

This is authority evidence. It is NOT canonical human identity.

### Viewer authority

`ViewerIdentityArtifact` explicitly identifies the presentation/runtime component, not a human
user. It MUST NOT be reused as HumanIdentityArtifact.

## Mechanical convergence map

| Existing source | Generic ADR-24-21 concept | 03B decision |
|---|---|---|
| authenticated User + exact persisted BankID subject | HumanIdentityArtifact | IMPLEMENT missing frozen artifact + deterministic bridge |
| AdminRoleGrantArtifact | capability/role authority evidence | REUSE AS SOURCE EVIDENCE; MUST NOT become identity |
| LU_EXECUTION_PRINCIPAL_ID | ServiceIdentityArtifact | IMPLEMENT missing frozen artifact |
| verified LU ExecutionIdentityArtifact | binding of LU logical principal + capability + execution subject | REUSE; map to ServiceIdentity only after existing crypto verification |
| LuExecutionAuthorityRootArtifact | trust-root source evidence | REUSE SEMANTICS; do not widen root key purpose |
| LuExecutionAuthorityIssuerArtifact | delegated issuer source evidence | REUSE SEMANTICS; do not widen issuer key purpose |
| ViewerIdentityArtifact | governed presentation service identity | NOT a human identity; separate existing service/runtime identity |
| ProductViewerCapabilityArtifact | presentation capability evidence | REUSE IN ITS OWN DOMAIN; not a human capability grant |

## Key-scope STOP conditions

### STOP-1 — Admin grant is not identity

`AdminRoleGrantArtifact` contains role, issuer, scope and `issued_at`. Using it as
`ActorArtifact.identity_ref` would make actor identity change when authorization changes and would
violate ADR-24-21 identity stability.

### STOP-2 — ViewerIdentity is not human identity

Its own contract explicitly says it identifies the presentation/runtime component and not a user.

### STOP-3 — Existing private keys must not gain new artifact authority

The LU root/issuer is scoped to LU execution authority / `execution_identity`.
The Product Admin issuer is scoped to `admin_role_grant`.

03B does not use either key to sign ActorArtifact, HumanIdentityArtifact, ServiceIdentityArtifact,
CapabilityGrantArtifact or TrustDelegationArtifact. Doing so would silently broaden issuer purpose.

### STOP-4 — Identity is not authorization

The new identity constructors contain no role, capability, trust-domain, issuer, validity window or
runtime session. Identity existence alone therefore cannot satisfy `verifyAuthorityAtDecisionTime`.

## Implemented in 03B

### HumanIdentityArtifact

`packages/mps-governance/src/actors/IdentityArtifacts.ts`

- implements the already-frozen ADR-24-21 HumanIdentityArtifact concept;
- derives a deterministic domain-separated SHA-256 fingerprint from an authenticated BankID subject;
- never persists the raw BankID subject in the canonical artifact;
- contains no role or authority semantics;
- canonical artifact id/content hash are deterministic;
- validation recomputes and fail-closes on mutation.

### ServiceIdentityArtifact

Same file:

- implements the already-frozen ADR-24-21 ServiceIdentityArtifact concept;
- identifies a stable logical service principal;
- intentionally excludes issuer/root/key/process/session state so key rotation does not change identity.

### Authenticated principal bridge

`server/security/canonicalAuthorityIdentity.ts`

```
requireAuth AuthUser
  -> resolve current User row
  -> exact user-id equality
  -> exact BankID-subject equality
  -> reject admin:/mock-* synthetic identities
  -> deterministic HumanIdentityArtifact
```

Role and organisation are deliberately ignored by this bridge because they are authorization state.

### LU service bridge

`packages/mps-lu/src/execution/LuCanonicalServiceIdentity.ts`

Consumes only an `ExecutionIdentityVerificationResult`.

```
verifyExecutionIdentityAttestation(...).verified === true
  -> exact actor_ref == LU_EXECUTION_PRINCIPAL_ID
  -> deterministic ServiceIdentityArtifact("mimer.lu", LU_EXECUTION_PRINCIPAL_ID)
```

It does not reimplement crypto and cannot turn an unverified ExecutionIdentity into canonical
service identity.

## What remains open after this delta

This delta closes:

```
runtime/authenticated principal -> canonical identity
verified LU execution principal -> canonical service identity
```

It deliberately does NOT yet claim:

```
canonical identity -> ActorArtifact provisioning
ActorArtifact -> lifecycle/domain binding
existing AdminRoleGrant -> generic CapabilityGrant equivalence
LU root/issuer -> generic TrustAnchor/TrustDelegation equivalence
persistent generic authority indexes
verifyAuthorityAtDecisionTime on a real production mutation
ADR AuthorityEvidenceArtifact reconciliation
```

Those are the next convergence steps and must reuse the source authority proofs above rather than
minting parallel authority.
