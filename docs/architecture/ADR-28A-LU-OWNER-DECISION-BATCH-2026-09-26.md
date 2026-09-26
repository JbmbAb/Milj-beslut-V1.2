# ADR-28A — LU Owner Decision Batch 2026-09-26

Status: OWNER-APPROVED / FROZEN DECISIONS
Owner: Jimmy Bruce
Approved: 2026-09-26
Base: protected main 7ec4b1b262e30fe3ff18ecba6d11133c98cb7384
Source decision batch: DECISION-BATCH-2026-09-26.md
Source batch SHA-256: C1A7E7AEFA7931C6AE8E37C0A44751B648056E65E0641A6B676A6EAFEC989A47

## 0. Authority and scope

Jimmy explicitly approved batch 1–10 in the conversation on 2026-09-26.
This ADR addendum records those owner decisions. It does not claim that implementation, migration, proof, staging, legal review, SYSTEM-PROVEN, PRODUCT-PROVEN, Step 5 finalization or W1 finalization is complete.

Where a decision opens implementation work, the implementation remains OPEN until its own governed unit and closure evidence exist.
External legal/licensing authority remains EXTERNAL even where an internal interim policy is frozen here.

## 1. Semantic authority

### SEM-1
The system SHALL distinguish "checked and absent" from "could not be checked".
UNKNOWN/NOT_CHECKED is a non-severity state. Technical unavailability SHALL NOT be converted to exists=false.

### SEM-2
The legacy compliance engine MAY remain temporarily as an explicitly labelled observation layer.
It SHALL NOT determine the governed LU verdict or be presented as an equivalent authoritative assessment.
Legacy rules are migrated one-by-one into governed semantics or retired.

### SEM-3
The authoritative LU product statement is the governed chain:
Evidence → Rules → Findings → Assessment.
Legacy text is supplementary observation only and must be labelled as such or removed from product surfaces.
### OD-03 / OD-04 / OD-17
Unknown water distance means UNKNOWN, never "safe" or "beyond range" by omission.
No permit/risk number may be derived solely from a null/unmeasured water distance.
OD-04 is explicitly decided: bank-compliance and Gemini-derived outputs MAY change where they currently yield LOW/0.95 by omission.
W3 scope includes all non-LU paths that currently fail-open on unknown water state.

## 2. LU v1 layer set

The LU v1 mandatory set is frozen as follows:
- Fastighet
- G1 Brunnar
- G2 EBH
- G3 Naturreservat
- G4 Natura 2000 SPA, conditional on D-5/INCOMPLETE handling
- G5 Vattenskydd

Declared gaps that MUST be surfaced as "ej analyserat – underlag saknas":
- strandskydd/ytvatten
- grundvatten
- artskydd
- kulturmiljö

Context only:
- avrinningsområde; its current use as municipality semantics must be removed or governed before authoritative use.

Not mandatory in LU v1:
- jordart
- skred/ravin
- översvämning
- nyckelbiotoper

Every mandatory layer must run through a governed provider and emit an evidence reference.
A declared gap must never be silently interpreted as absence.
### D-5 — Natura 2000
The current incomplete Natura 2000 SPA layer is INCOMPLETE/BLOCKED for absence claims until a sidecar-bound admission is proven.
No absence conclusion may be emitted from the incomplete layer as if coverage were complete.

### OD-09 — soil
The existing COMPLETE claim for the truncated soil layer is retracted.
A new Admit wave may proceed only from a verified complete source.

## 3. Property and data identity

### D-1
Full PROVEN_BINDING for property requires byte identity (Bar A).
Lower bars may be reported as lower assurance levels but shall not be called full PROVEN_BINDING.

### D-2
H: is the primary path to the 7aff5455 bytes.
No copy or import occurs before hash verification. A controlled copy may be created after identity is proven if operationally needed.

### OD-07 / OD-14 / OD-15
7aff5455 is accepted as current content.
Frozen v1 identity documents are corrected forward-only; historical records are not rewritten.
Governed evidence storage is preferred over ad hoc forced tracking of ignored JSON receipts.
## 4. Reproducibility, ledger and validator policy

### D-3
R3 demonstrations run in a separate temporary PostgreSQL/PostGIS database, never in production.
Order: landslide first, then wells.

### D-9
The wells validator shall use the four-value fingerprint set with documented recipes:
identifier set, geometry, Tier-1 attributes and Tier-2 attributes.

### D-12 / OD-08
Keep wells admission 2b4b514f unless a separately governed Admit unit proves a replacement.
Silent SHA replacement is forbidden.

