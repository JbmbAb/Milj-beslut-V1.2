# Commercial Packaging — Owner Decision Sheet (2026-08-30)

Companion to [commercial-packaging.md](./commercial-packaging.md) (2026-03-02, v1.0), produced
during documentation closure (D7). **`commercial-packaging.md` itself is left unmodified** — no
pricing, packaging, or scope numbers are invented or edited here. This sheet only surfaces claims,
dates, dependencies, and contradictions found by cross-referencing it against current repo state,
for owner business review.

## Classification

`CURRENT_BUT_UNVERIFIED` / `OWNER_BUSINESS_REVIEW_REQUIRED`

## 1. Age

Dated 2026-03-02 — roughly 6 months old as of this review (2026-08-30). No revision since. The
document itself carries no explicit "still valid" reconfirmation.

## 2. Contradiction found: Professional tier vs. Core scope lock

`commercial-packaging.md` §1 lists **"Professional"** tier as including *"logistik- och
compliancefloden"* (logistics and compliance flows) as a sellable feature tier.

[core-scope-lock.md](./core-scope-lock.md) §"Utanför Core (hanteras i V2+)" explicitly places
**"Fullt logistikflöde som kommersiell standardmodul"** outside Core, deferred to V2+.

**These two documents disagree about whether logistics is a currently sellable feature.** This is
a genuine business/packaging decision, not a documentation-formatting issue — I have not resolved
it or edited either file. Owner must decide: (a) Professional tier's logistics claim is aspirational
/ V2-only and the packaging doc should say so, or (b) logistics is actually being sold today and
core-scope-lock.md is stale on that point.

## 3. No concrete pricing numbers present

`commercial-packaging.md` contains tier *names* (Starter/Professional/Enterprise) and a pricing
*model structure* (grundavgift + volymkomponent + tjänstetillägg), but **no actual currency
figures**. There is nothing to verify against actual billing/contracts, and nothing for me to
"invent" — the gap is that no priced version exists yet, not that an existing price is wrong.

## 4. Verification refs are self-referential, not tooling-backed

All four `Ref: COMM_*_V1` lines (and the closing `COMMERCIAL_PACK_V1_2026-03-02`) are plain-text
identifiers inside the document itself. A repo-wide search found them referenced only from
`docs/qa/product-readiness-checklist.md` (an evidence-index cross-reference), not from any CI
config, test, or code. They function as internal citation keys, not automated verification gates.

## 5. Open questions for owner (business decisions only — not answerable from code)

1. Is the Professional-tier logistics claim intentional (pending a V2 scope change) or drift that
   should be corrected in the packaging doc?
2. Has any pricing actually been quoted to a prospect/customer since March 2026 that should now be
   reconciled into this document?
3. Does the target-customer framing (implicit in "Starter/Professional/Enterprise" + municipality
   demo-data) still match current go-to-market focus, given the product's current concrete build
   centers on LU, C-anmälan schaktmassor, and Enskilt avlopp per
   [MODULE_IMPLEMENTATION_PLAN.md](./MODULE_IMPLEMENTATION_PLAN.md)?
4. Should this document be formally reconfirmed/reversioned (v1.1+) or superseded?

No action taken beyond producing this sheet. `commercial-packaging.md` remains as-is pending owner
review.
