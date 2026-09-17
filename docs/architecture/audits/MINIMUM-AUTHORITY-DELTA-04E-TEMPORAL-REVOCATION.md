# MINIMUM-AUTHORITY-DELTA-04E — TEMPORAL QUALIFICATION / REVOCATION

Status: **IMPLEMENTED / UNPROVEN**

Base: `c2c47efaea8cb2fb38055bdd72bc2c0e55422039` (04D-R1 F04 corrected candidate)

## Objective

Close the remaining LU temporal-authority gap without allowing a caller to assert positive
authority and without introducing a process-global exact-attempt authorization pointer.

The canonical LU LocalizationAssessment mutation now requires three linked proof layers:

1. the established cryptographic source chain `LU root -> issuer -> ExecutionIdentity`;
2. the deployment-selected **root-signed issuer lifecycle**, verified against the same root/issuer and
   required to be currently qualified and not effectively revoked;
3. an **issuer-signed exact-attempt authorization ticket** hash-bound to that lifecycle and accepted
   only for the exact verified ExecutionIdentity, canonical execution attempt and
   `lu.localization_assessment.persist` action.

Only after all three layers verify may the LU module mint the process-local historical result:

`authorized_at_decision_time = true`.

`authorized_now` is deliberately not represented or inferred.

## Root-signed issuer lifecycle

Qualification, expiry and revocation are canonical data in the immutable
`lu_execution_authority_lifecycle` artifact, not loose fields supplied to the request path or the
issuer worker.

The lifecycle binds:

- the LU root ref/hash;
- the LU issuer ref/hash;
- the LU authority scope;
- `valid_from` (inclusive);
- `valid_until` (exclusive);
- `revoked_at` (nullable);
- optional `previous_lifecycle_ref` for rotation lineage.

The lifecycle is signed by the **LU root key**. `attestLuExecutionAuthorityLifecycle` rejects any
signer whose key id is not the root key id, and verification rechecks the canonical body, root/issuer
bindings, attestation predicate and root signature.

The runtime selects the lifecycle only through `LU_EXECUTION_AUTHORITY_LIFECYCLE_ID`. Selection does
not confer authority: the selected artifact must still pass root-signature verification and current
qualification/revocation checks. Rotation, renewal or revocation creates a new immutable lifecycle
artifact and deployment changes the lifecycle id pointer.

The lifecycle provisioning operation is intentionally separate from the ordinary issuer worker:

- execute mode requires `LU_EXECUTION_AUTHORITY_ROOT_PRIVATE_KEY_PEM` plus
  `LU_EXECUTION_AUTHORITY_LIFECYCLE_VALID_FROM`,
  `LU_EXECUTION_AUTHORITY_LIFECYCLE_VALID_UNTIL` and optional
  `LU_EXECUTION_AUTHORITY_LIFECYCLE_REVOKED_AT` / previous lifecycle id;
- verify mode refuses to run if either the root private key or issuer private key is available;
- the created lifecycle is root-signed, verified, then persisted before its artifact id is exported
  as `LU_EXECUTION_AUTHORITY_LIFECYCLE_ID`.

The production V3 identity worker therefore does **not** receive caller/deployment validity dates for
each ticket. It requires the issuer private key and `LU_EXECUTION_AUTHORITY_LIFECYCLE_ID`, resolves
and verifies that root-signed lifecycle, and fails closed if lifecycle configuration is absent or the
lifecycle is not currently qualified.

## Exact-attempt identity

For canonical V3 LU execution the attempt reference is derived from the same V3 subject used by the
runtime manifest:

`attempt-${computeExecutionManifestIdV3(subject)}-1`.

The temporal ticket id is deterministically derived from:

- the verified ExecutionIdentity ref;
- that exact attempt ref;
- the verified lifecycle ref;
- the persistence action.

There is no `LU_SOURCE_AUTHORITY_TEMPORAL_STATUS_ID` global pointer. A process handling multiple
properties, identities or lifecycle rotations derives a different ticket slot whenever one of these
load-bearing identities differs.

Re-executing the exact same canonical subject under the exact same lifecycle resolves the same
attempt and immutable authorization-ticket identity. A different canonical subject, attempt or
lifecycle cannot reuse the old ticket.

## T_decision and historical predicate

`T_decision` is the signed `decision_time` inside the exact-attempt ticket. It is the issuer-side
authority-decision instant at which that exact attempt was authorized. The ticket hash-binds the
root-signed lifecycle ref/hash that governed that decision.

The LU verifier does not use a caller-supplied decision time and does not reinterpret the deterministic
execution seed as time. Ticket verification requires:

