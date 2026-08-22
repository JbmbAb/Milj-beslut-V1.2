# PRODUCT-LU-LOCALIZATION-GEOMETRY-01 — Phase A: Contract / Model Recon

OWNER-APPROVED / READ-ONLY. No product code was changed to produce this document.

## The conflation, stated precisely

`site_id` — the value that scopes `ExecutionIdentityScopeV2`, the manifest, and (via
`deriveLuExecutionSeed`) every downstream identity in the LU chain — is, at every single point in
the current production code, literally `ProjectPropertyBindingArtifact.property_identity`: the
cadastral identity. There is no second, more specific value anywhere. Confirmed at:
`src/application/generate-localization-report.usecase.ts:579`
(`canonicalSiteId = canonicalContext.propertyIdentity`), `resolveCanonicalProjectContext.ts:112`,
and every consumer of `site_id` downstream (`LuExecutionIdentityIssuer.ts`,
`LuExecutionKernelClient.ts`, `LuExecutionIdentitySeed.ts`) treats it as an opaque string with no
independent validation — the "must be `property_identity`, never `site.id`" rule lives only in a
comment, not a type.

On the frontend, `LuWorkspace.tsx`'s `SiteInput.geometry` (line 28) is set verbatim from the
property lookup response (`lookupProperty()` line 109: `geometry: info.geometry`) — never drawn,
edited, or distinguished from the cadastral boundary. `PropertyFirstLuEntry.tsx` already names
this exact gap in its own doc comment as a known, carried-forward finding, so this is not a new
discovery — Phase A here is establishing the *contract*, not the existence of the gap.

**A second, independent finding, not previously flagged**: the live PostGIS spatial query
(`SpatialProviderPostGIS.ts:106-122`) doesn't even use the property's polygon boundary today — it
runs `ST_DWithin` against a single centroid point (`LUPropertyContextArtifact.payload.coordinates`)
plus a fixed 500m buffer. So the current "spatial evidence" is already an approximation relative
to the true property shape, independent of the site-vs-property question. This matters for scoping
V1: since the live query only ever consumes one point today, a user-drawn **point** geometry is
immediately wireable into the real query without touching `SpatialProviderPostGIS.ts` at all; a
user-drawn **polygon** driving a boundary-aware query is real, separate future work.

## Existing patterns to reuse (found, not invented)

**Identity/artifact-id scoping**: `ExecutionIdentityScopeV2.ts` already establishes, and this
session's own manifest fix already *reused*, one exact pattern: content-hash a named field set
(`{contract: <scope-const>, ...fields}`) and prefix the result (`lu-identity-v2-`,
`lu-manifest-v2-`). This is the only artifact-identity-scoping pattern in the codebase — the
proposal below extends it a third time (V2 → V3) rather than inventing a fourth shape.

**Current-head + supersession**: two real, working mechanisms already exist and share one shape:
`ProjectContextBindingProvider.resolveCurrent` (owner-signed, full supersession graph,
`resolveCurrentProjectContextBindingHead` rejects forks/cycles/ambiguity) and
`resolveCurrentAssessmentProjection` (unsigned projection). Both are structurally: **(a)** a
non-authoritative DB table narrows candidates, **(b)** every candidate is re-resolved from CAS and
cryptographically/structurally re-verified before being trusted, **(c)** `createdAt` is *never*
used to decide validity — only as the final tiebreaker among candidates that already passed (a)
and (b). Both docs are explicit that the DB row is never itself authority.

**No existing versioned/user-drawn geometry artifact anywhere** in `packages/mps-lu/src/artifacts/**`,
`packages/mps-compliance/src/artifacts/**`, or `src/domain/**` — confirmed by search. The only
geometry-bearing artifacts today are the property's own (immutable-by-content-hash, but with no
supersession concept — nothing has ever needed to *version* a property's cadastral shape).

**Coordinate transform**: `GeoJsonCoordinateTransform.ts`'s `transformGeometryToWgs84` is real,
exact, and reusable, but scoped strictly to the viewer/presentation boundary today (only imported
by `ViewerKernel.ts`) — no reverse (WGS84→SWEREF99) transform exists in that module; the only
existing reverse path is a live PostGIS round-trip (`SpatialProviderPostGIS.wgs84ToSweref99`).

