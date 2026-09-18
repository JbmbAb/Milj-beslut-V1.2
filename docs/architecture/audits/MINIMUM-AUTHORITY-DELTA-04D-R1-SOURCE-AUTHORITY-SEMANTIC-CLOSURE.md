# MINIMUM-AUTHORITY-DELTA-04D-R1 — SOURCE AUTHORITY SEMANTIC CLOSURE

Status: **IMPLEMENTED / UNPROVEN**

RED base: `31ac9192b02874e6b804de1185f5cd8093909e84` (04D candidate that passed mechanical Dev-Gov checks but failed cold semantic review)

## Cold-review blockers closed

### R1-F01 — wall-clock entered immutable authority/assessment identity

04D passed `new Date().toISOString()` from the real
`GenerateLocalizationReportUseCase` into AuthorityEvidence and then into LocalizationAssessment
V4's hash domain. Identical semantic reruns could therefore mint distinct verified assessments for
the same binding/geometry, violating the frozen projection/idempotency contract and creating
`REJECT_ASSESSMENT_PROJECTION_AMBIGUOUS_CURRENT` on discovery.

04D-R1 removes wall-clock authority input entirely. Source AuthorityEvidence is now a deterministic
function of canonical service identity, trust domain/anchor, action, and the exact verified
root -> issuer -> ExecutionIdentity path.

### R1-F02 — temporal authorization overclaim

The LU root, issuer and ExecutionIdentity attestations contain no signed activation time, expiry,
revocation state, or decision-time predicate. 04D nevertheless minted a runtime field named
`authorized_at_decision_time: true`.

04D-R1 removes that claim. The positive process-local result is only
`source_authority_verified: true`: the exact cryptographic source chain was verified for the exact
execution subject. Temporal/current authority remains explicitly unproven and is deferred to the
revocation/validity delta.

### R1-F03 — generic callback could be treated as cryptographic authority

04D's generic source verifier accepted a caller-supplied `verify_source_path` callback and then
minted a WeakSet-approved positive decision from whatever artifacts that callback returned.

04D-R1 removes that API. The LU verifier performs the real root/issuer/ExecutionIdentity crypto
directly and obtains the provisioned public-key verifiers internally. Callers cannot inject a fake
VerificationKeyProvider. Only that LU module can mint membership in its private verified-decision
WeakSet.

## AuthorityEvidence contract

04C's temporal actor/lifecycle AuthorityEvidence contract is untouched.

04D-R1 adds the LU-specific `lu-source-authority-evidence-v1` representation with the same
`artifact_type = authority_evidence` required by ACT-21-I10, but with no `decision_time`,
`authorized_at_decision_time`, `authorized_now`, or positive verification field. It binds:

- canonical LU ServiceIdentity
- TrustAnchor and TrustDomain
- action + authority scope
- exact hash-bound root -> issuer -> ExecutionIdentity path

The canonical LocalizationAssessment V4 still references exactly one such AuthorityEvidence.

## Product regression proof

The real `GenerateLocalizationReportUseCase` product wiring test is upgraded to provision the full
LU root -> issuer chain and is included in trusted GREEN. Its existing invariant remains
load-bearing:

`same exact product state replayed twice -> same assessment_artifact_id`.

## Nonclaims

04D-R1 does not prove authority currentness, revocation, expiry, historical activation, or
`authorized_now`. ActorLifecycle convergence for source authority is deferred until those facts
have a real signed source.


## Trusted proof-contract refinement after run 35097204213

Run `35097204213` produced a valid signed RED against exact base
`31ac9192b02874e6b804de1185f5cd8093909e84`. Its aggregate GREEN command then returned raw
`exit_code=1` on exact candidate `4659b509ceeb4f54d58fbfbb65f8d8627df35453`.

The prior proof command combined two different proof surfaces in one Vitest invocation:

- compliance-project LU source-authority crypto/persistence tests;
- unit-project real `GenerateLocalizationReportUseCase` product wiring/idempotency tests.

The trusted execution record intentionally retains only stdout/stderr hashes, so an aggregate
failure did not identify which surface failed. The unit is therefore refined without weakening
either claim: `source-authority-semantics` and `product-idempotency` are now separate trusted
RED/GREEN proof IDs, each with file parallelism disabled. Both must independently RED on the exact
buggy base and independently GREEN on the candidate before the canonical evidence gate can pass.

The failed aggregate run remains audit evidence and is not reinterpreted as success.
