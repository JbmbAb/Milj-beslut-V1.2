# ADR-21-04: Migration Delegation

## Status
Accepted (Paket 21 Prerequisites)

## Context
When artifact schemas evolve, we must migrate existing data without fragmenting the responsibility of migration logic. Allowing multiple engines or upgrade classes to implement their own migration logic creates inconsistency and breaks the integrity of historical data proofs.

## Decision
All schema migration logic is strictly delegated to a single registry.

### Normative Rules

1. **ArtifactUpgradeEngine SHALL delegate migration to ArtifactMigrationRegistry.**
2. **ArtifactUpgradeEngine SHALL NOT implement schema migration logic independently.**
3. **Migration SHALL invalidate signatures.**
4. **Migration SHALL NOT preserve historical signatures.**
5. **Migration SHALL emit a MigrationRecord.**

## Consequences
- Responsibility for defining migration paths resides entirely within `ArtifactMigrationRegistry`.
- Data provenance is preserved via `MigrationRecord`, but cryptographic signatures of the old data are intentionally dropped since the canonical bytes have changed.