**Replay is unaffected**: confirmed `DefaultReplayEngine.replay()` reads only the manifest ref +
persisted `RuntimeState` — no live geometry/spatial dependency, so adding a new identity axis
changes *which* manifest_id gets replayed, never how replay itself works.

## Proposed contract (design only — nothing below is implemented in Phase A)

### The three identities, restated with real field ownership

```
PROPERTY   → ProjectPropertyBindingArtifact.property_identity (cadastral, immutable, already real)
PROJECT    → Project (Prisma) + ProjectContextBinding (owner-signed, already real)
LOCALIZATION/SITE GEOMETRY → NEW: LocalizationGeometryArtifact (this proposal)
```

### `LocalizationGeometryArtifact` (new, immutable, content-addressed)

```ts
interface LocalizationGeometryPayload {
  readonly project_id: string;
  readonly property_context_ref: ArtifactReference;   // which LUPropertyContextArtifact this is sited on
  readonly geometry: { type: "Point" | "Polygon"; coordinates: ... };
  readonly srid: number;                                // SWEREF99 TM (3006) canonical, same convention as property geometry
  readonly provenance: "user_defined" | "derived_from_property_boundary"; // never silently defaulted
  readonly label: string;                                // human-facing name, e.g. "Alternativ A" -- replaces today's site.name/site.id role
  readonly created_by: string;                           // real user id, never a synthetic actor
}
// artifact_id = `localization-geometry-${sha256ContentHash(payload).slice(0,24)}`, exactly the
// existing convention (see createProjectPropertyBindingArtifact and siblings).
```

**Not owner-signed.** This is the one deliberate departure from the `ProjectContextBinding` /
`ExecutionIdentity` pattern, stated explicitly because it's a real judgment call: those two are
*governance authority* (who is permitted to operate) and require the owner key. A localization
geometry is *user input* (what the user wants assessed) — the same trust tier as today's
`assessment_draft`/`site.id`, which are already caller-supplied and become real only once the
ExecutionKernel admits a run against them and a signed outcome/attestation is produced. Content-hash
identity (tamper-evidence + idempotency) is the correct and sufficient integrity guarantee here;
requiring the owner's private key to sign every user-drawn polygon would misapply the authority
boundary this session has otherwise been careful to keep narrow.

**Point + polygon are sufficient for V1.** Given the live spatial query is centroid-only today
(see above), a point-type `LocalizationGeometryArtifact` is immediately end-to-end wireable in
Phase B without touching `SpatialProviderPostGIS.ts`. Polygon is included in the *contract* now
(so the artifact shape doesn't need another version bump later) but a boundary-aware live query is
explicitly deferred, real future work — Phase B should fail closed (not silently centroid-reduce)
if a polygon geometry is submitted before that query exists, rather than quietly approximating it.

### Current-head model: reuse the `ProjectAssessmentProjection` shape, not the signed-supersession one

Because `LocalizationGeometryArtifact` is unsigned user content (see above), it doesn't need the
heavier signed-supersession-relation machinery `ProjectContextBinding` has (that exists *because*
bindings are owner-authority and a supersession itself must be tamper-evident). The lighter shape
already used for `ProjectAssessmentProjection` — an append-only DB projection of candidate refs,
CAS re-verified on every read, `createdAt` as tiebreaker only — is the right level of ceremony:

```
LocalizationGeometryProjection (new Prisma model, mirrors ProjectAssessmentProjection exactly)
  id, projectId, geometryArtifactId, createdAt
  -- no signature/issuer columns: CAS content-hash re-verification IS the integrity check.

resolveCurrentLocalizationGeometry(projectId, repo):
  1. list all projection rows for projectId
  2. sort by createdAt desc (tiebreaker only, per the established convention)
  3. for each candidate: resolve from CAS, recompute content_hash, verify artifact_id matches,
     verify payload.project_id matches -- return the first survivor
  4. throw (fail closed) if none survive
```

**Frozen invariant satisfied by construction**: since "current" is always "most recently created,
CAS-valid" with no supersession *editing* of history, drawing a new geometry (`INSERT` a new
projection row) automatically makes it current and leaves every prior geometry, and everything
identity-scoped to it, exactly as it was — resolvable as history, never current, never silently
reused.

