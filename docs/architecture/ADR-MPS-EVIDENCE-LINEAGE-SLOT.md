# ADR-MPS-EVIDENCE: EvidenceSet Lineage Slot Uniqueness

| Field | Value |
| --- | --- |
| **Status** | **FROZEN** |
| **Date** | 2026-08-07 |
| **Owner** | MPS Decision / Evidence Governance |
| **Implements** | `packages/mps-decision-governance` lineage validator |

---

## Decision

### LINEAGE_SLOT_UNIQUENESS (identity rule)

For each tuple:

```text
(previous_evidence_set_hash, lineage_scope, canonical document set)
```

at most one `lineage_sequence` may exist.

Attempts to materialize another sequence for the same slot SHALL be rejected with:

```text
LINEAGE_SEQUENCE_AMBIGUITY
```

This is an **identity rule**, not a runtime policy.

---

## Distinction from fork detection

| Rule | Question answered |
| --- | --- |
| **Fork detection** (`LINEAGE_FORK_DETECTED`) | Are there two different children of the same parent? (`A→B` and `A→C`) |
| **Slot uniqueness** (`LINEAGE_SEQUENCE_AMBIGUITY`) | Are there two competing identities for the same logical chain position? |

Slot uniqueness also covers:

- **Root case** — `previous_evidence_set_hash = null`
- **Alternative timelines** — same documents + scope + previous, different `lineage_sequence` (e.g. `seq=2` vs `seq=27`)

---

## Commit order

Lineage checks (slot + fork + sequence + scope) SHALL run **before** CAS commit of an EvidenceSet.
