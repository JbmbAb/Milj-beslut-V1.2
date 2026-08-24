# DOCUMENT-FACT-CANDIDATE-REISSUE-V1 — real decision (read-only record)

```
Document class:    GOVERNANCE DECISION RECORD (read-only)
Program parent:    DOCUMENT-EVIDENCE-VERTICAL-SLICE-V1
Prior checkpoint:  DOCUMENT-FACT-HUMAN-VERIFICATION-V1, commit 68f80044
                    (fact-candidate-776ae304bf01df5bca446f5e, HUMAN_REJECTED)
Reviewer:          bjb@miljöbeslut.se
Reviewed:          2026-08-24
Decision:          APPROVE
```

## What happened

The rejected candidate's span (offsets 646–758, the DOMSLUT) affirmed a lower-court judgment
without itself stating what was restricted. This unit built ONE corrected candidate from the
same real governed CAS source and the same deterministic text projection, using a different,
narrower, literal span, and presented it for a fresh, independent review decision. The prior
rejection does not carry over to this candidate — a new explicit decision was required and
given.

## The rejected candidate (unchanged, permanent historical evidence)

- `candidate_artifact_id`: `fact-candidate-776ae304bf01df5bca446f5e`
- Rebuilt read-only in this unit's proof script solely to confirm its identity is byte-for-byte
  unchanged — confirmed identical to the historical value. Not mutated, replaced, or
  reinterpreted.

## The corrected, approved candidate

- `candidate_artifact_id`: `fact-candidate-219b881f9647de06419af0df`
- `content_hash`: `ee6588a79c3e0bc64f0e0247d029d0b56b1e55e12da1c9772db358fe268612aa`
- `fact_type`: `PRIOR_LOCATION_RESTRICTING_DECISION`
- source: same `MMOD_2026-04-09_M_5246-25_Dom_2026-04-09.pdf`, same
  `text_projection_ref` (`tp:00019927-5933-499c-9be1-98991ad31f2f:397643541ab0f7f6`)
- span (offsets 28115–28413, the lower court's own BAKGRUND restatement, reproduced verbatim
  inside this MMOD PDF):

  > "äger skogsbruksfastigheten i Bollnäs kommun. Fastigheten omfattar 92 ha. Kärandena anmälde
  > i januari 2018 en planerad föryngringsavverkning av ett område om 2,7 ha inom fastigheten.
  > Skogsstyrelsen har i ett beslut den 29 juni 2018 vid vite förbjudit all form av avverkning
  > inom det anmälda området."

## Why this span was approved

Unlike the rejected span, this one states all three required elements inside the bound text
itself, with nothing left for a reviewer to infer from elsewhere in the document:

1. a named property (skogsbruksfastigheten i Bollnäs kommun, 92 ha) and the notified area
   within it (2,7 ha) — location/property context;
2. that Skogsstyrelsen made an actual decision on 2018-06-29 — an actual restrictive decision;
3. what the restriction is (förbjudit all form av avverkning, vid vite — prohibited all logging,
   under penalty) — the restrictive substance itself.

## What this unit did NOT do

- Did not construct a `VerifiedDocumentFactArtifact`. The frozen governance gate
  (`verifyDocumentFactCandidate`, `DocumentFactArtifact.ts`, OWNER FREEZE 2026-08-12) was never
  invoked by this unit's proof script — confirmed by scope check in the script itself.
- Did not create `DocumentEvidence`.
- Did not wire anything into an LU assessment.
- Did not mutate, replace, or reinterpret the rejected candidate.

Promoting `fact-candidate-219b881f9647de06419af0df` to a real `VerifiedDocumentFactArtifact`
through the same human-review gate proven in Unit D
(`verifyRealDocumentFactCandidate.ts`) — this time expected to succeed given the APPROVE
decision above — is a separate, not-yet-started unit.

## Status

```
DOCUMENT-FACT-CANDIDATE-REISSUE-V1                    PROVEN / COMMITTED / PUSHED
fact-candidate-776ae304bf01df5bca446f5e (rejected)    unchanged, permanent historical evidence
fact-candidate-219b881f9647de06419af0df (corrected)   APPROVED by real human review
VerifiedDocumentFactArtifact for the corrected fact   NOT YET CREATED — next unit
```
