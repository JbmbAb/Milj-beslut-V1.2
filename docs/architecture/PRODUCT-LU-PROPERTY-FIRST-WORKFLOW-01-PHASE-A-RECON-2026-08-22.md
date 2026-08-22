# PRODUCT-LU-PROPERTY-FIRST-WORKFLOW-01 — Phase A: Recon + Contract Proposal

OWNER-APPROVED / READ-ONLY. No product code was changed to produce this document.

## STATUS: CLOSED / ESTABLISHED / READ-ONLY (2026-08-22)

Four headline findings, frozen:

```text
1 PROPERTY → N LOCALIZATIONS
REQUIRED
current createOrGetAdminProject semantics = incompatible

PROPERTY → VERIFIED PROJECT CONTEXT BINDING
NOT AUTOMATED (reachable only via owner CLI, not from a live request)
primary blocker

LOCALIZATION GEOMETRY
NOT MODELED
new subsystem required

PROPERTY GEOMETRY CESIUM BUG
OPEN / diagnosis not yet proven
```

**Correction (2026-08-22, after `PRODUCT-LU-PROJECT-CONTEXT-BOOTSTRAP-01` Phase A traced this
specifically):** finding 6 below understated what exists. A single script,
`scripts/ops/bootstrap-product-lu-owner.ts`, already performs the full property → verified
`ProjectContextBinding` chain, with the private-key/verify-only separation already correctly
built in (including a fresh-process, public-key-only re-verification step). The real gap is not
"no automation exists" — it's that this script is CLI-only (unreachable from a live user request)
and shares the same one-property-one-active-project defect as `createOrGetAdminProject`. See
`docs/architecture/PRODUCT-LU-PROJECT-CONTEXT-BOOTSTRAP-01-PHASE-A-RECON-2026-08-22.md` for the
full, corrected trace and the proposed automation contract. The rest of this document (findings
1–5, 7–10, and the three-identity framing) stands as originally recorded.

## Context

`AUTHENTICATED-LU-UI-E2E-01` closed PASS on 2026-08-22, proving the governed LU technical
product chain works end to end in the real browser: login → ExecutionKernel admission →
manifest → assessment → CAS → ViewerCapability → ViewerKernel → Cesium render. That proof used
today's actual, reachable UX: an admin dev-login, then a `projectId` set by hand into
`localStorage`, then "Slå upp fastighet" against the property already implied by that project.

That UX is not the intended product flow. This document is Phase A of correcting that: recon
only, no UI rewrite yet. It traces what already exists against the ten points requested, then
proposes (but does not implement) the contract for a property-first workflow.

## Three identities, kept separate

The current codebase already keeps these conceptually separate at the artifact level, but the
*frontend* today collapses them into one implicit thing (`projectId` + whatever property that
project happens to be pinned to). Any redesign must keep them explicit:

| Identity | What it is | Real artifact today |
|---|---|---|
| **PROPERTY** | The cadastral/register real-world parcel (e.g. "ORSA STACKMORA 3:12") | `core.property_unit` (PostGIS row) → `ProjectPropertyBindingArtifact` once bound |
| **PROJECT** | The internal Mimer container for auth, history, artifacts, assessments | `Project` (Prisma), `ProjectMember`, `ProjectContextBindingArtifact` |
| **LOCALIZATION / SITE** | The actual proposed operation/location being assessed for this property | **Does not exist as a distinct artifact today** — see finding 10 |

## Findings, items 1–10

