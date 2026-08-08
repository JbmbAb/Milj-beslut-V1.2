# ADR: Runtime Snapshot Boundary

## Syfte
Definiera att snapshots uteslutande är till för:
- replay acceleration
- runtime recovery
- state reconstruction

men **aldrig** får vara:
- decision storage
- evidence storage
- materialized truth

## Frysta invariants

### SNAP-I01 — Replay, not Authority
*Normativ formulering:*
RuntimeSnapshot SHALL only accelerate deterministic runtime replay.
RuntimeSnapshot SHALL NOT represent, replace, or create Decision Authority.

### SNAP-I02 — Snapshot Truth Separation
Snapshot får innehålla:
```json
{
 release_hash,
 event_position,
 runtime_state_hash,
 schema_version
}
```
Förbjudet att innehålla:
- `decision_facts`
- `evidence_refs`
- `raw_documents`
- `materialized_payloads`

### SNAP-I03 — Replay Determinism
Samma `snapshot` + `same event delta sequence` ska ge `same runtime state hash`.
Invariant: `SNAPSHOT + EVENTS = IDENTICAL REPLAY STATE`
