# Governed storage root contract

Greenfield governed Mimer storage plane. Legacy GEO archive and Docker runtime
mirror are **not** governed Master / CAS / quarantine authority.

| Variable | Role |
| --- | --- |
| `MIMERS_ROOT` | Runtime / config / secrets only (trust, reviewer registry, signing key dirs). **Not** production CAS. |
| `MASTER_ARCHIVE_ROOT` / `GEO_MASTER_ARCHIVE` | Legacy GEO source archive only (may be `H:`). **Not** DatasetApproval Master. |
| `MASTER_ARCHIVE_HOST_PATH` | Non-authoritative Docker / runtime mirror host path only. |
| `GOVERNED_MASTER_ROOT` | New governed Master. Required for DatasetApproval persistence. |
| `CAS_ROOT` | Canonical production CAS physical directory. Consumed by MimersIntegration and persistent Mimers backend. Basename must be `cas` when a sibling ledger is derived (`<parent>/ledger`). |
| `QUARANTINE_ROOT` | Raw acquisition quarantine (`DiskQuarantineStorage` / harvest execute). |

## Two intentional quarantine layers

1. **Raw acquisition:** `QUARANTINE_ROOT`
2. **DatasetApproval governance staging:**  
   `<GOVERNED_MASTER_ROOT>/National_Archive/_quarantine/{approvals,checkpoints}`

These are different stores. Do not collapse them.

## Initial data entry

```text
EXTERNAL SOURCE → LOKE → NEW RAW QUARANTINE → provenance → DatasetApproval
  → ImportGate → NEW GOVERNED MASTER / CAS → derived PostGIS
```

No bulk copy from `H:`, runtime mirror, old PostGIS, old CAS, or historical quarantine.
