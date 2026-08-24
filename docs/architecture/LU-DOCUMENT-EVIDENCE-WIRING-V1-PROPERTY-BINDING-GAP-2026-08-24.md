# LU-DOCUMENT-EVIDENCE-WIRING-V1 — BLOCKED_BY_REAL_PROPERTY_BINDING (read-only record)

```
Document class:    GOVERNANCE DECISION RECORD (read-only)
Program parent:    DOCUMENT-EVIDENCE-VERTICAL-SLICE-V1, Unit G
Prior checkpoint:  H15-DOCUMENT-EVIDENCE-REHASH-COLD-REPLAY-V1, commit 404477dc
Status:            BLOCKED_BY_REAL_PROPERTY_BINDING (2026-08-24) — owner decision: stop here,
                    fix the independent engine bug, do not force the Bollnäs binding.
```

## Status

```
LU-DOCUMENT-EVIDENCE-WIRING-V1

STATUS:
BLOCKED_BY_REAL_PROPERTY_BINDING

gap:
DOCUMENT-EVIDENCE-PROPERTY-BINDING-REQUIRED

Bollnäs source:
canonical DocumentEvidence ✓  (doc-evidence-v2-ccef28ba76dc7cca7fa6ca85, commit 27fd3a38)
H15 replay/rehash ✓           (commit 404477dc)
property binding ✗
LU admission: correctly DENIED

No fabricated property_ref.
No inferred cadastral match.
No LU finding produced.
```

## What Phase A recon found

1. **Property binding is confirmed impossible for this exact document.** The full real
   85,480-character MMOD text (`fact-verified-8386a613c27e89efa9d4bf2e`'s source document) was
   scanned for any Swedish cadastral designation pattern (`Ort 1:23` and similar). None exists
   anywhere in the text — not just in the approved fact's span, across the whole document. This
   confirms, exhaustively rather than by inference, what was already suspected: the case names
   the property only as "fastigheten i Bollnäs kommun, 92 ha", with no fastighetsbeteckning to
   look up. There is nothing to bind.

2. **A second, independent bug was found and fixed** (see below) — not a reason this unit is
   blocked, but a real defect recon surfaced along the way: `LURuleEngine`'s `LU-DOC-BESLUT-001`
   predicate read `payload.fact_refs` (the V1 field name) even against a real V2
   `DocumentEvidenceArtifact`, whose payload carries `verified_fact_refs` — a different field,
   not a renamed alias. Fed a real V2 artifact, the rule silently never fired, for any content,
   regardless of what the evidence actually proved. This would have blocked EVERY future V2
   document-backed finding, not just this one.

## Why this unit stops here rather than proceeding

The frozen invariant from `DOCUMENT-EVIDENCE-PROPERTY-BINDING-CONTRACT-V2` (commit `323d34d1`)
is explicit: unbound `DocumentEvidence` must never silently become property-specific LU evidence,
and no fallback may infer binding from municipality name, area, free text, fact_type, or "same
source document". Fabricating a `DocumentEvidencePropertyBindingArtifact` for a property that
cannot actually be established from real cadastral data would be exactly the violation Unit E's
correction (V2) was built to prevent — the same failure mode as the original rejected candidate
in `DOCUMENT-FACT-HUMAN-VERIFICATION-V1`, one layer up the chain.

`resolveDocumentEvidenceForPropertyAssessment` (Unit E) correctly returns `admitted: false` for
this evidence given zero real bindings — this is the DESIGNED, CORRECT outcome, not a defect.

## What was fixed anyway

`LURuleEngine.ts`: `document_evidence` widened to accept either `DocumentEvidenceArtifact` (V1)
or `DocumentEvidenceArtifactV2`; `evaluateDocumentRules` now reads `verified_fact_refs` for a
real V2 artifact (via `isDocumentEvidenceV2`) and `fact_refs` for V1, never conflating the two.
Proven with real constructors (not a hand-typed fixture) in
`packages/mps-lu/tests/LURuleEngineDocumentEvidenceV2.test.ts` — a real V2 evidence artifact
referencing a real, human-verified fact now correctly produces the `LU-DOC-BESLUT-001` finding;
V2 evidence with no matching fact still correctly produces nothing. This fix is independent of
the Bollnäs case and was NOT used to force a finding for it — the Bollnäs evidence still cannot
enter LU because it has no property binding, which this fix does not and must not change.

## What comes next (owner decision, not started in this unit)

The owner chose, explicitly, not to pursue a full property-resolution capability for the Bollnäs
case specifically — that risks becoming larger than needed to complete the first real
product-backed LU finding, though it may become a useful general capability later.

The chosen next step: a new, separate unit — search the other real, already-governed
`domstolsverket-puh-mmod` quarantine documents (516 real items, of which this Bollnäs case was
one) for one that explicitly names a real fastighetsbeteckning in its own text, and run the
property-bound A→G chain on that document instead. Not started here.
