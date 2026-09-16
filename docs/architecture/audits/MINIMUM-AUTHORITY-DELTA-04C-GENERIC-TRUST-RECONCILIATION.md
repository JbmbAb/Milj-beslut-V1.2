# MINIMUM-AUTHORITY-DELTA-04C — Generic Trust Model Reconciliation

**Status:** IMPLEMENTED / UNPROVEN  
**Base:** 04B candidate `e5d261385b9616e695e1e344faa54344e7e75253`  
**Normative source:** ADR-24-21 Actor Identity & Trust Model — Accepted / Frozen

## Purpose

Resolve the four PROVEN 04B compatibility blockers without changing LU's already-PROVEN
cryptographic authority semantics and without fabricating authority.

04C is a representation/conformance reconciliation plus the minimum existing generic authority-runtime adaptation required by the reconciled contracts. It does **not** wire generic authority into an LU production mutation yet.

## Frozen constraints

04C SHALL NOT:

- fabricate a root Actor for LU;
- widen LU root/issuer key purpose;
- treat ServiceIdentity/Actor identity as authorization;
- infer lifecycle state from process/session/key presence;
- replace LU root → issuer → ExecutionIdentity cryptographic verification;
- modify ADR-24-21;
- make Postgres/runtime state authoritative;
- reinterpret an LU source-authority root as an Actor-root delegation graph.

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

`ActorArtifact` now carries `trust_domain_refs[]`, satisfying ACT-21-I3. The set is zero-or-more: an Actor may exist without trust-domain membership; authority evaluation still requires explicit membership in the one selected domain.

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

## Existing generic runtime reconciliation

`mps-governance-runtime/AuthorityVerification.ts` was already a real consumer of the old
Actor/Trust contracts, so leaving it unchanged would make 04C internally inconsistent.

04C therefore reconciles that existing verifier for its **actor-root capability/delegation mode**:

- subject Actor membership uses `trust_domain_refs[]`;
- lifecycle is identity-bound and requires `ACTIVE` at the supplied decision time;
- a root Actor is bound to the domain by TrustAnchor and is not required to be a domain member;
- TrustDomain `anchor_hash` and `authority_scope` are load-bearing;
- TrustDomain `allowed_actor_types` is enforced for the subject Actor;
- TrustAnchor `root_ref/root_hash` replace the old root-actor-only fields.

The existing generic delegation verifier remains actor-root-specific by design. If the selected
TrustAnchor has `root_binding_type = authority_artifact`, it fails closed with:

```text
REJECT_AUTHORITY_ROOT: source-authority root requires AuthorityEvidence source closure
```

This is intentional. LU source authority is represented by AuthorityEvidence in 04C, but wiring
that evidence into a real LU mutation is a later delta.

The root Actor may have zero trust-domain memberships. This is necessary to avoid a
content-addressing cycle:

```text
Actor -> Domain -> Anchor -> Actor
```

The Anchor itself is what binds that root Actor to the domain.

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
9. LU key purpose remains unchanged;
10. existing actor-root governance-runtime verification remains valid under the reconciled contracts;
11. source-authority roots are not silently accepted by the actor-root delegation verifier.

A GREEN 04C proof means **generic trust representation reconciliation is PROVEN for this contract**.
It does not mean production authority convergence is complete.
