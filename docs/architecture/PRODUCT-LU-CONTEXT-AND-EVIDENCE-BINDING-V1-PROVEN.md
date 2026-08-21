# PRODUCT-LU-CONTEXT-AND-EVIDENCE-BINDING-V1 — IMPLEMENTED / PROVEN

**Status:** IMPLEMENTED / PROVEN for everything named in scope: the `proj-*`/`prop-*`/`geom-*`
synthetic-ID fallback, the synthetic lat/lng document-evidence fallback, the `lu-workspace`
project fallback, and the `fixture` viewer default are all removed from the active product path
and replaced with real, verified resolution. Two real security defects were found and fixed
along the way, per standing instruction, without opening a new design round.

## What was removed and what replaced it

| Fallback | Was | Now |
|---|---|---|
| `proj-${ctx.projectId}` / `prop-${site.id}` / `geom-${site.id}` | Fabricated a brand-new `LU_PROJECT_CONTEXT`/`LU_PROPERTY_CONTEXT`/geometry ref on every run, written straight to CAS | `resolveCanonicalProjectContext()` resolves the project's real, already-issued `ProjectContextBindingArtifact` from Postgres + CAS, fully verifies its issuer-trust chain, and returns the real refs. Fails closed if none exists for the project — never fabricates one. |
| Synthetic lat/lng document evidence | A hand-built 0.002°-square bbox `Polygon` derived from raw lat/lng, used whenever no governed `documentEvidenceRefs` were supplied | The real, resolved `CANONICAL_PROPERTY_GEOMETRY` (a real `MultiPolygon` parcel boundary) is used instead. |
| `LuWorkspace`'s `getActiveProjectId() \|\| 'lu-workspace'` | Silently ran the whole assessment under a fake project id when nothing was selected | Fails closed: shows "Inget aktivt projekt valt" and refuses to run. |
| `CesiumMapView` `evidenceMode` default `'fixture'` | `LuWorkspace` started every session in fixture (non-live) mode | Defaults to `'live'`. `'fixture'` remains available as an explicit user toggle inside `CesiumMapView` itself (a legitimate dev/comparison feature, not deleted) — it is no longer this workspace's silent starting state. |

## Real security defects found and fixed (per standing instruction, no new design round)

The instruction was explicit: if any authority artifact in a boundary this unit passes through is
verified only through a narrow signed predicate without recomputing the full canonical payload,
treat it as a concrete defect and fix it using the already-established invariant
(`validate*Artifact`: recompute canonical identity/content_hash from the current payload, compare,
reject on mismatch — the same pattern used for `AdminRoleGrantArtifact`,
`ProductViewerCapabilityArtifact`, and `ViewerIdentityArtifact`).

Two instances found, both fixed:

1. **`verifyProjectContextBindingArtifactAuthority`** (`server/modules/localization/projectContextBindingAuthority.ts`)
   verified the issuer artifact structurally, but never validated the `ProjectContextBindingArtifact`
   or `ProjectPropertyBindingArtifact` being verified — it only compared `attestation.subjectDigest`
   against the artifact's own (possibly stale) `content_hash`, and the attestation `predicate` only
   covers a narrow field subset (`action`, `issuer_purpose`, `project_id`, ...). A payload field the
   predicate doesn't echo (`project_context_ref`, `geometry_ref`, `binding_version`, ...) could be
   tampered while `content_hash` stayed stale, and the check would still pass. Fixed by calling
   `validateProjectContextBindingArtifact`/`validateProjectPropertyBindingArtifact` first.
2. **`ProjectPropertyBindingArtifact`** had no `validate*` function at all. Added
   `validateProjectPropertyBindingArtifact` (recompute-and-compare), matching the pattern already
   present for `ProjectContextBindingArtifact`.

Live proof this unit's "tampered ProjectContextBinding" negative now correctly rejects with
`content_hash does not match canonical payload (tampered)` — before this fix, that exact tamper
would have gone undetected by this verification path.

