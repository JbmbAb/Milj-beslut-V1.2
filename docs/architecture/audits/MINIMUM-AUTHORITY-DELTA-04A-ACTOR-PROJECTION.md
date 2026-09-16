# MINIMUM-AUTHORITY-DELTA-04A — Canonical Actor Projection

**Status:** IMPLEMENTED / UNPROVEN  
**Base:** DELTA-03B1 candidate `e5584d8a087962ce6a9fa6249c11e352b1cab9c5`

## Purpose

Close only the first actor-convergence step left open by DELTA-03B:

```text
canonical HumanIdentityArtifact | ServiceIdentityArtifact
        ↓
deterministic ActorArtifact projection
```

This delta does **not** create or reinterpret authority.

LU already has a PROVEN logical service principal and execution-authority chain. 03B already
converged that logical principal to canonical `ServiceIdentityArtifact("mimer.lu",
"lu.site_assessment.actor")`. 04A therefore adds only the generic ActorArtifact representation
required by ADR-24-21.

## Frozen boundaries

04A MUST NOT:

- mint a new LU trust root or issuer;
- reinterpret `LuExecutionAuthorityRootArtifact` as a generic TrustAnchor;
- reinterpret `LuExecutionAuthorityIssuerArtifact` as a generic TrustDelegation;
- create TrustDomainArtifact or ActorLifecycleArtifact;
- create capability, role, grant or delegation authority;
- sign ActorArtifact with an existing LU/Admin authority key;
- wire generic ActorArtifact into a production mutation path.

Those belong to later convergence deltas.

## Implementation

`packages/mps-governance/src/actors/ActorArtifact.ts` now provides:

- `createActorArtifact(...)`
- `validateActorArtifact(...)`

The constructor:

1. accepts an already-canonical HumanIdentityArtifact or ServiceIdentityArtifact;
2. derives actor kind from the identity type — caller cannot select or escalate kind;
3. pins `identity_ref` and exact `identity_hash`;
4. requires explicit pre-existing `trust_domain_ref` and `lifecycle_ref`;
5. computes deterministic actor id/content hash over the full projection;
6. emits references to identity/domain/lifecycle only;
7. contains no issuer, root, capability, role, grant, delegation or signature semantics.

The validator deterministically recomputes the actor from the claimed canonical identity and fails
closed on id/hash/kind/reference drift.

## Why domain/lifecycle are not created here

The current LU source authority is:

```text
LuExecutionAuthorityRootArtifact
  -> LuExecutionAuthorityIssuerArtifact
  -> signed ExecutionIdentityArtifact
  -> LU_EXECUTION_PRINCIPAL_ID
```

ADR-24-21's generic graph separately models:

```text
TrustAnchorArtifact
  -> TrustDomainArtifact
ActorLifecycleArtifact
ActorArtifact
```

Those are not mechanically identical. In particular, the generic TrustAnchor implementation binds a
root Actor, while the proven LU root is a cryptographic authority-root artifact, not an ActorArtifact.
Inventing a root actor or silently widening the LU root key would create new semantics and violate
03B's STOP conditions.

Therefore 04A requires domain/lifecycle references but does not manufacture them.

## Proof target

`packages/mps-compliance/tests/AuthorityActorProjection.test.ts`

The focused suite proves:

- deterministic LU ServiceIdentity -> ActorArtifact projection given fixed canonical refs;
- actor kind derives from identity type;
- exact identity/domain/lifecycle binding affects canonical actor identity;
- identity-hash tamper fails closed;
- reference tamper fails closed;
- missing domain/lifecycle references fail closed;
- ActorArtifact contains no LU authority scope, capability, grant, issuer or root-key semantics.

## Explicit non-claims after 04A

Even after GREEN, the following remain open:

```text
LU source authority -> generic TrustAnchor/TrustDomain equivalence
LU principal -> real generic ActorLifecycle binding
generic ActorArtifact persistence/indexing
AdminRoleGrant -> generic CapabilityGrant equivalence
generic authority closure on a real production mutation
AuthorityEvidenceArtifact reconciliation
```

The next delta is 04B only if a cold verifier confirms that LU trust-domain/lifecycle semantics can be
mapped without inventing a root actor, broadening key purpose, or creating a parallel authority path.
