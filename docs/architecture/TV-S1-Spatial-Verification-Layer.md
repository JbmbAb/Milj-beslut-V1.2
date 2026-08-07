# TV-S1 — Spatial Verification Layer Architecture

| Field | Value |
| --- | --- |
| **Status** | **FRYST** (ACTIVE Final) |
| **Date** | 2026-08-07 |
| **Owner** | Spatial Governance Domain |
| **Type** | Contract freeze — semantics, evidence, verification, replay |
| **Depends on** | [ADR-MPS-CAS-STORAGE-BOUNDARY](./ADR-MPS-CAS-STORAGE-BOUNDARY.md), [ADR-MPS-SINGLE-MATERIALIZATION-AUTHORITY](./ADR-MPS-SINGLE-MATERIALIZATION-AUTHORITY.md), [ADR-MPS-CONSTITUTIONAL-INVARIANTS](./ADR-MPS-CONSTITUTIONAL-INVARIANTS.md), [TV-3.0](./TV-3.0-PostgreSQL-Physical-Data-Strategy-Freeze.md) |
| **Independent of** | TV-4 (PostGIS physical tuning) |
| **Non-goals** | Spatial index tuning, PostGIS cold start, QGIS installation, UI implementation |

---

## 1. Purpose

TV-S1 freezes Mimer's **spatial governance layer**: how spatial conclusions are produced,
verified, reproduced, audited, and stored in CAS — without the GIS engine becoming an
authority source.

TV-S1 and TV-4 sit on different axes and MUST NOT be sequenced against each other:

| Track | Question it answers |
| --- | --- |
| TV-4 | How PostGIS runs (physical performance) |
| TV-S1 | What spatial intelligence and verification *mean* (semantics, evidence, replay) |

The contract layer is frozen **before** optimization, so that optimization cannot shape
the contract.

---

## 2. Spatial Authority Model (FRYST)

```
                 CAS
                  │
        Canonical Spatial Evidence
                  │
                  v
        Spatial Verification Layer
          /                 \
 Spatial Engine          Human Review
          \                 /
                  │
          Governance Decision
                  │
                  v
                 CAS
```

| Component | Role |
| --- | --- |
| Spatial engine (QGIS, GRASS, PostGIS, GDAL) | Computes geometry. Never authority. |
| Mimer Runtime | Produces decisions. Never the spatial analyst. |
| CAS | Canonical truth. Never a GIS layer. |

---

## 3. Engine role (FRYST)

**Permitted:** spatial operations, geometry handling, raster analysis, overlay and
intersection, buffer analysis, topology checks, visualisation, expert review.

**Forbidden:** creating decisions, creating identity, writing canonical truth, replacing
CAS, mutating evidence.

```
Engine produces evidence.
Runtime produces decision.
CAS produces authority.
```

**Invariant SV-I01 — Spatial engine is never authority**

A spatial engine SHALL NOT create Decision Authority. Spatial evidence enters the
authority chain only as **input** to the registered Materialization Authority (MAT-I05);
it SHALL NOT bypass it.

---

## 4. Spatial Query Contract (FRYST)

The contract between Planner and the Spatial Verification Layer.

```json
{
  "query_id": "sq_123",
  "operation": "buffer_intersection",
  "target": { "property_ref": "ABC 1:23" },
  "layers": [
    { "name": "water_protection", "version_hash": "abc123" }
  ],
  "parameters": { "distance_m": 300 }
}
```

The contract is immutable. A changed analysis is a new identity, never an edited contract.
Every input layer is referenced by `version_hash`, never by layer name alone — a name
resolves differently over time and would silently break replay.

---

## 5. SpatialEvidenceArtifact (FRYST)

An engine result becomes an artifact, not a GIS layer.