### Identity axis: `ExecutionIdentityScopeV3` (new file/functions, V1 and V2 untouched)

Per the same evolution this session already did once (V1 → V2, frozen, never modified in place):

```ts
export const LU_EXECUTION_IDENTITY_SCOPE_V3 = "lu-execution-identity-scope-v3" as const;

export interface ExecutionIdentitySubjectV3 extends ExecutionIdentitySubjectV2 {
  readonly localization_geometry_ref: ArtifactReference;
}

export function computeExecutionIdentityArtifactIdV3(subject: ExecutionIdentitySubjectV3): string
export function computeExecutionManifestIdV3(subject: ExecutionIdentitySubjectV3): string
```

Both hash the same way V2 does, with `localization_geometry_ref` added to the hashed field set and
a V3-distinct `contract` discriminator string — so a V2 identity and a V3 identity for the
*otherwise-identical* subject deliberately produce different ids (never accidentally collide or
get treated as equivalent).

`deriveLuExecutionSeed` (`LuExecutionIdentitySeed.ts`) needs the same field added as a 10th input
(a new `LU_EXECUTION_SEED_CONTRACT` version string alongside it, same reasoning) — this is what
`generate-localization-report.usecase.ts` will pass to `runLuAssessmentViaKernel`, and it's what
makes "moved polygon → different seed → different manifest → WORM correctly refuses to conflate
it with the old one" true by construction, exactly mirroring how `project_context_binding_ref`
already does this for binding supersession today (proven live, this session, in
`LU-MANIFEST-WORM-IDEMPOTENCY-01`).

`verifyExecutionIdentityAttestation` (`ExecutionIdentityAttestation.ts`) needs a third branch
(`declaredContractVersion === LU_EXECUTION_IDENTITY_SCOPE_V3`) mirroring the V2 branch exactly:
self-consistency (`artifact_id === computeExecutionIdentityArtifactIdV3(...)`), and — critically,
matching the existing "a genuinely valid V1 never satisfies a caller that requires V2" rule — **a
genuinely valid V2 identity must never satisfy a caller that requires V3**. A project whose
geometry changed and whose execution identity was minted under the old geometry must fail closed,
not silently downgrade-accept.

### What changes downstream, traced explicitly

- **`resolveCanonicalProjectContext`**: unchanged. It stays property/project-scoped exactly as it
  is; `LocalizationGeometryArtifact` is resolved by a new, separate function, never folded into
  `CanonicalProjectContext` (keeps the three identities structurally distinct, per the owner's
  explicit instruction).
- **`generate-localization-report.usecase.ts`**: after resolving `canonicalContext`, additionally
  call `resolveCurrentLocalizationGeometry(projectId, repo)`; build `identity_subject_v3` (not v2)
  including `localization_geometry_ref`; fail closed (no silent V2 fallback) if none exists yet —
  see the migration note below for how existing/new projects get their first geometry.
- **`LuExecutionKernelClient.ts`**: `expectedSubjectV2` handling generalizes to accept a V3 subject
  (or is duplicated as a V3-aware branch — exact shape is a Phase B implementation decision, not
  fixed here); manifest_id uses `computeExecutionManifestIdV3` when a V3 subject is supplied.
- **`LocalizationAssessmentArtifact`**: payload needs a new `localization_geometry_ref` field.
- **`ProjectAssessmentProjection`**: needs an analogous new column
  (`localizationGeometryArtifactId`), and `resolveCurrentAssessmentProjection`'s eligibility filter
  needs a second condition alongside the existing current-binding check: current assessment must
  match **both** current binding **and** current localization geometry. A candidate matching the
  binding but not the current geometry (or vice versa) is not current.
