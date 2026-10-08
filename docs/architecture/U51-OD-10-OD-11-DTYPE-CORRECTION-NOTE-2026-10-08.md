# U51-OD-10 / OD-11 -- correction note on the dtype explanation

**Status: CORRECTION NOTE.** It corrects one explanatory sentence of `U51-OD-10-OD-11-MANIFEST-SHAPE-OWNER-DECISIONS-2026-10-08.md`
(committed as `18139b78`). It changes neither that record nor either decision: `OD-10 = NO` and `OD-11 = COMPONENT_LINEAGE_OUTSIDE_MANIFEST` stand
exactly as decided. It adds no manifest key, makes no contract revision (no R3) and decides nothing.

| Field | Value |
| --- | --- |
| corrects | section 2, bullet "Boundary that matters", of the record above |
| contract | `2d937d6336d73ab11d428af7d56afc6fdb38d0ee` (unmodified) |
| trigger | the independent-review preparation of `rt/u51-core-01` @ `56f674310c75e77a2fc14830740583057836b170`: its implementation report found the closed registry-entry schema |
| date | 2026-10-08 |

## 1. What the record said, and what is too strong

The record said that the admitted pipeline's `dtype` (`float32`) is bound through `pipeline_spec_sha256`, "because the contract hashes the entire registry
entry". That sentence is true of the contract text. It overstates what U51-core v1 proves.

## 2. What is true

- `dtype = float32` is part of the pipeline identity (the registry entry says the runtime must report exactly this dtype). It is **not** part of the
  worker execution environment. That distinction, which is what OD-10 rests on, is unchanged.
- U51-core v1 binds the embedding pipeline through `pipeline_spec_sha256`, and the manifest has no separate `dtype` key.
- The core proves only that `pipeline_spec_sha256` equals the hash of the registry entry **as presented in the embedding derivation evidence**. Its
  derivation schema is closed by the frozen RED pins, and the entry it accepts has no `dtype` key.
- The core therefore does not by itself show that this hash corresponds to the **admitted** registry entry including `dtype = float32`.

## 3. Where that connection must be established

By the real embedding adapter and the admission evidence in a later U51 step (section 14 step 10 of the contract), not by the core. The adapter must
present the admitted registry entry so that the hash it yields is the hash of the admitted entry. If the closed derivation entry cannot carry the admitted
entry faithfully, that is a conflict to be raised at that step; this note does not pre-decide it and does not introduce R3.

## 4. What this note does not say

It does not weaken OD-10 or OD-11, does not say the dtype is unbound in the manifest identity forever, and does not say the embedding adapter exists or is
correct. It records only that, until step 10 establishes the connection, the dtype binding is an open point and not a property the core proves.
