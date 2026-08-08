# Rebuild gate status — locked

**Locked:** 2026-08-08  
**Authority:** Admit v1 freeze + spatial rebuild acceptance (Proof A) + property coverage finding (Proof B)

Rebuild is **not** blocked by spatial functionality. It is blocked by **data coverage**.

---

## Gate board

| Gate | Status |
|---|---|
| Sanerad PostGIS | 🟢 |
| Admit v1-import | 🟢 |
| Property → spatial layers | 🟢 |
| SpatialEvidenceArtifact → CAS | 🟢 |
| CAS identity/replay | 🟢 |
| LU assessment | 🟢 |
| Magic Moment på importerad täckning | 🟢 |
| Property nationell täckning | 🔴 OPEN / INSUFFICIENT → **Admit v2 candidate READY (HITL)** |
| `lu.soil_type` | 🟢 COMPLETE (importerad & verifierad med axel-swap) |
| Nationell LU-acceptance | ⏸ until v2 property ADMIT + coverage validation |
| Cesium | ⏸ |
| Evolution | 🔒 FROZEN |
| L3 rechunk | ⏸ |

---

## What is proven

```text
PostGIS + LU fungerar korrekt där admitted property-data faktiskt finns.
```

Proof A receipt: [spatial-rebuild-acceptance.json](../../../storage/manifests/admit-v1-import/spatial-rebuild-acceptance.json)  
In-coverage property: `STOCKHOLM STENBITEN 9` (län 01).

## What is not proven

```text
PostGIS + LU fungerar för Sveriges nationella property coverage.
```

That is a separate question → [PROPERTY-COVERAGE-FINDING.md](./PROPERTY-COVERAGE-FINDING.md).

---

## Magic Moment spatial contract (locked)

Legacy leak eliminated:

```text
topo10.vatten saknas
        ↓
legacy fallback = 200 m   ← DO NOT REINTRODUCE as spatial semantics
        ↓
EBH/protected missas
```

Current contract:

```text
LU Magic Moment
      ↓
frozen 500 m spatial contract
      ↓
water / EBH / protected_area
```

**Policy:** Do not reintroduce `distanceToWater` as a general spatial fallback. If a water layer is missing, that is an explicit data/admission state — not alternative spatial semantics. Do not change Magic Moment again for this rebuild phase.

---

## Next work (no LU / Cesium / Evolution / chunking)

```text
PROPERTY COVERAGE FINDING              ✅
identifiera korrekt nationell master   ✅  2026-06-18 (not 2026-06-28)
source authority                       ✅  Lantmäteriet / STAC national merge
manifest + SHA                         ✅  7aff5455… verified
ny Admit-beslut (Admit v2)             ✅ ADMIT (HITL) — follow import receipts
PROPERTY-COVERAGE-V2 contract          ✅ prep frozen
MM national acceptance matrix          ✅ prep frozen (MM unchanged)
Admit v1 live receipt schema           ✅ prep — emit on --live
          ↓
live validation / coverage / MM matrix (hard)
          ↓
nationell LU acceptance
```

Decision pack: [../admit-v2/ADMIT-V2-PROPERTY-WAVE.md](../admit-v2/ADMIT-V2-PROPERTY-WAVE.md)  
Parallel board: [../admit-v2/PARALLEL-GATE-BOARD.md](../admit-v2/PARALLEL-GATE-BOARD.md)

Parallel / later, same principle:

```text
lu.soil_type → separat Admit-våg när rätt nationell källa är identifierad
               (no silent SHA swap under old Admit row)
```

Paused until national property coverage is admitted:

- Nationell Magic Moment acceptance  
- Cesium  
- Evolution (already FROZEN)  
- L3 rechunk  

Target chain after property is nationally complete:

```text
nationell masterdata → sanerad PostGIS → spatial evidence → CAS → LU assessment → UI → Cesium
```