- **CAS**: one new artifact type (`localization_geometry`), no changes to existing artifact shapes
  except the two additive fields above.
- **Migration**: one new table (`localization_geometry_projections`, additive), one new column on
  the existing assessment-projection table (additive, nullable during transition). No destructive
  schema change.

### The transition question, answered explicitly (not left implicit)

Every existing project today (including the golden-path ORSA project) has zero
`LocalizationGeometryArtifact`s. Rather than silently treating "no geometry" as "use the property,"
Phase B should have the *first* assessment request for a project with none **explicitly** create
one, with `provenance: "derived_from_property_boundary"` and geometry = the property's own
centroid (the same point the live query already uses today) — a real, versioned, content-hashed
artifact, not a conflation. This is a legitimate, auditable starting state, and it satisfies "never
silently equate property boundary with localization area" precisely because the derivation is
explicit, inspectable provenance on a real artifact — not an implicit default with no artifact at
all. When Cesium drawing UX (a later unit) lets the user draw a real `"user_defined"` geometry,
that becomes a new current head exactly like any other supersession by recency, and by the frozen
invariant, mints a distinct V3 identity — the derived one remains resolvable history, never current
again.

## Negative proof matrix (for Phase B to prove, not proven here)

```
same LocalizationGeometry submitted twice
  → same content-hash artifact_id, same V3 identity/manifest (idempotent, no WORM violation)

user edits/moves the geometry
  → new LocalizationGeometryArtifact, new current head
  → new V3 ExecutionIdentity + manifest + assessment
  → OLD geometry/identity/evidence/assessment remain resolvable as history, never current

old V2-shaped ExecutionIdentity (pre-this-unit) presented where V3 is now required
  → REJECT (LEGACY_IDENTITY_NOT_ALLOWED-equivalent), same as V1-vs-V2 today

geometry belonging to a DIFFERENT project/property presented for this project
  → SUBJECT_MISMATCH-equivalent REJECT

tampered LocalizationGeometryArtifact (content_hash mismatch)
  → REJECT at CAS re-verification, same mechanism as every other artifact in this chain

polygon geometry submitted before boundary-aware query support exists
  → explicit fail-closed, never silently centroid-reduced

missing LocalizationGeometry for a project
  → either explicit derived-from-property-boundary auto-creation (see above) or explicit
    fail-closed -- never an implicit property-boundary substitution with no artifact

assessment/projection candidate matching current binding but NOT current geometry (or vice versa)
  → not selected as current
```

## Required Phase B files (not created in Phase A)

```
packages/mps-lu/src/artifacts/LocalizationGeometryArtifact.ts        (new)
packages/mps-runtime/src/execution/ExecutionIdentityScopeV2.ts        (add V3 functions alongside, or new ExecutionIdentityScopeV3.ts)
packages/mps-lu/src/execution/ExecutionIdentityAttestation.ts         (add V3 verification branch)
packages/mps-lu/src/execution/LuExecutionIdentitySeed.ts              (add localization_geometry_ref field)
packages/mps-lu/src/execution/LuExecutionKernelClient.ts              (V3-aware manifest_id/identity resolution)
server/repositories/localizationGeometryProjectionRepository.ts       (new, mirrors projectAssessmentProjectionRepository.ts)
server/modules/localization/localizationGeometryProjection.ts         (new, mirrors assessmentProjection.ts)
src/application/generate-localization-report.usecase.ts               (resolve geometry, build identity_subject_v3)
packages/mps-lu/src/artifacts/LocalizationAssessmentArtifact.ts       (add localization_geometry_ref field)
prisma/schema.prisma                                                   (new model + one new column, additive)
```

## Sequencing (per owner direction, restated)

```
property-first workflow                  PROVEN
property boundary rendering              PROVEN
        ↓
LocalizationGeometry contract            Phase A: this document (done)
        ↓
LocalizationGeometry runtime/state       Phase B: artifact + current-head + identity V3 + runtime wiring
        ↓
Cesium draw/edit UX
        ↓
real login UX
        ↓
full user-journey E2E
        ↓
PRODUCT-PROVEN-RC1
```
