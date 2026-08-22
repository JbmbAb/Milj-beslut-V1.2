# PRODUCT-LU-PROJECT-CONTEXT-BOOTSTRAP-01 — Phase A: Authority/Automation Recon

OWNER-APPROVED / READ-ONLY. No product code was changed to produce this document.

## Correction to PRODUCT-LU-PROPERTY-FIRST-WORKFLOW-01 Phase A

That earlier recon said: *"There is no automated pipeline from a typed property designation to a
minted, verified binding — only a hand-run sequence of separately-authored owner scripts."* That
claim is **too strong** and needs correcting now that this unit traced the chain specifically.

**`scripts/ops/bootstrap-product-lu-owner.ts` already is exactly that pipeline, in one script,
with the issue/verify separation already correctly built.** It:

1. Resolves an authenticated ADMIN owner (`--owner-bankid-id` or `--resolve-sole-admin-owner`,
   the latter refusing if ambiguous or matching a test/fixture/demo bankid pattern).
2. Creates the `Project` + `ProjectMember{OWNER}` via `createOrGetAdminProject`.
3. Runs the real property lookup (`lookupPropertyByDesignationFromPostgis`) and requires an
   `exact` match with real provenance (source key/dataset/updatedAt, SWEREF99 TM centroid) — no
   fuzzy match accepted.
4. Builds and signs, **in this one offline process only**: `ProjectContextBindingIssuerArtifact`,
   `ProjectPropertyBindingArtifact`, `LUPropertyContextArtifact`, `LUProjectContextArtifact`,
   `ProjectContextBindingArtifact` — signing key is `getProjectContextBindingIssuerSigner(process.env)`,
   read from `PROJECT_CONTEXT_BINDING_ISSUER_PRIVATE_KEY_PEM` (never touched by
   `LuExecutionKernelClient.ts` or any live-request code path — same issuer/verifier split as
   `luExecutionAuthoritySigningKey.ts`/`viewerCapabilitySigningKey.ts`, already proven this session).
5. Persists everything via `installVerifiedProductLuContext` (cross-consistency-checks every ref
   between the six artifacts, then CAS `put`s all of them plus the DB `ProjectContextBindingIndex`
   row).
6. **Already does the exact "fresh process, private key absent" verification pattern** this
   session used for `ORSA-VIEWER-CAPABILITY-PROVISIONING-01` and
   `ORSA-EXECUTION-IDENTITY-REISSUE-01`: `runFreshVerifier()` deletes the private-key env var and
   `spawn()`s a genuinely separate child process (`--verify`) that resolves and cryptographically
   re-verifies the binding using only the public verifier — this is not a proposal, it's real,
   already-committed code (lines 131–144, 279–284).

So the separation the owner asked to preserve — **PRODUCT REQUEST / OWNER AUTHORITY /
LIVE RUNTIME VERIFY-ONLY** — is not something to invent. It already exists at the *script* level.
The real gap is narrower than "no automation exists":

## The two real gaps

**Gap 1 — reachability.** `bootstrap-product-lu-owner.ts` is a CLI script requiring a human to
type `--execute` on a machine holding `PROJECT_CONTEXT_BINDING_ISSUER_PRIVATE_KEY_PEM`. Nothing
in the live web server can trigger it. A normal authenticated user clicking "Create new
localization" has no path to it today.

**Gap 2 — one-property-one-project baked in twice.** The script itself refuses to proceed if an
active project already exists for the property designation (`bootstrap-product-lu-owner.ts:174–178`,
`prisma.project.findFirst({propertyDesignation, status:'ACTIVE'})`) — the *exact same*
`(organisationId, propertyDesignation, status='ACTIVE')` key `createOrGetAdminProject` uses. This
means even a human owner running this script by hand today cannot create a second localization
for ORSA STACKMORA 3:12 without this refusal firing. **This has to be fixed regardless of how
automation is delivered** — it isn't an artifact of CLI-only reachability, it's a semantic bug in
the project-identity model itself, present in both the read (`createOrGetAdminProject`) and the
write (`bootstrap-product-lu-owner.ts`) paths.

## What currently requires what (per the owner's checklist)

