# MINIMUM-AUTHORITY-DELTA-04C — Generic Trust Model Reconciliation

**Status:** IMPLEMENTED / UNPROVEN  
**Base:** 04B candidate `e5d261385b9616e695e1e344faa54344e7e75253`  
**Normative source:** ADR-24-21 Actor Identity & Trust Model — Accepted / Frozen

## Purpose

Resolve the four PROVEN 04B compatibility blockers without changing LU's already-PROVEN
cryptographic authority semantics and without fabricating authority.

04C is a representation/conformance reconciliation. It does **not** wire generic authority into a
production mutation yet.

## Frozen constraints

04C SHALL NOT:

- fabricate a root Actor for LU;
- widen LU root/issuer key purpose;
- treat ServiceIdentity/Actor identity as authorization;
- infer lifecycle state from process/session/key presence;
- replace LU root → issuer → ExecutionIdentity cryptographic verification;
- modify ADR-24-21;
- make Postgres/runtime state authoritative.

## Reconciled model

### 1. TrustAnchor root is generic and hash-bound

ADR-24-21 defines a TrustAnchor as the canonical root of trust, not specifically as an Actor.

`TrustAnchorArtifact` now binds:

```text
root_binding_type = actor | authority_artifact
root_ref
root_hash
```

The binding type is derived from the root artifact. For LU:

```text
TrustAnchorArtifact
  root_ref/hash
      ↓
LuExecutionAuthorityRootArtifact
```

No Actor is synthesized. For a source-authority root, `verification_key_id` is deliberately
forbidden: the source verifier retains exclusive ownership of that key purpose. The generic anchor
records only the exact root artifact reference/hash.

### 2. TrustDomain carries the frozen semantics

`TrustDomainArtifact` now canonically binds:

```text
anchor_ref + anchor_hash
domain_name
authority_scope
constraints[]
allowed_actor_types[]
delegation_rules[]
```

Arrays are canonicalized and duplicate semantics reject fail-closed.

For the LU proof fixture, the domain preserves:

```text
scope = LU_EXECUTION_AUTHORITY_V1
constraint = allowed_artifact_type=execution_identity
constraint = owner_provisioning=OWNER_PROVISIONED
allowed actor type = service
```

### 3. Actor supports multi-domain participation without changing actor identity

`ActorArtifact` now carries `trust_domain_refs[]`, satisfying ACT-21-I3.

The ActorArtifact representation remains immutable/content-addressed and therefore may change when
domain participation or lifecycle evidence changes. The **canonical actor identity** remains the
hash-bound HumanIdentityArtifact/ServiceIdentityArtifact, which stays stable across those
representation changes as required by ACT-21-I9.

Authority is still not part of identity.

### 4. ActorLifecycle matches the frozen lifecycle

The implemented state vocabulary is now exactly:

```text
CREATED → ACTIVE → SUSPENDED → REVOKED
```

Every transition:

- binds the same canonical identity ref/hash;
- references the previous lifecycle artifact;
- requires strictly increasing effective time;
- rejects skipped/reordered transitions.

This provides an immutable lifecycle history without changing canonical Human/Service identity.

### 5. AuthorityEvidenceArtifact is implemented

`AuthorityEvidenceArtifact` is the canonical decision-time authority boundary.

It hash-binds:

```text
ActorArtifact
TrustDomainArtifact
TrustAnchorArtifact
ActorLifecycleArtifact
action
authority_scope
decision_time
authorized_at_decision_time = true
ordered source-authority path
optional TrustDelegation
optional EvaluationProfile
```

For LU the source-authority path may preserve, without reinterpretation:

```text
LuExecutionAuthorityRootArtifact
  → LuExecutionAuthorityIssuerArtifact
  → ExecutionIdentityArtifact
```

The generic artifact does not cryptographically verify that source chain. That remains the
responsibility of the existing LU verifier. Generic AuthorityEvidence records the exact already-
verified artifacts/hashes required to reproduce the authority decision.

## Decision-time vs current authority

04C intentionally stores:

```text
authorized_at_decision_time = true
```

It intentionally does **not** store:

```text
authorized_now
```

A later SUSPENDED/REVOKED lifecycle artifact does not mutate or invalidate historical authority
evidence. Current authority is a later runtime/currentness evaluation and is not allowed to rewrite
T_decision.

## Conformance updates

ACT-21-I3 now validates explicit `trust_domain_refs[]`.

ACT-21-I5 now accepts a hash-bound source-authority root when a domain has no generic
TrustDelegation edges. Generic TrustDelegation traversal still requires an actor-root entry point;
source-authority delegation must remain in the hash-bound AuthorityEvidence source path rather than
being silently recast as Actor delegation.

## Explicit non-claims

04C does NOT yet prove:

- production LU mutation consumes AuthorityEvidenceArtifact;
- Product Admin consumes the generic model;
- persistent currentness/revocation indexing;
- current-authority evaluation;
- TrustDelegation activation/expiration/revocation contract reconciliation;
- all ADR-24-21 invariants end-to-end;
- authority-map promotion.

Those are later deltas.

## Proof target

`packages/mps-compliance/tests/AuthorityGenericTrustReconciliation04C.test.ts`

The focused proof covers:

1. LU cryptographic root → generic TrustAnchor without root Actor;
2. complete canonical TrustDomain semantics;
3. exact lifecycle sequence and stable identity;
4. multi-domain Actor representation;
5. deterministic AuthorityEvidence over LU root→issuer→ExecutionIdentity;
6. historical authority remains valid after later suspension/revocation;
7. wrong authority-path root fails closed;
8. non-ACTIVE decision authority fails closed;
9. LU key purpose remains unchanged.

A GREEN 04C proof means **generic trust representation reconciliation is PROVEN for this contract**.
It does not mean production authority convergence is complete.