**1. Current LU entry points.** Exactly one: `MimerProductShell.tsx`'s hardcoded 3-item nav
(`Start` / `Lokalisering` / `Admin-konsol`) → `Lokalisering` renders `<LuWorkspace />` with no
props. `LuWorkspace` has no project-selection mechanism; every call reads the ambient
`getActiveProjectId()`. The legacy `LocalizationStudyUI.tsx` is explicitly not wired in
(`LuWorkspace.tsx`'s own doc comment: "no LocalizationStudyUI / hub").

**2. Property search UI + `/api/property/lookup`.** `fetchPropertyInfo` (`src/ui/api-client/geo.client.ts`)
→ `POST /api/property/lookup` (`server/routes/property.routes.ts`). Real, governed, but
**local-PostGIS-only** — live Lantmäteriet is explicitly disabled
(`PROPERTY_LOOKUP_MODE` → `LIVE_LANTMATERIET_DISABLED` 503 if requested). Returns designation,
municipality, area, geometry, centroid. **Returns nothing about whether the property is already
tied to a project** — that lookup doesn't exist today.

**3. What happens after a property is selected today.** Nothing is persisted. `lookupProperty()`
only sets local React state (`site: {id, name, lat, lng, geometry}`), used to draw the property
on Cesium and enable "Kör bedömning" — which then runs against whatever project was *already*
active. The property lookup and the active project are today completely unlinked from each
other; the lookup never creates or resolves a project.

**4. Current project creation.** `POST /api/admin/projects` (ADMIN-only) →
`createOrGetAdminProject` (`server/modules/search/adapters/searchRepository.ts:777`). This is the
closest existing thing to the needed primitive — **but its get-or-create key is
`(organisationId, propertyDesignation, status='ACTIVE')`**, i.e. it assumes **one active project
per property per org**. Confirmed by reading it directly: a second call with the same
designation returns the *same* existing project (`created:false`) rather than creating a second
localization. **This is the single most important contract mismatch to fix**: the owner's
explicit model is `1 property → N projects/localizations`, and this function currently encodes
the opposite (`1 property → 1 project`). It cannot be reused as-is; its lookup key needs to
change from "find the project for this property" to "list the projects for this property, and
separately, create a new one on demand" (see proposed contract below).

**5. Membership/org assignment.** `createOrGetAdminProject` upserts `ProjectMember{accessRole:
OWNER}` for the creating user. The only other membership path,
`PUT /api/projects/:id/members`, requires the caller to already be a member and enforces
same-organisation. **No self-service "create my own project" path exists for a non-admin user**
— today's only project-creation route is `ADMIN`-role-gated.

**6. `ProjectContextBinding` authority path.** `installOwnerIssuedProjectContextBinding`
(`server/modules/localization/installProjectContextBinding.ts`) is deliberately an
**install-only, owner-provisioning boundary**: it accepts an already-signed
`ProjectContextBindingArtifact` and "never derives a binding from a route, assessment, naming
convention, or runtime default" (its own doc comment). There is **no automated pipeline** from "a
property designation a user just typed" to a minted, verified binding — today that requires a
hand-run sequence of separately-authored owner scripts
(`bootstrap-lu-execution-authority.ts`, `bootstrap-product-lu-owner.ts`,
`bootstrap-product-release-authority.ts`, `install-lu-project-context-binding.ts`, ...). **Only
one project in the entire system has a real binding today** (ORSA STACKMORA 3:12,
`cmt2m7bdj0000h0f7uj4jykis`) — every other project fails closed at `resolveCanonicalProjectContext`.
This is the load-bearing blocker for "create new localization" actually working end to end, not
just the UI.

**7. Active-project frontend state.** `localStorage['miljobeslut_admin_project']`
(`services/coreApiClient.ts`). Exactly two writers, neither a real UI control: the dev-login
hardcodes a specific `activeProjectId` (`AppShell.tsx:113`), and `AppSessionProvider` just echoes
back whatever the bootstrap endpoint returned. **No UI anywhere lets a normal user choose a
project.** Notably, the backend already computes `requiresProjectSelection` in the bootstrap
payload (`project.v1.routes.ts:109`) — a half-finished handoff nothing on the frontend consumes.

**8. Cesium property-geometry bug.** `CesiumAdapter.setPropertyGeometry` fails with `Cannot read
properties of undefined (reading 'dataSources')` — meaning `this.viewer` itself is undefined at
call time. Root-cause hypothesis (code-grounded, not yet confirmed by a repro/stack trace):
`CesiumMapView`'s adapter-lifecycle `useEffect` depends on `[onEvidenceClick]`, which
`LuWorkspace` passes as a fresh inline closure on every render — this can retrigger
destroy+recreate of the adapter while the property-geometry effect's async load is still in
flight, racing a stale `adapterRef` against a torn-down or not-yet-constructed `Viewer`.

**9. Cesium drawing/editing.** None exists. `ScreenSpaceEventHandler` is used only for feature
*picking* (read). No `CallbackProperty`, no user-constructed `PolygonHierarchy`, no vertex
editing. Cesium is entirely read-only/display-only today.

**10. Site/localization geometry artifact.** Does not exist. `CanonicalGeometry` is used
exclusively for the *property's own cadastral boundary* (`ProjectPropertyBindingArtifact.geometry_ref`).
`LocalizationAssessmentArtifact` carries no geometry field at all — `LocalizationAssessmentDraft.site_id`
is explicitly documented as "the UI-facing alternative label... deliberately not conflated with
the cryptographic execution identity," i.e. just a string, not a real geometric site. At the UI
layer, `LuWorkspace`'s `SiteInput` (`{id, name, lat, lng, geometry?}`) reuses whatever the
property lookup returned as `geometry` — **the current model has no distinct concept of an
operational footprint separate from the property's own boundary.**

## Proposed contract (Phase A proposal only — not implemented)

### Property search → project selection

```
user searches "ORSA STACKMORA 3:12"
  → GET/POST /api/property/lookup (existing, unchanged)
  → NEW: list existing projects for this property
      (real query needed: Project WHERE organisationId = caller's org
       AND propertyDesignation = designation, ALL statuses/rows, not get-or-create)
  → UI shows: property card + "Create new localization" + existing localization list
```

This requires a **new, additive** list endpoint — not a reuse of `createOrGetAdminProject`'s
existing get-or-create semantics, which must either be changed to always-create (never reuse) or
retired in favor of two separate primitives: `listProjectsForProperty` (read) and
`createProject` (always inserts a new row, never upserts onto an existing one by designation).

### Create new localization

```
user picks "Create new localization"
  → create Project (name defaulted/prompted, propertyDesignation = looked-up designation)
  → upsert ProjectMember{accessRole: OWNER} for the calling user (existing mechanism, reused)
  → establish canonical PropertyContext / ProjectContext / ProjectContextBinding
      for this new project (THE REAL GAP — item 6: no automated path exists yet;
      this is very likely its own follow-up unit, not solvable inside a UI change)
  → project becomes active internally (existing localStorage mechanism can stay
      as an implementation detail, but must be driven by this flow, never typed/set by hand)
  → Cesium centers on property (existing CesiumMapView, once the item-8 bug is fixed)
```

The user never sees `projectId` — the picker operates on property + localization *name/label*
only.

### Localization/site geometry (direction only, not Phase A implementation)

```
user draws geometry in Cesium (point/polygon/line depending on LU type)
  → validate geometry/SRID client-side
  → persist as an explicit, immutable, versioned localization/site geometry artifact
      (a NEW artifact type — does not exist today, see finding 10)
  → bind it into the project/site context
  → ExecutionIdentity / evidence generation binds to the exact geometry version
```

Explicitly **not**: "browser-only GeoJSON piped directly into the rule engine." The existing
session precedent for this pattern is `ExecutionIdentityScopeV2` — a new geometry artifact would
need the same treatment (content-hashed identity, immutable, referenced by the assessment, never
inferred from a route parameter or the latest write).

## Carried-forward, still-open defects (not fixed in Phase A)

**A. Property-geometry Cesium bug** (`CesiumAdapter` `dataSources` crash, finding 8). Evidence
rendering works (proven in `AUTHENTICATED-LU-UI-E2E-01`); property-boundary rendering is still
broken. Must be resolved before `PRODUCT-PROVEN-RC1`.

**B. Auth / project UX gap** (findings 1, 7). The real BankID login UI (`AuthInterface.tsx`)
exists but is unreachable from the current shell. The real project-membership machinery exists
but has no reachable non-admin UI. The development admin-login + hand-set `localStorage` project
must not become the certified production UX.

## Sequencing (per owner direction, restated)

```
AUTHENTICATED-LU-UI-E2E-01                 PASS  (governed technical chain, proven in real UI)
        ↓
PRODUCT-LU-PROPERTY-FIRST-WORKFLOW-01      Phase A: this document (done)
        ↓                                  Phase B+: property→project list/create UI,
        ↓                                  new ProjectContextBinding automation for
        ↓                                  non-golden-path projects
PROPERTY / LOCALIZATION MAP UX             (Cesium drawing/editing — new territory)
        ↓
PROPERTY GEOMETRY CESIUM FIX               (defect A)
        ↓
REAL LOGIN / PROJECT UX                    (defect B)
        ↓
FULL USER-JOURNEY E2E
        ↓
PRODUCT-PROVEN-RC1
```

`AUTHENTICATED-LU-UI-E2E-01`'s result stands as: **GOVERNED LU TECHNICAL PRODUCT CHAIN — PROVEN
IN REAL UI.** It is not being re-litigated by this document, and it is not, on its own, "final
user experience — product-proven."
