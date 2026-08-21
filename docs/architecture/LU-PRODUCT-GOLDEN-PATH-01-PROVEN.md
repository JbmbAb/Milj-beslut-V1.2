# LU-PRODUCT-GOLDEN-PATH-01 — IMPLEMENTED / PROVEN

**Status:** IMPLEMENTED / PROVEN. ORSA STACKMORA 3:12 (project `cmt2m7bdj0000h0f7uj4jykis`) runs
end to end through the real authenticated product path to a genuine `ASSESSED` verdict, for the
first time in this track:

```
authenticated project -> verified ProjectContextBinding -> canonical property/site identity
-> canonical property geometry -> governed SpatialEvidence -> verified ExecutionIdentity
-> ExecutionKernel -> LocalizationAssessmentArtifact -> outcome + attestation
-> verified ViewerIdentity/ProductViewerCapability -> fresh reopen -> replay
```

## What was wired (the last remaining gap)

`generate-localization-report.usecase.ts`'s `analyzeSite()` still called
`runLuAssessmentViaKernel` with `site_id: site.id` (the caller-chosen UI alternative label, e.g.
"golden-path-run") and `deterministic_seed: 'lu-seed-'+site.id` — exactly the kind of
non-canonical value `LU-EXECUTION-AUTHORITY-BOOTSTRAP-01`'s already-issued identity could never
match. Fixed:

- `resolveCanonicalProjectContext()` extended to also return `propertyIdentity` (from
  `ProjectPropertyBindingArtifact.property_identity`) and `contextBindingRef`.
- New `resolveCurrentProductRelease()` — resolves and verifies the current product release from
  the real CAS (defaults to the one real release in this environment,
  `product-release-772aceb600c4690777593ea8`; overridable via env for a future multi-release
  environment — a named, not silent, simplification).
- `analyzeSite()` now derives `site_id`/`deterministic_seed` via `deriveLuExecutionSeed()` over
  the same canonical tuple the bootstrap script used, so the usecase resolves the SAME
  already-issued `ExecutionIdentityArtifact` rather than needing (or being able) to mint its own.
  `site.id` remains what it always was — the UI-facing alternative label for cross-site
  comparison — deliberately not conflated with the cryptographic execution identity.

## A second real defect found and fixed while proving

The already-issued `ViewerIdentityArtifact`/`ProductViewerCapabilityArtifact` from
`VIEWER-IDENTITY-AUTHORITY-BOOTSTRAP-01` were signed with Ed25519 keys generated fresh, in-process,
inside that unit's proof script — and never persisted to `~/.mimers/secrets`, unlike every other
issuer this session (`project-context-binding-issuer-v1`, `lu-execution-authority`). That made
those specific artifacts practically unverifiable and non-reopenable outside the single process
that minted them — not a real "persistent, fresh-reopenable" authority, discovered only by
actually trying to fresh-reopen them here.

Fixed with `scripts/ops/bootstrap-viewer-authority-persistent.ts`: generates real Ed25519 keypairs
for both issuers, persists them to `~/.mimers/secrets/{viewer-identity-issuer-v1,viewer-capability-issuer-v1}/`,
and mints one fresh, properly-persisted `ViewerIdentityArtifact`
(`viewer-identity-6b049e1012b59ef2d6726fd6`) and `ProductViewerCapabilityArtifact`
(`viewer-capability-b9dc302c42d332400659e4c2`) for the golden-path project, superseding the
now-unverifiable ones from the prior unit's proof run. The trust-chain design itself
(`VIEWER-CAPABILITY-ISSUER-TRUST-CHAIN-V1`, `VIEWER-IDENTITY-AUTHORITY-BOOTSTRAP-01`) was not
changed — only the key material's persistence.

## Real end-to-end proof, against the real Mimer CAS and real DB

`scripts/db/lu-product-golden-path-01.ts`:

| Step | Result |
|---|---|
| authenticated project runs the real usecase | **PASS** |
| `ExecutionKernel` admission | **PASS** — `admitted: true` |
| real canonical context used | **PASS** — `property_context_id: lu_property_context-f2b20ff82a5870738e316d47` |
| `assessment_status` | **`ASSESSED`** |
| `LocalizationAssessmentArtifact` persisted | **PASS** — `assessment-f2e1695348242a7e1a2a5b57282f6cd061ee7d6c248a5ecd6573330383058843`, resolved fresh from real CAS |
| outcome + attestation persisted | **PASS** |
| replay without live PostGIS/source recomputation | **PASS** — `DefaultReplayEngine.replay(manifest_ref, state)` has no spatial-provider/PostGIS dependency in its signature or implementation; it resolves only the persisted manifest and the in-memory `RuntimeState.attempt` |
| verified `ViewerIdentity` + `ProductViewerCapability` for this project/release | **PASS** (using the newly re-persisted keys) |
| fresh reopen (separate process, real CAS, real DB, no private keys) | **PASS** |

`npx tsc --noEmit`: 98 pre-existing errors, identical file set — zero new.
`npx vitest run --project unit` (localization/viewer-scoped): 124 passed; 1 unrelated pre-existing
`.data/mimers/cas` filesystem failure, same as every prior unit this session, in a file this unit
never touched.

## What this does not claim

- `finding_ids: []` for this run — the golden-path evidence layer (governed spatial evidence at
  this exact coordinate, document evidence) produced no rule hits on this run's real PostGIS
  query. That's an honest result of the real spatial/rule evaluation, not a gap in this unit's
  scope.
- Several upstream data sources (NVR, RAA, VISS SGU raw layers) returned real errors during this
  run (schema/relation mismatches in this environment's PostGIS install, e.g.
  `relation "topo10.vatten" does not exist`) — captured as `warnings` in the report, exactly as the
  existing `DataSourceStatus`/warnings machinery is designed to surface. Fixing those data-source
  schema gaps is out of scope for this unit (context/execution/viewer authority), not silently
  absorbed into "assessed."

## Closure

```
LU-EXECUTION-AUTHORITY-BOOTSTRAP-01                IMPLEMENTED / PROVEN
PRODUCT-LU-CONTEXT-AND-EVIDENCE-BINDING-V1          IMPLEMENTED / PROVEN
LU-PRODUCT-GOLDEN-PATH-01                           IMPLEMENTED / PROVEN
```

The full authority chain this multi-unit track built is now closed and exercised end to end for a
real product project, not merely proven in isolation per-layer.
