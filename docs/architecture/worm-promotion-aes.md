# WORM Promotion Namespace (AES-1.0)

## Invariants

1. **`promotion/{artifactId}`** contains only sealed `PromotionArtifactV3` artifacts that were created **after** an approving `ApprovalRecord`. Content-addressed: `artifactId === artifactHash`.
2. **`approval/{approvalId}`** points at a **candidate** via `subjectId` / `subjectType: 'promotion-candidate'`. It never points forward at a promotion artifact id.
3. **`PromotionArtifactV3.approvalRecordId`** is required and points back at the approval that authorized creation.
4. **Rejected candidates** never receive a `PromotionArtifactV3`. The complete audit trail is `ExperimentRecord` + `ApprovalRecord`.
5. **`promotion-approved/`** is legacy. New writes must not use it.
6. **WORM:** never mutate a sealed promotion (including approval attach or rollback flags). Future rollback = new `RollbackRecord` pointing at a prior `artifactId` (ActivationController).

## Create order

```
ExperimentRecord
  → PromotionCandidate
  → ApprovalGate.approve(candidate)
  → ApprovalRecord (subjectId = candidateId)
  → if approved: createPromotionArtifactV3({ approvalRecordId }) → promotion/{artifactId}
  → if rejected: stop (no promotion/)
```

## Migration

- **Lazy** `ArtifactMigrationRegistry.migrateToLatest`: only for reading a known parent / single artifact. Produces unsigned V3 with `approvalRecordId: legacy:unlinked:…`.
- **One-shot** `scripts/artifact/migrate-promotion-worm-v1.ts`:
  - `promotion-approved/*` → reconstruct ApprovalRecord + V3 → `promotion/{newArtifactId}`
  - `promotion/*` not in approved set → `legacy-rejected-promotion/{id}` (never into new `promotion/`)

```bash
npx tsx scripts/artifact/migrate-promotion-worm-v1.ts --root ./tmp-artifacts --dry-run
```