```json
{
  "artifact_type": "SpatialEvidenceArtifact",
  "spatial_canonical_version": "sv-canonical-1",
  "artifact_id": "hash",
  "input_artifacts": ["property_hash", "layer_hash"],
  "operation": {
    "algorithm": "buffer_intersection",
    "engine": "QGIS",
    "engine_fingerprint": {
      "qgis": "3.34.4",
      "geos": "3.12.1",
      "proj": "9.3.1",
      "gdal": "3.8.3",
      "proj_data": "1.16"
    }
  },
  "parameters": { "distance_m": 300 },
  "result": {
    "geometry_hash": "abc123",
    "measurements": { "distance_m": 142.7 }
  },
  "provenance": {
    "created_by": "SpatialVerificationLayer",
    "executed_at": "2026-08-07T14:12:03Z",
    "runtime_manifest": "manifest_hash"
  }
}
```

Evidence is immutable, hashed, and replayable.

### 5.1 Identity domain vs provenance (FRYST)

| Identity inputs (in the hash domain) | Provenance (excluded from identity) |
| --- | --- |
| `spatial_canonical_version` | `executed_at` |
| `input_artifacts` | `created_by` |
| `algorithm`, `parameters` | `runtime_manifest` |
| `engine_fingerprint` | operator / host / session |

**Invariant SV-I02 — SpatialEvidenceArtifact is immutable**

Same hash, different bytes is impossible (CAS-I02). Corrections create a new identity.

**Invariant SV-I06 — Provenance isolation**

Wall-clock time, host, and operator SHALL NOT enter the identity domain. An execution
timestamp inside the hash would make identical re-execution produce a different hash, i.e.
replay would be unsatisfiable by construction. Provenance is recorded beside identity and
is required for audit, not for identity.

### 5.2 Engine version is an identity input (FRYST)

**Invariant SV-I03 — Version-identified spatial operation**

The engine fingerprint SHALL be exact and complete. A wildcard such as `"3.x"` is not a
version and SHALL be rejected.

The fingerprint covers the whole geometry stack, not only the front-end application:
GEOS changes overlay and predicate implementations, PROJ changes reprojection when datum
grids are updated, and GDAL changes raster resampling. Two runs that differ in any of
these can produce different bytes for the same logical operation.

Consequence for engine substitutability: because the fingerprint is in the hash domain,
the *same* operation executed on a different engine yields a *different* evidence
identity. Cross-engine agreement is therefore a **verification claim**, never an identity
claim. Replacing QGIS with PostGIS-native or GRASS does not invalidate historical
evidence; it produces new evidence that may be compared against it.

### 5.3 Canonical geometry serialization (FRYST)

`geometry_hash` is meaningless without a canonical byte form. The `sv-` canonical version
namespace is owned by the Spatial Governance Domain, on the same terms as `dg-`
(see [ADR-MPS-CONSTITUTIONAL-INVARIANTS](./ADR-MPS-CONSTITUTIONAL-INVARIANTS.md), C-02).

**Invariant SV-I07 — Canonical geometry form**

`sv-canonical-1` SHALL fix, at minimum:

| Aspect | Rule |
| --- | --- |
| CRS | Explicit SRID; no implicit reprojection |
| Axis order | Fixed and declared |
| Coordinate precision | Fixed decimal grid; coordinates rounded before serialization |
| Ring orientation | Normalized (exterior / interior fixed) |
| Vertex and component order | Normalized so that geometrically equal results serialize equally |
| Empty and null geometry | Explicit, distinguishable encoding |
| Measurements | Rounded to a declared precision before entering the hash domain |

Floating point noise SHALL NOT be allowed to change identity. Unrounded doubles in
`measurements` would make identity depend on the last bit of an IEEE-754 result.

---

## 6. Human Review Session (FRYST)

The human reviews **evidence**, not AI prose.

```json
{
  "type": "SpatialReviewArtifact",
  "evidence_ref": "SpatialEvidenceArtifact hash",
  "review": {
    "decision": "approved",
    "comment": "verified against map"
  },
  "reviewer_identity": "..."
}
```

**Invariant SV-I04 — Review binds to an exact evidence hash**

A review SHALL reference one exact `SpatialEvidenceArtifact` hash. Reviews of "the current
version" of anything are forbidden, because they cannot be audited afterwards.

**Invariant SV-I05 — UI interaction never creates authority**

Opening, panning, styling, or querying a map creates no authority. Only an emitted,
identity-bound review artifact does.