### D-4 / D-6 / D-7 / D-8 / D-11
topo10.byggnad is a separate admission/ledger issue; locate its CAS receipt and resolve the empty core.lm_byggnad/lm_mark production stubs in a separate unit.
Ledger policy is forward-only: stale/orphan rows remain historical but must never become current authority.
Keep lm_staging until D-2 closes.
Byte-identical local copies must be registered and protected by an immutable-cache policy.
Lane receipts belong in a governed evidence layer with stable references.

### OD-16
Disable VISS.lst_vattenskydd as a competing writer/target for the same logical layer.
One logical layer shall have one unambiguous writer/admission path.

### OD-19
The database dump at D:\GEodata\db-backup\miljobeslut-2026-06-02.dump shall be moved to controlled storage with explicit access and retention policy.
No open-ended, uncontrolled long-lived database dump is permitted.
### PL-1 / PL-2
Explicit read-only lane authority is granted for:
- PL-1 offline fingerprints
- PL-2 linted read-only pass 3

No DB mutation or source-file mutation is authorized by this lane decision.
Evidence levels may only change where the documented closure criteria are actually met.

## 5. Product proof and staging

### H3
H3 is a separate tracked proof-closure unit covering final proof-harness closure and independent verification.

### H5
H5 is separate only if its invariant set is not already covered by H4/H9.
If equivalent, record H5 = H4/H9 and do not create duplicate work.

### D-P5-2
The canonical LU proof-staging target is dedicated on-prem staging with full PostGIS/bulk geo.
Cloud Run may remain a thin pilot but does not count as LU proof-staging.

The current staging-E2E path must be rebuilt or replaced for the selected on-prem target before K-5..K-9 can close.

### D-P5-3
Release identity uses both git SHA and ProductRelease id.
Both must be visible in runtime/health evidence and bound into assessment/PDF evidence.

### D-P5-4
PRODUCT-PROVEN requires production-like server-side authentication with dev-login disabled.
An admin-password flow is acceptable for internal staging if it uses the production server-side auth path.
BankID is required only if it is a product requirement, not merely as a proof mechanism.
### D-P5-5
The legacy PDF route is not the PRODUCT-PROVEN path.
The staging proof shall exercise the governed PDF path.
If the legacy route remains, it must be labelled legacy/observation.

### D-P5-6 / J-9
Independent technical proof audit is mandatory for SYSTEM-PROVEN.
External legal review is a separate gate for legal claims, licensing and relevant privacy issues before PRODUCT-PROVEN; it is not a prerequisite for internal technical SYSTEM-PROVEN.

### D-P5-8
A retrospective LU-CANONICAL-PATH-01 PROVEN record may refer only to exact gated SHA 1987bcbd.
It may not claim 56be8cb6.

## 6. Legal and product-claim decisions

### J-2
The product shall not present permitProbability as an actual "tillståndssannolikhet" until empirical/legal calibration exists.
An internal heuristic may exist but must not be presented as calibrated probability.

### J-7 / J-12
Mimer is decision support, not the legal decision authority.
A named, authorized human actor makes the formal decision.
This principle is frozen by the owner decision recorded here.

### J-3
Legal corpus identity must include temporal/version identity such as effective date and/or consolidation/version reference.
Legal policy for historical wording remains subject to external legal authority.

### J-5
/api/legal/retrieval/search is retrieval-only.
It may not become an alternative answer-authority route without a new owner decision.
### J-6
Property designation is classified per flow.
Authenticated internal LU use is permitted under the applicable internal classification; external/public exposure requires separate policy and minimization.

### J-10 / J-13
ProcessingContext is implemented where LU actually requires it, not as unrelated broad work.
ADR-24-21 remains the revocation-semantics authority until an owner-adopted ADR explicitly supersedes it.

## 7. External and deferred authority

OD-12 Lantmäteriet licensing remains EXTERNAL for final license meaning.
Until that external basis is resolved, externally reachable Lantmäteriet-derived surfaces may be auth-gated as an interim internal policy.

External legal review of legal citations, licensing and relevant privacy questions remains EXTERNAL.

SYSTEM-PROVEN and PRODUCT-PROVEN rulings are not granted by this ADR.
They remain later owner rulings against exact closure evidence and exact SHA.

## 8. Consequence for map statuses

For nodes whose only blocker was the owner choice recorded here, DECISION NEEDED becomes:
- FROZEN where this ADR itself is the closure criterion for a policy/semantic decision;
- OPEN where the decision is now made but implementation, migration, admission, proof or external work remains.

No node becomes PROVEN merely because this ADR exists.

## 9. Non-authorizations

This approval does not authorize a second writer for Step 5 or W1.
It does not supersede one-writer-per-unit rules.
It does not authorize implementation in an active unit owned by another lane.
It does not change Step 5's current MERGED / NOT FINALIZED state.
