# MINIMUM-AUTHORITY-DELTA-04E — TEMPORAL QUALIFICATION / REVOCATION

Status: **IMPLEMENTED / UNPROVEN**

Base: `c2c47efaea8cb2fb38055bdd72bc2c0e55422039` (04D-R1 F04 corrected candidate)

## Objective

Close the remaining LU temporal-authority gap without allowing a caller to assert positive
authority and without introducing a process-global authority-status pointer.

The canonical LU LocalizationAssessment mutation now requires two proof layers:

1. the established cryptographic source chain `LU root -> issuer -> ExecutionIdentity`;
2. an **issuer-signed exact-attempt authorization ticket**, accepted only after that issuer has
   independently verified through the LU root chain.

The ticket is bound to the exact ExecutionIdentity, exact canonical execution attempt, authority
scope and `lu.localization_assessment.persist` action. Only after both layers verify may the LU
module mint the process-local historical result:

`authorized_at_decision_time = true`.

`authorized_now` is deliberately not represented or inferred.

## Exact-attempt identity

For canonical V3 LU execution the attempt reference is derived from the same V3 subject used by the
runtime manifest:

`attempt-${computeExecutionManifestIdV3(subject)}-1`.

The temporal ticket id is then deterministically derived from:

- the verified ExecutionIdentity ref;
- that exact attempt ref;
- the persistence action.

There is no `LU_SOURCE_AUTHORITY_TEMPORAL_STATUS_ID` global pointer. A process handling multiple
properties/identities derives a different ticket slot for each distinct canonical attempt.

Re-executing the exact same canonical subject resolves the same attempt and the same immutable
authorization ticket: that is replay. A different canonical subject derives a different attempt and
cannot reuse the old ticket.

## T_decision

`T_decision` is the signed `decision_time` inside the exact-attempt ticket. It is the issuer-side
authority-decision instant at which that exact attempt was authorized. The LU verifier does not use
its own wall clock, does not reinterpret the deterministic execution seed as time, and does not
accept T_decision as a caller parameter.

The dedicated V3 provisioning worker is the only production component in this path that holds the
LU issuer private key. When it provisions/reconciles an ExecutionIdentity it also provisions the
exact-attempt temporal ticket. The live web server remains verifier/consumer-only.

Deployment supplies the qualification/lifecycle inputs to that signer worker:

- `LU_SOURCE_AUTHORITY_VALID_FROM` — required ISO-8601 inclusive activation instant;
- `LU_SOURCE_AUTHORITY_VALID_UNTIL` — required ISO-8601 exclusive expiry instant;
- `LU_SOURCE_AUTHORITY_REVOKED_AT` — optional ISO-8601 effective revocation instant.

The worker refuses to mint a ticket if its authority decision instant is before activation, at/after
expiry, or at/after effective revocation. The resulting values are signed into the ticket and become
immutable replay evidence for that exact attempt.

## Load-bearing verifier predicates

Given signed ticket `S` and `T = S.decision_time`:

- exact subject/action/attempt binding MUST match the derived canonical expectation;
- issuer signature MUST verify under the issuer that already passed the LU root chain;
- activation: `S.valid_from <= T`, otherwise fail `qualification_not_active`;
- expiry: `T < S.valid_until`, otherwise fail `qualification_expired`;
- revocation: `S.revoked_at == null || T < S.revoked_at`, otherwise fail `authority_revoked`.

The upper validity bound is exclusive. Revocation at exactly T_decision is blocking.

## Evidence / persistence closure

`lu-source-authority-evidence-v2` remains representation-only. It may carry the signed decision time
and temporal-ticket ref/hash, but it cannot carry `authorized_at_decision_time`, `authorized_now` or
`source_authority_verified`.

The positive decision remains module-private WeakSet provenance. Before any assessment write,
`GovernedAssessmentPersistence` additionally requires:

- the outcome attempt ref equals the positive authority decision's exact attempt ref;
- outcome -> attempt -> manifest -> execution-identity equals the verified authority subject;
- exact decision/evidence temporal ref + hash binding;
- exactly one temporal-ticket supporting artifact;
- ticket ref/hash/attempt/T_decision equality;
- rehash of the actual presented ticket body (attestation excluded from the artifact hash domain).

Thus a valid positive decision cannot be paired with a substituted identity, another attempt,
mutated ticket body or stale hash at persistence.

## Historical / revocation semantics

This delta proves **authorized at the signed authority-decision time for one exact canonical
attempt**. It intentionally does not prove `authorized_now`.

A revocation effective after T_decision does not retroactively invalidate replay of that already
authorized historical attempt. A distinct later canonical mutation cannot reuse the ticket because
its subject/attempt binding differs and requires its own authorization ticket.

If policy later requires a previously authorized but not-yet-consumed exact attempt to be cancelled
by a revocation occurring after ticket issuance, that is a separate online/current-revocation
predicate and must not be smuggled into the historical `authorized_at_decision_time` claim.

## Production provisioning / fail-closed behavior

The V3 identity provisioning worker reconciles both newly minted and already-existing V3 identities.
A successful production path therefore has a deterministic exact-attempt ticket available before LU
assessment consumption. Missing configuration, expired qualification or effective revocation causes
provisioning to fail closed.

The ticket signer is the existing LU issuer key. No root private key is added to the worker and no
private signing material is added to the live request-handling process.

## Explicit nonclaims

04E is the **minimum LU delta**, not a claim that every Mimer governance mutation has migrated to one
generic lifecycle/revocation implementation. The generic ADR-24-21 lifecycle model remains the
platform direction.

04E also does not claim that an online `authorized_now` predicate exists, and it does not treat a
later revocation as retroactively changing an already signed historical authority decision.

Finally, **IMPLEMENTED is not PROVEN**. 04E becomes PROVEN/CLOSED only when the dedicated trusted
Dev-Gov RED/GREEN and canonical evidence gate pass for the exact candidate SHA and the repository's
required staging evidence has been supplied without bypass or fabrication.