A rejection does not edit evidence. It records a rejecting review, and any corrected
analysis enters as new evidence with supersession through lineage.

---

## 7. DecisionVerificationArtifact (FRYST)

Binds spatial evidence, human verification, and the governance decision.

```json
{
  "type": "DecisionVerificationArtifact",
  "evidence": ["spatial_hash"],
  "review": "review_hash",
  "status": "verified"
}
```

This artifact records that verification happened. It does not itself confer Decision
Authority — that remains with the registered Materialization Authority (MAT-I05).

---

## 8. Replay model (FRYST)

Replay of spatial evidence requires:

- the `SpatialEvidenceArtifact`
- input layer hashes
- exact engine fingerprint
- algorithm identifier and parameters
- `spatial_canonical_version`

```
same input
+ same algorithm
+ same version
= same spatial evidence
```

The runtime manifest and execution timestamp are recorded for audit and are **not** replay
inputs (SV-I06). A replay that reproduces the identity hash confirms determinism; a replay
under a different engine fingerprint is a comparison, not a reproduction (SV-I03).

---

## 9. Runtime integration (FRYST)

The runtime sees spatial analysis as a capability, not as a vendor.

```
Capability Definition
        │
Spatial Verification Capability
        │
Engine Provider (QGIS | PostGIS | GRASS | GDAL)
        │
Execution Session
        │
Artifact Output
```

Any engine implementing the Spatial Query Contract and the canonical geometry form may act
as provider. PostGIS-native execution is a first-class provider, not a fallback: for vector
predicates and joins it is already the sanctioned operational spatial engine under TV-3.0.

---

## 10. Governance Invariants (FRYST)

| ID | Rule |
| --- | --- |
| SV-I01 | Spatial engine SHALL never become authority |
| SV-I02 | SpatialEvidenceArtifact SHALL be immutable |
| SV-I03 | Spatial operation SHALL be exactly version-identified across the whole geometry stack |
| SV-I04 | Human review SHALL reference an exact evidence hash |
| SV-I05 | UI interaction SHALL never create authority |
| SV-I06 | Provenance (time, host, operator) SHALL stay outside the identity domain |
| SV-I07 | Geometry and measurements SHALL be canonically serialized before hashing |

---

## 11. Explicit forbidden actions under TV-S1

- Writing engine output to CAS as Decision Authority, bypassing MAT-I05
- Recording an engine version as a range or wildcard
- Hashing raw engine output without canonical geometry serialization
- Placing execution timestamps or operator identity in the identity domain
- Referencing input layers by name instead of `version_hash`
- Editing evidence in response to a rejected review
- Treating a reviewed map view as verification without an emitted review artifact

---

## 12. Definition of Done (TV-S1)

| Criterion | Status |
| --- | --- |
| Spatial authority model frozen | ✅ |
| Engine role and prohibitions frozen | ✅ |
| Spatial Query Contract frozen | ✅ |
| SpatialEvidenceArtifact shape and identity domain frozen | ✅ |
| Review and verification artifacts frozen | ✅ |
| Replay model frozen | ✅ |
| SV-I01–SV-I07 frozen | ✅ |
| `sv-canonical-1` serialization rules specified in code | ❌ implementation phase |
| Engine provider implementation | ❌ implementation phase |
| PostGIS cold start / TV-4 tuning | ❌ separate track |

---

## Related

- [TV-4.3 — Spatial Processing Compatibility Requirements](./TV-4.3-Spatial-Processing-Compatibility.md)
- [TV-3.0 — PostgreSQL Physical Data Strategy Freeze](./TV-3.0-PostgreSQL-Physical-Data-Strategy-Freeze.md)
- [ADR-MPS-CAS-STORAGE-BOUNDARY](./ADR-MPS-CAS-STORAGE-BOUNDARY.md)
- [ADR-MPS-SINGLE-MATERIALIZATION-AUTHORITY](./ADR-MPS-SINGLE-MATERIALIZATION-AUTHORITY.md)
- [ADR-MPS-CONSTITUTIONAL-INVARIANTS](./ADR-MPS-CONSTITUTIONAL-INVARIANTS.md)
