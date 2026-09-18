# MINIMUM-AUTHORITY-DELTA-04B — LU / Generic Trust Compatibility Gate

**Status:** BLOCKER IMPLEMENTED / UNPROVEN  
**Base:** DELTA-04A candidate `d3f08076c8408dff9fbb9f9fff510a3f3759a0c0`

## Purpose

Determine whether the already-PROVEN LU execution-authority chain can be losslessly represented by
ADR-24-21's generic Actor/Trust model **without**:

- fabricating a root Actor;
- broadening the LU root/issuer keys;
- turning execution identity into stable actor identity;
- inventing lifecycle state;
- creating a parallel authority path.

04B is a compatibility gate, not an authority implementation.

## Existing source authority that MUST be preserved

```text
LuExecutionAuthorityRootArtifact
  -- root-key signed -->
LuExecutionAuthorityIssuerArtifact
  -- issuer identity / root delegation -->
signed ExecutionIdentityArtifact
  -- exact actor_ref + capability_ref + execution subject -->
LU_EXECUTION_PRINCIPAL_ID
  -- 03B -->
ServiceIdentityArtifact
  -- 04A -->
ActorArtifact projection
```

The source chain is already PROVEN. 04B is forbidden from weakening or replacing it.

## Compatibility result

Current generic code cannot yet carry this source authority losslessly.

### BLOCKER 1 — generic TrustAnchor is narrower than frozen ADR

Frozen ADR-24-21 defines TrustAnchor as the **canonical root of trust within a trust domain**. It does
not require that root itself be an Actor.

Current `TrustAnchorArtifact.ts`, however, closes trust only through:

```text
root_actor_ref
root_actor_hash
```

LU's proven root is a cryptographic `LuExecutionAuthorityRootArtifact`, not an ActorArtifact.
Creating an Actor merely to satisfy these fields would fabricate identity/authority semantics.

**Decision:** STOP. Do not create a synthetic root Actor.

### BLOCKER 2 — TrustDomain implementation is under-specified versus ADR

ADR-24-21 requires a trust domain to define:

```text
scope
constraints
allowed actor types
delegation rules
```

Current `TrustDomainArtifact.ts` contains only:

```text
anchor_ref
domain_name
```

For LU, some of the missing semantics already exist in source authority
(`LU_EXECUTION_AUTHORITY_V1`, allowed artifact type `execution_identity`), but generic code has no
canonical fields in which to preserve them.

**Decision:** STOP. Do not drop source semantics during projection.

### BLOCKER 3 — ActorLifecycle implementation conflicts with frozen ADR

Frozen ADR lifecycle:

```text
CREATED → ACTIVE → SUSPENDED → REVOKED
```

Current TypeScript lifecycle vocabulary:

```text
pending | active | suspended | retired
```

Additionally, the LU source authority contains no canonical ActorLifecycleArtifact that can justify
inventing ACTIVE/REVOKED state.

**Decision:** STOP. Do not infer actor lifecycle from key presence, identity issuance, runtime
admission, or current process state.

### BLOCKER 4 — AuthorityEvidenceArtifact is absent

ADR-24-21 requires exactly one AuthorityEvidenceArtifact for mutation-authority decisions. That is
the natural canonical boundary for binding:

```text
stable ActorArtifact
+
TrustDomain / TrustAnchor
+
context-bound source authority evidence
  (LU root → issuer → ExecutionIdentity)
+
authority-at-decision-time semantics
```

No `AuthorityEvidenceArtifact` implementation exists in `mps-governance` today.

Without it, forcing the LU execution chain into ActorArtifact or TrustDelegationArtifact would mix
stable identity with context-bound authorization state.

**Decision:** STOP. The authority evidence boundary must be reconciled before production trust
convergence.

## What 04B changes

Only:

- executable compatibility proof;
- this audit record;
- dedicated Dev-Gov proof contract.

04B changes **no** authority model implementation and **no** LU production/runtime code.

## Proof target

`packages/mps-compliance/tests/AuthorityTrustCompatibility04B.test.ts`

The proof asserts from current repository artifacts/code that:

1. LU root and issuer are authority artifacts, not actors;
2. generic TrustAnchor currently requires root-actor binding and has no authority-root binding;
3. TrustDomain lacks frozen ADR-required semantics;
4. ActorLifecycle vocabulary differs from the frozen ADR;
5. AuthorityEvidenceArtifact is absent;
6. there are no canonical constructors that could safely materialize the missing graph.

## Required next reconciliation

The minimum next design delta is **not** "make a root actor".

It is:

```text
MINIMUM-AUTHORITY-DELTA-04C — Generic Trust Model Reconciliation
```

04C must decide and prove, without modifying the frozen ADR unless owner-approved:

1. how TrustAnchor represents a cryptographic/source-authority root without requiring a fabricated
   actor;
2. the complete canonical TrustDomain fields required by ADR-24-21;
3. ActorLifecycle vocabulary and transition semantics consistent with the frozen ADR;
4. the canonical AuthorityEvidenceArtifact that binds stable actor identity to context-bound source
   authority at T_decision;
5. replay semantics: authorized at decision time vs authorized now.

Only after those are resolved may LU source authority be projected into the generic model.

## Non-claims

04B does not prove generic trust convergence. It proves the opposite condition precisely:

```text
LU → generic Actor/Trust convergence
= BLOCKED BY EXPLICIT MODEL INCOMPATIBILITIES
```

A GREEN 04B proof means the blocker diagnosis itself is PROVEN, not that production authority is
converged.