| Step | Owner CLI | Private signing key | Manual artifact ref | Manual env/config | DB write | CAS write |
|---|---|---|---|---|---|---|
| Resolve authenticated owner | yes (`--owner-bankid-id` / `--resolve-sole-admin-owner`) | no | no | no | read only | no |
| Create Project + OWNER membership | yes (same invocation) | no | no | no | **yes** (`Project`, `ProjectMember`) | no |
| Property lookup (exact match) | yes (same invocation) | no | no | no | no | no |
| Mint + sign 5 artifacts (issuer, property binding, property context, project context, context binding) | yes (same invocation) | **yes**, in-process only | no (all derived, none hand-typed) | `PROJECT_CONTEXT_BINDING_ISSUER_{PRIVATE,PUBLIC}_KEY_PEM`, `PROJECT_CONTEXT_BINDING_ISSUER_KEY_ID`, `MIMERS_ROOT` | no | no |
| Persist (`installVerifiedProductLuContext`) | yes (same invocation) | no (verification-only from here) | no | no | **yes** (`ProjectContextBindingIndex`) | **yes** (6 artifacts) |
| Fresh verify | yes (auto-spawned child, still same overall invocation) | **no** (explicitly deleted from child env first) | no | public keys only | read only | read only |

Nothing in this chain requires a *manually hand-typed* artifact ref, or manual DB/CAS surgery —
every write is code-derived from the property designation + authenticated owner. The only truly
manual inputs are: which human is "the owner" for this run, and pressing enter.

## Proposed automated chain (Phase A proposal only — not implemented)

Reuse an existing pattern already in this codebase rather than inventing a new one: this repo
already runs a **standalone worker process, separate from the web server, polling a durable
DB-backed job queue** — `server/workers/search-indexer-worker.ts` (`npm run worker:search`) against
`SearchJob`/`SearchJobStatus`, and separately `ExecutionTicket`/`ExecutionTicketStatus`
(`PENDING → LEASED → COMPLETED/FAILED`, restart-safe, `prisma/schema.prisma`) inside the
ExecutionKernel itself. The bootstrap automation should be the same shape:

```
PRODUCT REQUEST (live web server — no private key ever)
  authenticated user: property selected + "Create new localization" + name
  → create Project + ProjectMember{OWNER}   (plain DB write, same as today, no signing needed)
  → insert ProjectContextBootstrapRequest{status: PENDING, projectId, propertyDesignation}
  → respond immediately: "localization created, provisioning in progress"

OWNER/AUTHORITY MECHANISM (new standalone worker process, same shape as search-indexer-worker.ts;
  holds PROJECT_CONTEXT_BINDING_ISSUER_PRIVATE_KEY_PEM, the ONLY process that does)
  poll ProjectContextBootstrapRequest WHERE status = PENDING
  → lease it (status: LEASED)
  → run exactly bootstrap-product-lu-owner.ts's issuance logic (steps 3–5 above),
    now parameterized by the request row instead of CLI flags
  → mark COMPLETED (+ contextBinding artifact_id) or FAILED (+ reason)

LIVE RUNTIME (web server — verify-only, unchanged)
  poll/read ProjectContextBootstrapRequest.status for this project
  → COMPLETED: resolveCanonicalProjectContext now succeeds for real (already-existing,
    already-proven verify-only code path — nothing here changes)
  → PENDING/LEASED: LU generation for this project fails closed with an explicit
    "provisioning in progress" reason, never silently substitutes/falls back
  → FAILED: fails closed with the recorded reason, never retried automatically
```

This preserves every invariant the owner listed: no private key ever reaches the web process; no
inline request-time minting; the worker only ever does what `bootstrap-product-lu-owner.ts`
already does today, just triggered by a queue row instead of a terminal flag.

