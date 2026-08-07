# Roadmap — Capability Expansion

| Field | Value |
| --- | --- |
| **Status** | **DIRECTIONAL** — not frozen, not a commitment |
| **Date** | 2026-08-07 |
| **Purpose** | Keep future domain engines cheap to add, without building them now |
| **Relates to** | [TV-S1](./TV-S1-Spatial-Verification-Layer.md), [TV-4.3](./TV-4.3-Spatial-Processing-Compatibility.md), [TV-3.0](./TV-3.0-PostgreSQL-Physical-Data-Strategy-Freeze.md) |

> Everything else in this folder marked FRYST is binding. **This document is not.**
> It records direction and open decisions. Nothing here may be cited as an approved
> commitment, and no invariant is created by this file.

---

## Guiding principle

```
Do not build tomorrow's features today.
Build the boundaries that make tomorrow's features cheap.
```

The expensive mistakes are not missing features. They are boundaries drawn so that a later
feature requires rebuilding the core: an identity that cannot express a new engine, a table
that cannot express time, a registry that hardcodes today's layers.

---

## Phase 1 — Core engine (current)

**Goal:** a verifiable spatial decision platform.

```
CAS → Artifact Model → Runtime → Capability Registry → PostGIS → QGIS / GDAL
```

Delivered surfaces: property search, spatial evidence, document linkage, environmental
decisions, replay, governance.

### Honest status

The constitutional layer is frozen and green: CAS boundary, single materialization
authority, retrieval governance, query budget, retrieval trace, and now the spatial
verification contract.

**Enforcement lags design.** In `mps-lu` the spatial evidence path produces artifacts whose
`content_hash` covers only layer, coordinate, and property reference — not geometry, query
parameters, dataset version, or algorithm. Layer and dataset versions are literal
`"latest"`. A failed spatial query is logged and skipped rather than producing a failure
artifact, so absence of evidence is indistinguishable from absence of risk. Until this is
closed, TV-S1's guarantees hold on paper only.

Closing that gap is the first implementation task, ahead of any new capability.

---

## Phase 2 — Spatial Intelligence Foundation

Prepared now, built later. Only four things must be right; everything else can wait.

### 2.1 Spatial Layer Registry

Not `table_name + geometry`, but:

| Field | Why it must exist from the start |
| --- | --- |
| `layer_id` | Stable logical name, decoupled from physical table |
| `source_artifact` | Ties the layer to CAS; without it the layer has no provenance |
| `authority_class` | Distinguishes authoritative source data from derived projections |
| `temporal_validity` | Layers change; a query without time is ambiguous |
| `resolution` | Raster and generalized vector need it for valid comparison |
| `coverage` | Prevents silent false negatives outside the data extent |

Today `mps-lu` hardcodes a three-entry `LAYER_TABLE_MAP`. Replacing that map with the
registry is the concrete first step, and it costs almost nothing while there are three
layers rather than thirty.

Future layers — hydrografi, pipe networks, raster, sensors, climate data — then require no
new architecture.

### 2.2 Capability Registry

The most important preparation. Runtime resolves an operation, never a vendor:

```
spatial.intersection   spatial.buffer   spatial.distance
        ↓
   Provider (PostGIS | QGIS | GDAL)
```

Later, with no runtime change:

```
hydrology.runoff_model   water.network_simulation
carbon.calculate         stormwater.dimension
```

Naming rule: operation, never product (`spatial.buffer`, not `qgis.buffer`). See TV-4.3
SPC-R08. Note the consequence already frozen in TV-S1 §5.2 — swapping the provider produces
a new evidence identity, so provider substitution is a forward decision, not a retroactive
one.

### 2.3 Time dimension

Easy to miss and expensive to retrofit, because adding time to an existing identity changes
every hash. Environmental systems are almost always time-dependent.

| Field | Meaning |
| --- | --- |
| `valid_from` / `valid_to` | When the fact was true in the world |
| `observed_at` | When it was measured |
| `created_at` | When the record was written |

These are three different questions and SHALL NOT be collapsed into one column. With them
in place, historical change, climate scenarios, before/after analysis, and operational
monitoring become queries rather than projects.

Note the identity rule from TV-S1 SV-I06: `observed_at` and `valid_from` describe the
world and may be identity inputs; `created_at` is provenance and must stay out of the hash
domain.

### 2.4 Sensor readiness

Not IoT now. Only make sure the model can express an observation:

```
sensor → measurement → timestamp → location → quality → CAS
```

**The decision that must be made before the first sensor write:** a sensor reading is a
primary observation. It cannot be rebuilt from CAS unless it entered CAS at ingest. If
telemetry lands only in PostgreSQL, PostgreSQL becomes authority and PHYS-I01 / PHYS-I06
are violated on day one.

Telemetry is also a different physical class — high-volume, append-only — and SHALL NOT
inherit the governance table strategy from TV-3.0.

---

## Phase 3 — TV-S5 Environmental Simulation Layer (reserved)

Not to be implemented. The slot is reserved so that later work has a defined shape:

```
Spatial Evidence → Simulation Capability → Simulation Artifact → CAS
```

Candidate capabilities, by domain:

| Domain | Capabilities |
| --- | --- |
| Hydrology | `water.flow_analysis`, `catchment.analysis`, `flood.risk` |
| Stormwater | `stormwater.capacity`, `retention.calculate`, `infiltration.analysis` |
| Water networks | `pipe.network_analysis`, `pump.optimization`, `water_quality.simulation` |
| Climate | `carbon.calculate`, `climate_scenario`, `adaptation.analysis` |

Most of this science is public domain (EPANET for network hydraulics, established runoff
and dimensioning methods). The differentiator is not the solver — it is that a simulation
becomes a replayable artifact bound to environmental evidence.

**Normative rule sets are identity inputs.** A stormwater calculation performed under a
given Svenskt Vatten publication edition (P110, P105) and a given rainfall intensity
formula must record which edition it used, exactly as `rule_version` works for decisions.
When the recommendation is revised, old calculations must remain reproducible instead of
silently changing.

---

## Separate data from models

The failure mode:

```
SGU data → special-purpose function → report
```

The pattern that scales:

```
Source Artifact + Spatial Model Artifact + Capability + Execution → Evidence Artifact
```

The same source data then serves environmental permitting, water and sewage, climate work,
planning, and supervision — without a bespoke pipeline per use case.

---

## Current focus — LU (lokaliseringsunderlag)

Spatial expansion is designed backwards from LU. The question is not "what GIS functions
could we build" but "what evidence does LU need to make a correct assessment".

### LU evidence chain

```
Property
   ├── SpatialEvidenceArtifact
   ├── DocumentEvidenceArtifact
   ├── RuleArtifact
   └── DecisionArtifact
```

### Order

1. LU pipeline complete (source → import → normalization → artifact → retrieval → analysis → report)
2. Artifact verification enforcement — hashes bind content, provenance traceable, replay executable, decisions point at evidence
3. LU report / replay / governance
4. Prepare dataset admission
5. LM Hydrografi once approved
6. TV-4 measurement and optimization

Steps 1 and 2 are in practice one task: the pipeline already reaches the report, but the
artifacts do not yet carry the identity they claim. Hydrografi is then not a new project —
it is the next source artifact into a finished engine.

PostGIS and QGIS remain preparation only: SRID 3006 handling, the layer registry, the
capability interface, and the source artifact contract. Then wait.

---

## Open decisions — cheap now, expensive later

| Decision | Why timing matters | Reference |
| --- | --- | --- |
| Pin the geometry stack (GEOS / PROJ / GDAL) | Stack is in the evidence identity domain; upgrading after first evidence changes every identity | TV-4.3 SPC-R09 |
| GDAL driver allowlist | Currently zero drivers enabled; out-db raster cannot read anything | TV-4.3 SPC-R03 |
| Read-only GIS role | Default privileges must be set before tables exist | TV-4.3 SPC-R07 |
| `pgrouting` absent from image | Network analysis is an image decision, not `CREATE EXTENSION` | TV-4.3 §9 |
| Telemetry enters CAS at ingest | Otherwise PostgreSQL silently becomes authority | §2.4 |
| Rule-set edition as identity input | Recalculation must survive a revised recommendation | §Phase 3 |
| Time columns before identity is fixed | Adding time later rewrites hashes | §2.3 |
| Resolve duplicate TV-S1 document | Two frozen documents contradict each other on replay | — |

---

## What not to build

Building a water-and-sewage system, a climate model, an IoT platform, or a hydraulic engine
too early is the main threat, because each one is a product in its own right with its own
customer.

```
Build the core.
Freeze the contracts.
Create the registries.
Guarantee lineage.
Add domain engines when the market demands them.
```