## Real end-to-end proof, against the real Mimer CAS and the real DB

`scripts/db/product-lu-context-and-evidence-binding-v1.ts`:

| Static proof (source-level, UNREACHABLE) | Result |
|---|---|
| `proj-${ctx.projectId}` fallback present | **false** |
| `prop-${site.id}` fallback present | **false** |
| `geom-${site.id}` fallback present | **false** |
| synthetic lat/lng bbox present | **false** |
| `'lu-workspace'` fallback present | **false** |
| `fixture` default present | **false** |

| Runtime proof | Result |
|---|---|
| real `ProjectContextBinding` resolves for `cmt2m7bdj0000h0f7uj4jykis` | **PASS** — `propertyDesignation: ORSA STACKMORA 3:12`, real non-synthetic refs |
| real assessment run uses the resolved real context, never fabricates one | **PASS** — `executionMotor.property_context_id` equals the resolved real `lu_property_context-f2b20ff82a5870738e316d47`, not a `prop-*` id |
| no fabricated context artifact written to CAS during the run | **PASS** |

| Negative | Result |
|---|---|
| missing/unbound `ProjectContextBinding` | **FAIL CLOSED** (`REJECT_PROJECT_CONTEXT_BINDING_UNAVAILABLE`) |
| tampered `ProjectContextBinding` | **FAIL CLOSED** (`content_hash does not match canonical payload`) |

`missing/expired ViewerCapability`, `wrong ViewerIdentity`, and `wrong release` are already proven
end-to-end in `VIEWER-IDENTITY-AUTHORITY-BOOTSTRAP-01-PROVEN.md` and were not re-proven here — this
unit did not touch that chain, only the layers feeding into it.

`npx tsc --noEmit`: 98 pre-existing errors, identical file set before and after — zero new.
`npx vitest run --project unit` (localization-scoped): 116 passed; 2 unrelated pre-existing
failures are the same `.data/mimers/cas` filesystem P-05 issue seen in every prior unit this
session, in files this unit never touched. Several existing localization tests run against a test
DB without a `project_context_bindings` table populated — they correctly now get
`EXECUTION_FAILED` (fail closed) instead of a silently fabricated context, and still pass because
the tests already tolerated a non-`ASSESSED` outcome.

## What this does not claim — a genuinely new blocker found, not invented

The real proof run against `cmt2m7bdj0000h0f7uj4jykis` / ORSA STACKMORA 3:12 resolved the correct
real context end-to-end, but the `ExecutionKernel` denied admission with
`"DENIED: Invalid or missing Execution Identity"` — a **separate, pre-existing** authority gate
(`LU_EXECUTION_AUTHORITY_V1`, established several units before this whole track) that this unit
never touched and was never asked to. Context/evidence binding is now real; execution-identity
provisioning for a live kernel run is not configured in this environment.

Per the owner's own stated exception ("no new planning round between these two units unless a
genuinely new blocker arises"), this qualifies: `LU-PRODUCT-GOLDEN-PATH-01` cannot reach a real
`ASSESSED` verdict for ORSA STACKMORA 3:12 until `LU_EXECUTION_AUTHORITY_*` is provisioned for
this environment (same pattern as the other split-key issuers already built this session). That is
a real, concrete, newly-surfaced blocker — not invented, not stalled on scope.

## Closure

```
PRODUCT-LU-CONTEXT-AND-EVIDENCE-BINDING-V1
IMPLEMENTED / PROVEN
```

Next: `LU-PRODUCT-GOLDEN-PATH-01` is ready to resume the moment `LU_EXECUTION_AUTHORITY_*` is
provisioned for this environment (or the owner decides the golden-path run should proceed and
accept a `GOVERNANCE_DENIED` outcome as this unit's honest evidence of a real, ungamed
fail-closed chain rather than a fabricated ASSESSED verdict).