- exact issuer, subject/hash, action and attempt binding;
- exact lifecycle ref/hash binding;
- issuer signature under the issuer already accepted by the LU root chain;
- `lifecycle.valid_from <= T_decision`;
- `T_decision < lifecycle.valid_until`;
- `lifecycle.revoked_at == null || T_decision < lifecycle.revoked_at`.

The upper validity bound is exclusive. Revocation effective exactly at `T_decision` is blocking.
Failures are explicit, including `qualification_not_active`, `qualification_expired` and
`authority_revoked`.

This ticket proves the historical `authorized_at_decision_time` claim only. Current admission is a
separate predicate: `verifyLuSourceAuthorityForAssessment` first verifies the deployment-selected
root-signed lifecycle and calls `assertLuExecutionAuthorityLifecycleCurrent` before resolving the
exact-attempt ticket.

## Evidence / persistence closure

`lu-source-authority-evidence-v2` remains representation-only. It may carry the signed decision time
and temporal-ticket ref/hash, but it cannot carry `authorized_at_decision_time`, `authorized_now` or
`source_authority_verified`.

The positive decision remains module-private WeakSet provenance. Before any assessment write,
`GovernedAssessmentPersistence` additionally requires:

- the outcome attempt ref equals the positive authority decision's exact attempt ref;
- outcome -> attempt -> manifest -> execution-identity equals the verified authority subject;
- exact decision/evidence temporal ref + hash binding;
- exactly one lifecycle supporting artifact, equal to the decision lifecycle ref/hash;
- rehash of the actual lifecycle body;
- `assertLuExecutionAuthorityLifecycleCurrent` again at the mutation boundary;
- exactly one temporal-ticket supporting artifact;
- ticket ref/hash/attempt/lifecycle/T_decision equality;
- rehash of the actual presented ticket body.

Thus a valid positive decision cannot be paired with a substituted identity, another attempt,
another lifecycle, a mutated lifecycle/ticket body or stale declared hash at persistence.

## Historical / revocation semantics

04E proves two distinct predicates rather than conflating them:

1. **current admission:** the deployment-selected root-signed lifecycle must be active, unexpired and
   not effectively revoked when a new authority decision is produced;
2. **historical exact-attempt authorization:** the signed ticket proves that the exact attempt was
   authorized at its signed `T_decision` under the lifecycle hash bound into that ticket.

A later lifecycle rotation does not rewrite an immutable ticket or turn it into `authorized_now`.
The write boundary rechecks currentness of the lifecycle bound to the verified decision. 04E does not
claim a generic platform-wide online revocation service or retroactive invalidation of historical
records; those would be separate semantics and must not be smuggled into the historical claim.

## Production provisioning / fail-closed behavior

The standalone V3 identity provisioning worker is still the only production process in this path
that holds `LU_EXECUTION_AUTHORITY_PRIVATE_KEY_PEM`. For newly minted and reused V3 identities it:

1. verifies the LU root -> issuer chain;
2. resolves `LU_EXECUTION_AUTHORITY_LIFECYCLE_ID`;
3. verifies the root-signed lifecycle and its current qualification/revocation state;
4. derives the exact canonical attempt;
5. resolves or mints the deterministic issuer-signed temporal ticket bound to that lifecycle;
6. verifies the ticket before persisting it.

The live request-handling server remains verifier/consumer-only. Missing lifecycle configuration,
invalid root/issuer binding, bad signatures, inactive qualification, expiry or effective revocation
fails closed.

## Dedicated trusted proof contract

`governance/devgov/units/lu-source-authority-temporal-04e-v1.json`

Proof IDs:

- `temporal-activation-expiry-revocation`;
- `canonical-exact-attempt-authority-wiring`.

The trusted scope includes the lifecycle implementation and provisioning operation, temporal ticket,
authority evidence/wiring, persistence boundary, carried-forward 04D anti-fabrication test, production
V3 provisioning tests and this audit document. Structural GREEN assertions require the root-signed
lifecycle path and explicitly reject regression to the removed `LU_SOURCE_AUTHORITY_VALID_FROM` /
`LU_SOURCE_AUTHORITY_VALID_UNTIL` worker model.

## Explicit nonclaims

04E is the **minimum LU delta**, not a claim that every Mimer governance mutation has migrated to one
generic lifecycle/revocation implementation. The generic ADR-24-21 lifecycle model remains the
platform direction.

04E also does not claim that an online `authorized_now` predicate exists, nor that a later lifecycle
rotation retroactively changes already persisted historical authority evidence.

Finally, **IMPLEMENTED is not PROVEN**. 04E becomes PROVEN/CLOSED only when the dedicated trusted
Dev-Gov RED/GREEN and canonical evidence gate pass for the exact final candidate SHA and the
repository's required staging evidence has been supplied without bypass or fabrication.
