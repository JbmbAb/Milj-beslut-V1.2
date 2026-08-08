# ADR — Sanerad PostGIS Rebuild & Spatial Data Contract

## Status

**ACCEPTED / SEQUENCE FROZEN** — rebuild not started.

PostGIS is a **rebuildable projection** of `GEO_Master_Archive` (Mimers Brunn v2.0.1).
The existing PostGIS instance must be **sanitized and replaced**, not incrementally patched.

Magic Moment application chain remains **FROZEN / PROVEN** (`9c200a7`).
It becomes the **acceptance test** after the new PostGIS is populated — not a reason to keep the old DB.

L3 rechunk remains **PAUSED** until the new data foundation is established.

## Frozen rebuild sequence

```text
1. MASTER INVENTORY
2. SOURCE AUTHORITY / PROVENANCE
3. NEW POSTGIS DATA CONTRACT          ← freeze before any empty DB
4. SANERAD TOM POSTGIS                ← only after contract freeze
5. IMPORT + VALIDATION
6. SPATIAL LAYER REGISTRY             ← rebind to contracted layers
7. SPATIAL PROVIDER
8. LU BROAD COVERAGE
9. PERFORMANCE BENCHMARK              ← realistic population only
```

**Do not** create a new PostGIS immediately after inventory.
**Do not** copy old tables “just in case.”
**Do not** optimize or add GiST from the tiny `riskguard_test` baseline.

## Authority boundary

```text
External Authority
      ↓
GEO_Master_Archive (SoT) + HarvestManifest / SHA
      ↓
Deterministic Import (Librarian / IMPORT_REGISTRY)
      ↓
Sanerad PostGIS (projection)
      ↓
Versioned Spatial Layers
      ↓
SpatialEvidenceArtifact → LU
```

### May enter new PostGIS

| Class | Rule |
|---|---|
| **MASTER / authoritative** | Present under `GEO_Master_Archive/Data/<Provider>/…` with manifest + checksum; mapped in `IMPORT_REGISTRY` |
| **Contracted projection** | Has a frozen layer contract (below) before first import |

### Must NOT auto-carry into new PostGIS

| Class | Examples |
|---|---|
| Legacy derived tables | Ad-hoc views, undocumented merges |
| Temporary cache | API response dumps, session caches |
| Old API projections | Live-only tables without master harvest |
| Manual copies | One-off shapefile loads without SHA/manifest |
| Experimental / unused env tables | Present in old DB but not in master inventory admit list |

Old PostGIS row counts (`data-coverage-gaps.md`) are **historical projection status only**, not admit criteria.

## New PostGIS data contract (per layer)

Every admitted spatial layer SHALL have:

| Field | Meaning |
|---|---|
| `layer_id` | Stable logical id (e.g. `lu.water_wells`, `lu.ebh`) |
| `source_id` | Master path key / IMPORT_REGISTRY key |
| `source_version` | Provider or archive version label |
| `version_hash` | Content identity (SHA of archive bundle or canonical payload) |
| `srid` | Target CRS — SWEREF99 TM **3006** for LU spatial |
| `geometry_type` | Point / MultiPolygon / … |
| `validity_rules` | Non-empty geom, SRID, required columns, fail-closed |
| `provenance` | Provider, license, harvest timestamp, manifest ref |
| `import_timestamp` | When projection was materialized |

Unknown `layer_id` at SpatialProvider → fail closed (same spirit as current `SpatialLayerRegistry`).

## Import priority (after empty engine)

Exact LU admit-set is decided from the master inventory. Default order:

```text
Property / core.property_unit foundation
      ↓
Core spatial foundation (topo / register geometry as required)
      ↓
LU high-value layers (inventory admit list)
      ↓
Secondary environmental layers
```

HITL / app-unique tables may be restored from dump; geodata must be re-imported from master.

## Acceptance

Magic Moment E2E against the **new** database:

```text
VÄSTERÅS 1:1
  → property_unit
  → LU_PROPERTY_CONTEXT
  → water / ebh / protected_area (contracted layers)
  → SpatialEvidenceArtifact + CAS identity
  → Kernel + rules
  → LocalizationAssessmentArtifact
  → LuWorkspace
```

Import success alone is insufficient.

## Explicitly paused until foundation is established

- TEXT-L3 v2.3 rechunk
- PostGIS “optimization” / blind GiST on old DB
- New Magic Moment layers on the old PostGIS
- Full corpus migration
- Cache layers over dirty PostGIS

## Inventory artifact

Living master inventory (step 1–2):  
`docs/architecture/MASTER-SPATIAL-SOURCE-INVENTORY.md`

## References

- `docs/architecture/mimers-brunn-v2.0.1.md`
- `docs/architecture/ADR-SPATIAL-QUERY-CONTRACT.md`
- `scripts/import/config/importRegistry.ts`
- `.cursor/skills/mimers-postgis-cold-start/SKILL.md`
