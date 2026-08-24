# DOCUMENT-FACT-HUMAN-VERIFICATION-V1 — real rejection (read-only record)

```
Document class:    GOVERNANCE DECISION RECORD (read-only)
Program parent:    DOCUMENT-EVIDENCE-VERTICAL-SLICE-V1, Unit D
Prior checkpoint:  DOCUMENT-FACT-CANDIDATE-V1, commit ff9ce938
Reviewer:          bjb@miljöbeslut.se (GOVERNANCE_REVIEWER)
Reviewed:          2026-08-24
Decision:          REJECTED
```

## What happened

Unit D built the real human-review infrastructure (`verifyRealDocumentFactCandidate.ts`),
proved it against negative cases (self-verification denied, tampered candidate denied, wrong
reviewer key denied — see `scripts/ops/prove-document-fact-human-verification-01.ts
--review-only`), then presented the real candidate from Unit C
(`fact-candidate-776ae304bf01df5bca446f5e`) to the real reviewer for an actual decision.

The reviewer **rejected** it.

## The candidate

- `candidate_artifact_id`: `fact-candidate-776ae304bf01df5bca446f5e`
- `fact_type`: `PRIOR_LOCATION_RESTRICTING_DECISION`
- source: `MMOD_2026-04-09_M_5246-25_Dom_2026-04-09.pdf` (Domstolsverket PUH)
- span (offsets 646–758): *"MARK- OCH MILJÖÖVERDOMSTOLENS DOMSLUT 1. Mark- och
  miljööverdomstolen fastställer mark- och miljödomstolens dom."*

## Why it was rejected

The quoted DOMSLUT text affirms the lower court's judgment but does not itself state **what**
the restriction was. The actual restrictive content — Skogsstyrelsens avverkningsförbud
(logging prohibition, 12 kap. 6 § miljöbalken) — is stated earlier in the document, in the
BAKGRUND section, not in the DOMSLUT paragraph the deterministic-extraction step picked. The
span alone does not support the claimed fact type; a reader given only the quoted text cannot
tell what was prohibited or where.

This is exactly the failure mode the human-review gate exists to catch: a deterministically
*located* span can still be the *wrong* span. Extraction found real text at a real offset;
review found that the real text does not carry the claimed meaning on its own.

## What this proves

- The human-review path is real, not a rubber stamp: `verifyDocumentFactCandidate`'s frozen
  gate (`DocumentFactArtifact.ts`, OWNER FREEZE 2026-08-12) was never even reached for this
  decision — rejection happens before promotion is attempted, exactly as it must.
- No `VerifiedDocumentFactArtifact` was constructed for this candidate. None will be, unless a
  corrected candidate (a different span) is asserted, verified against its own real content, and
  separately approved.
- The frozen `DocumentFactArtifact` model has exactly two artifact states — `CANDIDATE` and
  `VERIFIED` — and deliberately no `REJECTED` type. This rejection is recorded as a plain,
  explicitly non-canonical decision record (this document plus
  `scripts/ops/prove-document-fact-human-verification-01.ts --record-rejection`'s output), not
  as an invented third governed artifact type.

## Status

```
DOCUMENT-FACT-HUMAN-VERIFICATION-V1 infrastructure   PROVEN (verifyRealDocumentFactCandidate.ts,
                                                       RED proofs 1-7, focused tests green)
Candidate fact-candidate-776ae304bf01df5bca446f5e     REJECTED — will not be promoted
Unit D                                                CLOSED for this candidate; the vertical
                                                       slice does not proceed to Unit E on it
```

Producing a real `VerifiedDocumentFactArtifact` for a `PRIOR_LOCATION_RESTRICTING_DECISION` from
this document remains open, contingent on a corrected candidate binding a span from the BAKGRUND
section (or another passage that actually names the restriction) — a new, separate,
not-yet-started unit, not a reinterpretation of this rejected one.
