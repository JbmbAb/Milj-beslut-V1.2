# MINIMUM-AUTHORITY-DELTA-04E — TEMPORAL CURRENTNESS / REVOCATION

Status: **IMPLEMENTED / UNPROVEN**

Base: `c2c47efaea8cb2fb38055bdd72bc2c0e55422039` (04D-R1 F04 corrected candidate)

## Objective

Close the remaining temporal authority gap without reintroducing wall-clock nondeterminism or a
caller-supplied positive authority claim.

The canonical LU mutation now requires two independent proof layers:

1. the already established cryptographic source chain
   `LU root -> issuer -> ExecutionIdentity`;
2. a **root-signed temporal status artifact** bound to that exact root, issuer, identity, action and
   authority scope.

Only after both layers verify may the LU module mint the process-local historical result:

`authorized_at_decision_time = true`.

`authorized_now` is deliberately not represented or inferred.

## T_decision

`T_decision` is the signed `decision_time` carried by
`LuSourceAuthorityTemporalStatusArtifact`. It is not `new Date()`, not the execution seed and not a
caller parameter to `verifyLuSourceAuthorityForAssessment`.

The temporal-status artifact is selected through process provisioning
`LU_SOURCE_AUTHORITY_TEMPORAL_STATUS_ID`, resolved from the canonical artifact repository, rehashed,
and verified with the provisioned LU root public key.

This makes T_decision replay-stable: historical replay reuses the same hash-bound status artifact.
A later status snapshot or revocation does not rewrite the historical proof.

## Load-bearing predicates

Given signed status `S` and `T = S.decision_time`:

- activation: `S.valid_from <= T`, otherwise fail `qualification_not_active`;
- expiry: `T < S.valid_until`, otherwise fail `qualification_expired`;
- revocation: `S.revoked_at == null || T < S.revoked_at`, otherwise fail `authority_revoked`.

The upper validity bound is exclusive. Revocation at exactly T_decision is therefore blocking.

## Evidence / persistence closure

`lu-source-authority-evidence-v2` remains representation-only. It may carry the signed decision time
and temporal-status ref/hash, but it cannot carry `authorized_at_decision_time`, `authorized_now` or
`source_authority_verified`.

The positive decision remains module-private WeakSet provenance. Before any assessment write,
`GovernedAssessmentPersistence` additionally requires:

- exact decision/evidence temporal ref + hash binding;
- exactly one temporal-status supporting artifact;
- status ref/hash/T_decision equality;
- rehash of the actual presented status body (attestation excluded from the artifact hash domain);
- existing F04 outcome -> attempt -> manifest -> execution-identity binding.

Thus a previously valid positive decision cannot be paired with a substituted, mutated or stale-hash
status object at persistence.

## Historical semantics

A revocation effective **after** T_decision does not retroactively invalidate that historical
decision. A new mutation evaluated at or after the revocation instant fails closed.

This is the intended replay rule:

`authorized(T_decision)`, never `authorized(T_now)`.

## Explicit nonclaims

04E does not claim that all platform governance mutations have been migrated to this LU temporal
status source. It closes the canonical LU LocalizationAssessment authority path stacked on 04D-R1.

04E also does not claim PROVEN until its dedicated trusted Dev-Gov RED/GREEN and canonical evidence
gate pass for the exact candidate SHA.