**Whether owner approval can be batch/policy-based rather than per-project manual**: yes, and this
matters for "a normal user must be able to create a new LU without you running five scripts every
time." The CLI's `--owner-bankid-id`/`--resolve-sole-admin-owner` distinction exists only because
a *human* had to be told which owner subject to attribute the issuance to. Once this is a worker
process instead of a human at a terminal, that step becomes: the worker runs continuously under a
**pre-approved, standing policy** ("this signing key is authorized to issue bindings for any
project whose requesting user already holds real, verified `ProjectMember{OWNER}` on that
project, in the requesting user's own organisation") rather than a per-request human decision.
The authorization decision that actually matters — *is this user legitimately allowed to own a
project on this property* — is already enforced upstream, at Project/ProjectMember creation time
(existing, real, unchanged code); the worker's job is purely mechanical translation of an
already-authorized project into a signed binding, not a second authorization gate. No new
per-project manual approval step is needed as long as that upstream membership check stays real.

## Required new runtime/service boundary

- **New Prisma model**: `ProjectContextBootstrapRequest` (id, projectId, propertyDesignation,
  status: `PENDING | LEASED | COMPLETED | FAILED`, contextBindingArtifactId?, failReason?,
  createdAt, updatedAt, leasedAt?, completedAt?) — same shape as `ExecutionTicket`.
- **New worker process**: `server/workers/lu-project-context-bootstrap-worker.ts` +
  `server/services/luProjectContextBootstrapWorker.ts`, structurally mirroring
  `search-indexer-worker.ts` / `searchWorker.ts`. Holds the private key; the web server never does.
- **Corrected project-creation primitive** (required regardless of the above): split
  `createOrGetAdminProject` into `listProjectsForProperty(organisationId, propertyDesignation)`
  (read, all statuses, all rows) and `createLocalizationProject(organisationId, propertyDesignation,
  name, userId)` (always inserts a new `Project` row, never upserts by designation). Both
  `bootstrap-product-lu-owner.ts`'s refusal-on-existing-active-project check (line 174–178) and
  `createOrGetAdminProject`'s upsert key must be replaced — **do not reuse
  `createOrGetAdminProject` as the create primitive** if it keeps `(propertyDesignation, ACTIVE)`
  upsert semantics, per the owner's explicit instruction.
- **New route**: an authenticated (non-admin-only) `POST` that does the "PRODUCT REQUEST" step
  above — does not exist today (today's only project-creation route, `POST /api/admin/projects`,
  is `ADMIN`-role-gated).

## Files/schema likely affected (Phase B, not this unit)

- `prisma/schema.prisma` — new `ProjectContextBootstrapRequest` model + status enum + migration.
- `server/modules/search/adapters/searchRepository.ts` — split `createOrGetAdminProject`.
- New: `server/services/luProjectContextBootstrapWorker.ts`, `server/workers/lu-project-context-bootstrap-worker.ts`.
- New: `server/routes/*` — authenticated "create localization" route (not admin-gated).
- `scripts/ops/bootstrap-product-lu-owner.ts` — becomes the reference implementation the worker's
  issuance logic is extracted from (or is kept as-is for genuine one-off manual/emergency use,
  with the worker as a parallel, request-driven path using the same underlying functions).
- `package.json` — new `worker:lu-bootstrap` script, mirroring `worker:search`.

## Explicitly not decided/implemented in Phase A

- Whether the worker is a long-running poller (matching `search-indexer-worker.ts`) or a
  one-shot invocation triggered some other way (e.g. a scheduled task) — poller is proposed as the
  default given the direct precedent, but this needs a real capacity/latency conversation, not a
  guess.
- The exact new route's path/shape, and whether "list localizations for a property" is its own
  endpoint or folded into the property-lookup response.
- Any UI. This unit is authority/automation design only, per instruction.

## Corrected project semantics (frozen per owner instruction)

```
listProjectsForProperty(organisationId, propertyDesignation)   = discovery/read, all rows
createLocalizationProject(organisationId, propertyDesignation, name, userId)
                                                                 = ALWAYS creates a new project

ORSA STACKMORA 3:12
├── Lokalisering A
├── Lokalisering B
├── Utbyggnad 2027
└── Alternativ nord

NOT: ORSA STACKMORA 3:12 └── one global ACTIVE project
```

## Updated sequencing

```
governed LU technical chain                     PROVEN
        ↓
property → real governed project bootstrap      Phase A (this document): recon + contract done.
                                                  Phase B: implement queue model, worker,
                                                  corrected project-creation primitive, new route.
        ↓
property-first UI
        ↓
localization/site geometry subsystem
        ↓
Cesium drawing UX
        ↓
real login/project UX
        ↓
full user-journey E2E
        ↓
PRODUCT-PROVEN-RC1
```
