# MINIMUM-AUTHORITY-DELTA-04D — LU SOURCE AUTHORITY WIRING

Status: **IMPLEMENTED / UNPROVEN**

Base: `02fe470d4a3a5a6d6e0f500521a5a4cc4fcb6bba` (04C-R1 PROVEN)

## Objective

Make the already-proven LU cryptographic source authority load-bearing on the real canonical
LocalizationAssessment CAS mutation:

`LU root -> verified issuer -> verified ExecutionIdentity -> generic source-authority evaluation
-> AuthorityEvidence -> LocalizationAssessment V4 CAS write`.

AuthorityEvidence remains representation-only. Positive authorization is an ephemeral result minted
only after the source verifier has executed successfully.

## Load-bearing changes

- Generic `verifySourceAuthorityAtDecisionTime` is a separate source-root evaluator. The existing
  actor-root evaluator remains fail-closed for source roots.
- LU adapter executes `verifyLuExecutionAuthorityChain` and
  `verifyExecutionIdentityAttestation` against the exact root, issuer, identity, actor,
  capability, release snapshot, V3 subject and deterministic seed.
- The canonical product path supplies an explicit ISO `authority_decision_time`. The deterministic
  seed is never reinterpreted as time.
- New assessments with source authority use `localization-assessment-v4` and hash exactly one
  `authority_evidence_ref` into their canonical body.
- `GovernedAssessmentPersistence` in canonical authority-required mode rejects missing,
  duplicated, mismatched, or caller-fabricated positive authority decisions before assessment
  persistence.
- Generic projection artifacts plus AuthorityEvidence are materialized before the assessment so
  the evidence closure is resolvable on replay.

## Lifecycle boundary

The existing LU ArtifactAttestation format has no signed timestamp. 04D therefore does not invent a
historical provisioning time. Its CREATED/ACTIVE service lifecycle is an **evaluation-scoped
representation** at the persisted T_decision only. It is not a claim of `authorized_now`, current
revocation status, or historical activation. Persistent currentness/revocation remains a later
delta.

## I10 / I14 scope

04D closes ACT-21-I10 and I14 for the canonical LU LocalizationAssessment mutation: the assessment
references exactly one AuthorityEvidenceArtifact, and its transitive generic/source closure is
persisted. This does not claim that every governance mutation in the platform has been migrated.

## RED / GREEN

The trusted command first checks production source files for the 04D load-bearing surfaces. On the
PROVEN R1 base those surfaces do not exist, so RED fails substantively before any candidate-only
test path is consulted. On the candidate the same command then runs the 04D cryptographic/runtime
proof plus the frozen 04C generic regressions.

No trusted result is claimed until DEV-GOV trusted RED/GREEN and the canonical evidence gate pass.
