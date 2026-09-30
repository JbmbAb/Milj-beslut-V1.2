# PATTERN-PROOF-ENGINE-01 V1 -- implementation design + RED-only

**Status:** `ACCEPT / FROZEN FOR BOOTSTRAP_RED_ONLY` (2026-09-30, Jimmy's final check of §5.4 + §7)
-- explicit go for creating the `PATTERN-PROOF-ENGINE-V1` routine and running its
`BOOTSTRAP_RED_ONLY` mode only; not for `FULL_PATTERN_PROOF`. Design only, no writer-GREEN, no
Dockerfile fix. Stops exactly where Jimmy's go-ahead message said to stop: artifact schemas ->
state machine -> orchestrator boundary -> target `DiscoveryArtifact` -> `DependencyGraphArtifact`
-> `DecisionGateArtifact` -> `RedPlanArtifact` -> terminal-state fixtures.

**Authority:** `PATTERN-PROOF-ENGINE-01-DESIGN-2026-09-30.md` (v4, `ACCEPT / FROZEN`, same
directory) for the protocol itself; Jimmy's own go-ahead message (2026-09-30) for scope and V1
target selection, quoted in full in §0.

**Revision note (2026-09-30, self-corrected before Jimmy's delta-check):** Jimmy's latest cold
review named six areas needing correction (RED-plan vs. actually-executed RED; `CandidateArtifact`;
terminal-fixtures; the builder stage's real file set; the `docker-compose.staging.yml` authority;
verifier-isolation) while referring to them collectively as "seven corrections" -- that count
mismatch is noted here rather than silently resolved, since inventing a plausible seventh item
would be exactly the kind of unverified filling-in this program's own discipline exists to prevent.
Of the six named: **two were independently re-verified and fixed in this revision** (the builder
stage's real file set -- `prisma/` is copied *after* `npm ci`, not before, so it was wrongly
included; and the `docker-compose.staging.yml` authority -- read directly, it declares the exact
broken stage as staging's own build contract, corrected throughout §1, §5.1, §5.2, §5.4). The RED-
plan-vs-actual-RED gap is also closed as a side effect: the builder probe's RED state was previously
only "expected," now separately executed and confirmed. The remaining three (`CandidateArtifact`,
terminal-fixtures, verifier-isolation) were not independently derivable with confidence from the
topic names alone and are left for Jimmy's own literal correction text rather than guessed at here.

**Revision note, round 2 (2026-09-30):** Jimmy corrected his own count -- the cold review actually
had seven points; the two closed above plus the majority of a sixth (the `docker-compose.staging.yml`
authority line) left four material items plus one residual authority citation. All five applied
verbatim per Jimmy's exact text: (1) `CandidateArtifact` added to §2, between `RedPlanArtifact` and
`EvidenceGround`, with its frozen invariants; (2) §5.3's third item corrected from
`HUMAN_DECISION_REQUIRED` to `MECHANICAL` -- the fix mechanism is writer-lane discretion, not an
owner-level decision, and the prior classification would have stopped the state machine immediately
before the phase this engine exists to perform autonomously; (3) §6's `MISSING_AUTHORITY` and
`NON_REPRODUCIBLE` fixtures replaced -- the priors tested schema validation, not the actual
authority-resolution and semantic-input-closure properties each state exists to catch; (4) §4's
verifier-isolation paragraph replaced with an explicit, adapter-proven-not-assumed contract, and
`PatternVerificationArtifact` (§2) gained a mandatory `isolationEvidence` field plus the isolation
invariant; (5) §5.4's first (production-base) probe's `authorityEvidence` corrected from
`Dockerfile.gcp` (a working precedent, not this target's authority) to `docker-compose.staging.yml`
directly, matching what the second probe already cited. Also applied: §4 now states `VERIFY` and
`ADVERSARIAL_PROBES` jointly produce one final `PatternVerificationArtifact`, not an early `ACCEPT` locked
in before adversarial probes run.

**Revision note, round 3 (2026-09-30):** Jimmy's delta-check of round 2 confirmed §2, §4, §5.3, §6
correct, and found one material conflict plus one stale section. (1) §5.4's two RED probes were not
solution-neutral: asserting "npm ci succeeds against exactly today's frozen file set" only proves
GREEN for a fix that preserves that file set (e.g. `--ignore-scripts`) and would stay falsely RED
against an equally valid fix that changes the pre-install file set itself (e.g. `COPY scripts
./scripts` reordering) -- directly contradicting §5.3's own writer-discretion correction. Both
probes rewritten verbatim per Jimmy's text to assert the *behavior* (the declared install step must
not fail for this reason), derived from the candidate's own declared stage state, not a fixed
snapshot -- still genuinely RED on the unmodified base, but GREEN for any legitimate fix. (2) §7
still named writer-GREEN for the Docker probes as the next decision point; corrected to the actual
decided sequence -- create the reusable `PATTERN-PROOF-ENGINE-V1` routine, run `BOOTSTRAP_RED_ONLY`
(builds schemas/validators, state machine, orchestrator adapter, isolation proof, six terminal
fixtures, and the executable solution-neutral Docker RED probes above, then stops), with
`FULL_PATTERN_PROOF` as a separate later unit needing its own review and go. Also applied
throughout: the authority is now consistently named "the declared staging web build must succeed"
(`docker-compose.staging.yml -> Dockerfile:web`) rather than "the production image," since
`production-base` is only an internal stage name, not the authority itself.

**Revision note, round 4 (2026-09-30, ADR reconciliation before `BOOTSTRAP_RED_ONLY` starts):**
before creating the `PATTERN-PROOF-ENGINE-V1` routine, Jimmy cross-checked the frozen protocol
against existing normative ADRs (full detail in the main design's new §12). Applied here: every
`VerificationArtifact` reference renamed to `PatternVerificationArtifact` (avoids a real naming
collision with `ADR-24-22-Signature-Attestation.md`'s own canonical use of that name); §3's `DONE`
description sharpened to state this engine is not itself `PROVEN`/promotion authority (Dev-Gov/
trusted execution remains that authority, unchanged); §7 clarifies `BOOTSTRAP_RED_ONLY` builds
engine infrastructure under this program's normal practice, while the frozen design's writer-commit
constraint (§12 point 4, reconciling `development-governance.md`'s current "GitHub Copilot Agent
only" commit rule) applies from `FULL_PATTERN_PROOF` onward, when `WRITER` actually produces a
target candidate. No architectural rework -- Jimmy's own verdict: *"PPE-idén: kompatibel. Ingen
större ADR-krock... Efter dem skulle jag vara bekväm med att starta BOOTSTRAP_RED_ONLY."*

## 0. Jimmy's own scoping, verbatim

> Ja. Gå vidare till nästa separata fas nu -- men fortfarande endast implementation-design +
> RED-only för PATTERN-PROOF-ENGINE-01 V1. Ingen GREEN/implementation av motorn ännu. Jag skulle
> dessutom välja V1-target nu... Mitt förstaval är den redan observerade
> Dockerfile/postinstall-buildbuggen: npm ci -> postinstall-prisma-generate.mjs -> scripts/ ännu
> inte COPY:ad -> production image build fails. [criteria: real backlog, not a constructed demo;
> small and technically well-bounded; reproducible; clear real authority (the production image
> must build from declared repo inputs); a real dependency chain to discover; requires no new
> product semantics; does not touch W4, Loke, or spatial authority; the verifier can build its own
> adversarial probes around Docker stage/order, postinstall, and clean build] ...Design/RED-fasen
> ska ta fram: artifact schemas -> state machine -> orchestrator boundary -> target
> DiscoveryArtifact -> DependencyGraphArtifact -> DecisionGateArtifact -> RedPlanArtifact ->
> terminal-state fixtures och sedan stanna. Ingen writer-GREEN, ingen faktisk motorimplementation
> och ingen fix av Dockerfile ännu.

## 1. Target, independently re-verified (not assumed from the problem statement)

Before designing artifacts *about* the bug, the bug itself was re-verified directly against this
repository -- the same discipline the frozen design's §8 requires of the engine itself.

**Where the defect actually lives:** the root `Dockerfile`'s `production-base` stage
(`Dockerfile:32-37`):
```
FROM base AS production-base
ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --omit=dev --legacy-peer-deps
```
`package.json`'s own `scripts.postinstall` (`package.json:44`) is
`node scripts/postinstall-prisma-generate.mjs && node scripts/copy-cesium-assets.cjs`. `npm ci`
runs this automatically. At `Dockerfile:37`, only `package*.json` has been copied into the image
(`Dockerfile:35`) -- `scripts/` does not exist yet in this stage at all (the `production-base`
stage's own `COPY --from=builder` lines, `Dockerfile:40-50`, never copy `scripts/`, and there is no
`COPY scripts ./scripts` anywhere before line 37).

**Real, executed reproduction (verifier-owned probe, not a static read):** rather than trust the
static reading alone, or wait on a full `docker build` (this repository's build context is
currently inflated by dozens of accumulated full-repo worktree checkouts under `.worktrees/`,
`.codex-verification/`, `.audit-r1*/` etc. -- a real, separate hygiene issue, not this unit's
target -- which made a literal `docker build` transfer >1GB of context without reaching the failing
step inside a reasonable timeout), the exact filesystem state at `Dockerfile:37` was reproduced
directly: a clean temp directory containing only `package.json` + `package-lock.json` (matching
`COPY package*.json ./`, nothing else), then `npm ci --omit=dev --legacy-peer-deps` run there.
Actual result, byte for byte:
```
> miljobeslut-se-2.0@0.0.0 postinstall
> node scripts/postinstall-prisma-generate.mjs && node scripts/copy-cesium-assets.cjs

node:internal/modules/cjs/loader:1479
  throw err;
Error: Cannot find module '...\scripts\postinstall-prisma-generate.mjs'
    ...
    code: 'MODULE_NOT_FOUND'
npm error code 1
npm error command failed
```
This is the real, current failure -- not a hypothetical. The `builder` stage
(`Dockerfile:17-20`) has the identical structural defect for the identical reason -- **corrected in
this revision**: the file set present at the actual `RUN npm ci --legacy-peer-deps` line
(`Dockerfile:20`) is `COPY package*.json ./` (`Dockerfile:17`) + `COPY tsconfig.json ./`
(`Dockerfile:18`) only. `COPY prisma ./prisma` does not happen until `Dockerfile:22`, **after**
`npm ci` -- an earlier draft of this document incorrectly included `prisma/` in this stage's
pre-`npm ci` file set (conflating what's present by line 22 with what's present at line 20); this
matters because `prisma/` is irrelevant to the actual failure and including it would have made the
reproduction not match the real Dockerfile ordering. Separately re-executed with the corrected file
set (`package.json` + `package-lock.json` + `tsconfig.json` only, no `prisma/`): identical failure,
`Error: Cannot find module '...\scripts\postinstall-prisma-generate.mjs'`, `code: 'MODULE_NOT_FOUND'`
-- confirmed, not merely inferred from the production-base probe (the failure mechanism does not
depend on `--omit=dev`, but "does not depend on X" is not the same as "was actually run," so it was).

**Why this defect has gone unnoticed, corrected in this revision:** no *automated CI* pipeline
builds the plain `Dockerfile` -- `deploy-gcp.yml` builds `Dockerfile.gcp` instead, which does
**not** have this defect (verified directly, `Dockerfile.gcp:26,51`: both `npm ci` invocations
already carry `--ignore-scripts`, with `npx prisma generate` run explicitly afterward instead of
relying on `postinstall`). But this is a narrower claim than "the plain `Dockerfile` has no real
declared use" -- it does: **`docker-compose.staging.yml:6-8`** declares
`build: { context: ., dockerfile: Dockerfile, target: web }` as the staging environment's own build
contract, and `web` (`Dockerfile:58`) is `FROM production-base`, i.e. exactly the broken stage. This
is a real, checked-in, governed authority reference that an earlier draft of this document missed
entirely. `.github/workflows/deploy-staging.yml` does not invoke this compose file (it deploys to
Vercel via `npm run build` directly, per its own header comment referencing
`docker-compose.staging.yml` only for "fullstack (WebSocket, workers, PostGIS)" needs) -- so the
contract is real and declared but not currently CI-exercised, a more precise characterization than
"unbuilt": a developer running `docker-compose -f docker-compose.staging.yml up --build` locally
today would hit this exact failure. `Dockerfile.gcp` remains relevant as an existing,
already-proven-working pattern for solving this class of problem -- relevant to §5's
`DecisionGateArtifact` below, since it means a fix does not require inventing a new approach.

**Fit against the frozen design's authority-discovery rule (§8):** the authority here -- **the
declared staging web build must succeed** (renamed in this revision from "the production image must
build from declared repo inputs," per Jimmy's own correction: `docker-compose.staging.yml -> Dockerfile:web`
is the real, named authority; `production-base` is only an internal stage name within it, not the
authority itself) -- is not asserted; it is directly declared in `docker-compose.staging.yml:6-8`
and separately corroborated by `Dockerfile.gcp`'s own working pattern and
`npm`'s own documented `postinstall` semantics. No `MISSING_AUTHORITY` condition applies to this
target -- if anything, this target now has a *stronger* authority citation than the prior revision
had.

## 2. Artifact schemas (concrete, V1-scoped)

Per the frozen design (§2): mandatory semantic fields are protocol, not writer discretion; exact
serialization format remains implementation detail. The shapes below are the concrete V1 realization
of those mandatory fields -- TypeScript-flavored for readability, not yet a JSON Schema document
(that remains real GREEN-phase implementation work).

```ts
type EvidenceLocatorKind = 'file_line' | 'cas_artifact' | 'git_object' | 'postgis_ref'
  | 'signed_attestation' | 'runtime_result';

interface EvidenceLocator {
  readonly kind: EvidenceLocatorKind;
  readonly ref: string; // e.g. "Dockerfile:32-37", a CAS artifact id, a test-run identifier
  readonly note?: string;
}

interface DiscoveryFinding {
  readonly category: string; // e.g. "build-ordering-defect"
  readonly description: string;
  readonly evidence: readonly EvidenceLocator[]; // non-empty
}
interface DiscoveryArtifact {
  readonly findings: readonly DiscoveryFinding[];
}

interface DependencyGraphNode {
  readonly id: string;
  readonly kind: string; // e.g. "docker-stage" | "npm-script" | "fs-path"
  readonly evidence: readonly EvidenceLocator[];
}
interface DependencyGraphEdge {
  readonly from: string; // node id
  readonly to: string;   // node id
  readonly relationType: 'imports' | 'calls' | 'binds-to' | 'verifies-against' | 'invokes' | 'requires-present';
  readonly evidence: readonly EvidenceLocator[]; // non-empty
}
interface DependencyGraphArtifact {
  readonly nodes: readonly DependencyGraphNode[];
  readonly edges: readonly DependencyGraphEdge[];
}

type DecisionClassification = 'MECHANICAL' | 'HUMAN_DECISION_REQUIRED' | 'MISSING_AUTHORITY'
  | 'SCOPE_VIOLATION';
interface DecisionGateItem {
  readonly item: string;
  readonly classification: DecisionClassification;
  readonly derivation?: string;     // required if MECHANICAL
  readonly blockingReason?: string; // required if not MECHANICAL
}
interface DecisionGateArtifact {
  readonly items: readonly DecisionGateItem[];
}

interface RedProbe {
  readonly id: string;
  readonly assertedBehavior: string; // what must be false today (the correct RED state)
  readonly authorityEvidence: EvidenceLocator; // §8: the governed source this probe asserts against
  readonly command: string; // human-readable description; exact invocation is GREEN-phase detail
}
interface RedPlanArtifact {
  readonly probes: readonly RedProbe[];
}

interface AllowedPathsCompliance {
  readonly result: 'PASS' | 'FAIL';
  readonly allowedPaths: readonly string[];
  readonly evidence: readonly EvidenceLocator[]; // non-empty; derived from the actual candidate diff
}

interface CandidateArtifact {
  readonly candidateSha: string;
  readonly baseSha: string;
  readonly diffRef: EvidenceLocator; // resolvable Git/diff reference, not writer prose
  readonly allowedPathsCompliance: AllowedPathsCompliance;
}
/*
CandidateArtifact invariants:
- candidateSha and baseSha identify exact Git objects.
- diffRef must resolve to the exact baseSha..candidateSha diff.
- allowedPathsCompliance.evidence must be independently derivable from that diff.
- result: PASS is impossible if any changed path falls outside allowedPaths.
- once emitted, CandidateArtifact is immutable for that verification round (§6).
*/

type EvidenceGround = 'VERIFIER_OWNED_PROBE' | 'INDEPENDENT_CODE_DERIVATION' | 'WRITER_TEST_REGRESSION';
interface VerificationClaim {
  readonly claim: string;
  readonly evidenceGrounds: readonly EvidenceGround[]; // non-empty
  readonly materialInvariant: boolean;
}
type VerificationVerdict = 'ACCEPT' | 'FALSIFIED' | 'NOT_PROVEN';
interface PatternVerificationArtifact {
  readonly claims: readonly VerificationClaim[];
  readonly verdict: VerificationVerdict;
  readonly reasonCode?: string; // e.g. "VERIFICATION_BLOCKED", required when verdict === 'NOT_PROVEN'
  readonly isolationEvidence: readonly EvidenceLocator[]; // non-empty for ACCEPT or FALSIFIED (§4)
}
/*
PatternVerificationArtifact isolation invariant (§4):
ACCEPT or FALSIFIED requires non-empty, resolvable isolationEvidence.
If isolation cannot be demonstrated, the only valid verifier verdict is
NOT_PROVEN with reasonCode: VERIFICATION_BLOCKED.
*/

interface InputManifest {
  readonly baseSha: string;
  readonly candidateShaOrDiff: string;
  readonly dependencyLockHash: string;
  readonly fixtureContentHashes: Readonly<Record<string, string>>;
  readonly toolchainIdentity: string; // runtime/OS/tool versions
  readonly environmentConfig: Readonly<Record<string, string>>; // secrets excluded
  readonly secretBackedAuthority?: readonly { readonly keyId: string; readonly providerRef: string }[];
}
interface ProofPackage {
  readonly candidateSha: string;
  readonly baseSha: string;
  readonly tree: string;
  readonly probeIdentities: readonly string[];
  readonly verifierAuthority: string;
  readonly provenInvariants: readonly string[];
  readonly inputManifest: InputManifest;
}
```

## 3. State machine (V1)

```
DISCOVER -> BUILD_GRAPH -> DECISION_GATE -> RED_SYNTHESIS -> WRITER -> VERIFY -> ADVERSARIAL_PROBES -> ASSEMBLE_EVIDENCE -> DONE
```

Each arrow is conditional on the previous phase's artifact not tripping a terminal state. Terminal
states (frozen design §3, all six required to have contract-test coverage per §1 there):

| Terminal state | Triggered from | Meaning |
|---|---|---|
| `HUMAN_DECISION_REQUIRED` | `DECISION_GATE` | a `DecisionGateArtifact` item classified as such |
| `MISSING_AUTHORITY` | `DECISION_GATE` or `RED_SYNTHESIS` | no `EvidenceLocator` resolves the needed authority |
| `SCOPE_VIOLATION` | `WRITER` | writer touched a path outside its allow-list, or attempted to alter proof policy/acceptance criteria |
| `FALSIFIED` | `ADVERSARIAL_PROBES` | verifier's own probe broke the candidate |
| `NOT_PROVEN` | `VERIFY` or `ADVERSARIAL_PROBES` | a mandatory probe could not execute at all (`reasonCode: VERIFICATION_BLOCKED`) |
| `NON_REPRODUCIBLE` | `ASSEMBLE_EVIDENCE` | replay from the declared `InputManifest` alone produces a different result |

`DONE` is reached only by producing a `ProofPackage` -- which, per the frozen design (§3, §12), is
itself only the trigger for "proceed to owner push-go," not an autonomous merge/deploy action, and
not `PROVEN` status in its own right -- final `PROVEN`/promotion remains with Dev-Gov/trusted
execution, unchanged by this engine existing.

## 4. Orchestrator boundary (Workflow as first adapter, not the protocol)

Per the frozen design's Q-PPE-3 resolution: the state machine (§3) and artifact protocol (§2) are
defined independently of any orchestrator. This section records how the Workflow tool -- the
concrete mechanism available in this environment -- would implement that protocol as its first
adapter, without that mapping becoming part of the protocol itself.

- `DISCOVER`, `BUILD_GRAPH`, `DECISION_GATE`, `RED_SYNTHESIS` map to a `pipeline()` of `agent()`
  calls, each schema-validated against the corresponding §2 interface (Workflow's `schema` option
  forces a structured-output tool call matching the artifact shape).
- `WRITER` is a separate `agent()` call receiving only the frozen `RedPlanArtifact` and an explicit
  allowed-paths list in its prompt -- never the discovery/graph/decision agents' raw transcripts
  (frozen design §4).
- `VERIFY` / `ADVERSARIAL_PROBES` require a separately-created verifier execution context with its
  own role/prompt and no access to writer transcript, writer rationale, writer self-reported
  results, or writer-private execution state. The verifier's permitted inputs are explicit:
  repository/base identity, frozen candidate identity/diff, frozen design/spec, `RedPlanArtifact`,
  and the declared verifier runtime inputs.
- Fresh-context isolation is an adapter precondition, not an assumption. The Workflow adapter must
  produce resolvable runtime evidence that the verifier context was instantiated with only those
  declared inputs. A second `agent()` call is not, by itself, proof of isolation.
- `PatternVerificationArtifact` (§2) therefore carries a non-empty `isolationEvidence: EvidenceLocator[]`,
  identifying the runtime/orchestrator evidence for that separation.
- If the Workflow runtime cannot demonstrate this property, the verifier is not labelled
  independent. The run terminates fail-closed as `verdict: NOT_PROVEN`,
  `reasonCode: VERIFICATION_BLOCKED` -- making isolation something the engine must **prove**, not a
  comment in a prompt.
- `VERIFY` and `ADVERSARIAL_PROBES` together produce a single, final `PatternVerificationArtifact` --
  the verify phase cannot already lock in `ACCEPT` before the adversarial probes (§6 of the frozen
  design) have run; there is one verdict per round, not an early one revised later.
- `ASSEMBLE_EVIDENCE` is a final `agent()` (or plain script logic) that composes the `ProofPackage`
  from the prior stages' artifacts plus the `InputManifest`.
- Terminal states (§3) are ordinary early-return control flow in the script -- a `DecisionGateItem`
  classified `HUMAN_DECISION_REQUIRED`, for instance, makes the script return that state without
  calling `WRITER` at all. Nothing about the state machine depends on Workflow's own primitives
  beyond using them as the execution mechanism.

No script is written in this document -- this section is the design for one, not the artifact
itself, matching "no actual engine implementation" from §0.

## 5. Target artifacts (Docker/postinstall build-ordering defect)

### 5.1 `DiscoveryArtifact`

```json
{
  "findings": [
    {
      "category": "build-ordering-defect",
      "description": "production-base stage runs `npm ci --omit=dev` while only package*.json is present; npm's own postinstall hook requires scripts/postinstall-prisma-generate.mjs, which does not exist in the image yet at that point.",
      "evidence": [
        { "kind": "file_line", "ref": "Dockerfile:32-37" },
        { "kind": "file_line", "ref": "package.json:44" },
        { "kind": "runtime_result", "ref": "local npm-ci reproduction, 2026-09-30, exit 1, MODULE_NOT_FOUND on scripts/postinstall-prisma-generate.mjs" }
      ]
    },
    {
      "category": "build-ordering-defect",
      "description": "builder stage has the structurally identical defect for the identical reason: at Dockerfile:20 (npm ci --legacy-peer-deps) only package*.json + tsconfig.json are present -- prisma/ is not copied until line 22, after npm ci, so it is not part of this stage's pre-npm-ci file set (corrected from an earlier draft that had incorrectly included prisma/). Separately re-executed with the corrected file set: identical MODULE_NOT_FOUND failure.",
      "evidence": [
        { "kind": "file_line", "ref": "Dockerfile:17-20" },
        { "kind": "runtime_result", "ref": "local npm-ci reproduction, 2026-09-30, package.json+package-lock.json+tsconfig.json only: exit 1, MODULE_NOT_FOUND on scripts/postinstall-prisma-generate.mjs" }
      ]
    },
    {
      "category": "governed-build-contract",
      "description": "docker-compose.staging.yml declares { context: '.', dockerfile: 'Dockerfile', target: 'web' } as the staging environment's own build contract; web is FROM production-base, i.e. exactly the broken stage. This declared staging web build is the direct authority, not merely an inference from Dockerfile.gcp's working pattern; production-base is only the internal stage name within it.",
      "evidence": [{ "kind": "file_line", "ref": "docker-compose.staging.yml:6-8" }, { "kind": "file_line", "ref": "Dockerfile:58" }]
    },
    {
      "category": "existing-working-precedent",
      "description": "Dockerfile.gcp already solves the same class of problem: both its npm ci invocations pass --ignore-scripts, followed by an explicit npx prisma generate.",
      "evidence": [{ "kind": "file_line", "ref": "Dockerfile.gcp:26,28,51,53" }]
    },
    {
      "category": "authority-for-current-behavior",
      "description": "no automated CI pipeline builds the plain Dockerfile or invokes docker-compose.staging.yml -- deploy-staging.yml deploys to Vercel via npm run build directly, not via this compose file (per its own header comment); only Dockerfile.gcp is CI-built (deploy-gcp.yml), which does not have this defect. The staging build contract is real and declared, just not currently CI-exercised -- explaining why it has gone unnoticed rather than indicating it is not real or not authoritative.",
      "evidence": [
        { "kind": "file_line", "ref": ".github/workflows/deploy-gcp.yml:88-89" },
        { "kind": "file_line", "ref": ".github/workflows/deploy-staging.yml:1-6" },
        { "kind": "runtime_result", "ref": "repo-wide grep for 'docker build'/'-f Dockerfile', 2026-09-30: only deploy-gcp.yml and build-postgres-image.yml (unrelated Postgres image) match" }
      ]
    }
  ]
}
```

### 5.2 `DependencyGraphArtifact`

```json
{
  "nodes": [
    { "id": "dockerfile:production-base", "kind": "docker-stage", "evidence": [{ "kind": "file_line", "ref": "Dockerfile:32" }] },
    { "id": "dockerfile:builder", "kind": "docker-stage", "evidence": [{ "kind": "file_line", "ref": "Dockerfile:16" }] },
    { "id": "npm:ci", "kind": "npm-lifecycle", "evidence": [{ "kind": "file_line", "ref": "Dockerfile:37" }] },
    { "id": "npm:postinstall-hook", "kind": "npm-script", "evidence": [{ "kind": "file_line", "ref": "package.json:44" }] },
    { "id": "fs:scripts/postinstall-prisma-generate.mjs", "kind": "fs-path", "evidence": [{ "kind": "file_line", "ref": "scripts/postinstall-prisma-generate.mjs:1" }] },
    { "id": "fs:scripts/copy-cesium-assets.cjs", "kind": "fs-path", "evidence": [{ "kind": "file_line", "ref": "scripts/copy-cesium-assets.cjs:1" }] },
    { "id": "dockerfile.gcp:working-pattern", "kind": "docker-stage", "evidence": [{ "kind": "file_line", "ref": "Dockerfile.gcp:26,28,51,53" }] },
    { "id": "docker-compose.staging.yml:web-target", "kind": "governed-build-contract", "evidence": [{ "kind": "file_line", "ref": "docker-compose.staging.yml:6-8" }] }
  ],
  "edges": [
    { "from": "dockerfile:production-base", "to": "npm:ci", "relationType": "invokes", "evidence": [{ "kind": "file_line", "ref": "Dockerfile:37" }] },
    { "from": "npm:ci", "to": "npm:postinstall-hook", "relationType": "invokes", "evidence": [{ "kind": "file_line", "ref": "package.json:44" }] },
    { "from": "npm:postinstall-hook", "to": "fs:scripts/postinstall-prisma-generate.mjs", "relationType": "requires-present", "evidence": [{ "kind": "runtime_result", "ref": "local npm-ci reproduction, 2026-09-30: MODULE_NOT_FOUND for exactly this path" }] },
    { "from": "npm:postinstall-hook", "to": "fs:scripts/copy-cesium-assets.cjs", "relationType": "requires-present", "evidence": [{ "kind": "file_line", "ref": "package.json:44" }] },
    { "from": "dockerfile:builder", "to": "npm:ci", "relationType": "invokes", "evidence": [{ "kind": "file_line", "ref": "Dockerfile:20" }] },
    { "from": "docker-compose.staging.yml:web-target", "to": "dockerfile:production-base", "relationType": "verifies-against", "evidence": [{ "kind": "file_line", "ref": "Dockerfile:58", "note": "web target is FROM production-base" }] }
  ]
}
```
The missing edge is the point: no `COPY scripts ./scripts` (or equivalent) node/edge exists before
`npm:ci` in either stage's own graph. That absence, not a present-but-wrong edge, is the defect --
consistent with `DependencyGraphArtifact`'s own purpose (§2 of the frozen design): making a missing
relationship visible mechanically, the same category of thing that should have caught the
binding-vs-bridge problem earlier today, applied here to a build graph instead of a code
authority graph.

### 5.3 `DecisionGateArtifact`

```json
{
  "items": [
    {
      "item": "Does a fix require inventing a new approach, or does one already exist in this repo?",
      "classification": "MECHANICAL",
      "derivation": "Dockerfile.gcp already solves this exact class of problem (--ignore-scripts + explicit npx prisma generate) and is the actually-deployed definition. A fix for the plain Dockerfile can follow the same already-proven pattern rather than requiring new design."
    },
    {
      "item": "Should the fix be scoped to just production-base, or also to builder (which has the identical defect for the identical reason)?",
      "classification": "MECHANICAL",
      "derivation": "Both stages exhibit the same missing-edge defect in the same DependencyGraphArtifact sense (§5.2); fixing one and leaving the structurally identical defect in the other would not close the actual authority claim (the declared staging web build must succeed) since builder also needs to succeed for that build to complete at all."
    },
    {
      "item": "Who selects the concrete implementation mechanism (--ignore-scripts plus explicit generation, COPY reordering, or another implementation that satisfies the same frozen contract)?",
      "classification": "MECHANICAL",
      "derivation": "This is writer-lane implementation discretion, not an owner-level semantic or authority decision. The writer may choose any mechanism that closes both RED probes, remains inside the allowed paths, preserves the declared staging build contract, and does not alter proof policy or acceptance criteria. The DecisionGate therefore does not stop before WRITER."
    }
  ]
}
```
No target-specific `HUMAN_DECISION_REQUIRED`, `MISSING_AUTHORITY`, or `SCOPE_VIOLATION`
condition exists at this point -- **corrected in this revision**: an earlier draft classified the
choice of fix mechanism as `HUMAN_DECISION_REQUIRED`, which would have stopped the state machine
immediately before the exact phase this engine exists to perform autonomously. The authority is
resolved, the required behavior is defined, and the concrete implementation mechanism is
deliberately delegated to the writer lane under the frozen RED contract and allowed-path boundary.

### 5.4 `RedPlanArtifact`

```json
{
  "probes": [
    {
      "id": "red-production-base-npm-ci-postinstall",
      "assertedBehavior": "The root Dockerfile's production-base stage must be able to execute its declared npm dependency-install step without failing because package.json lifecycle-script dependencies are absent from the filesystem state established by that stage before the install step.",
      "authorityEvidence": { "kind": "file_line", "ref": "docker-compose.staging.yml:6-8", "note": "direct declared staging web-build contract: root Dockerfile, target web" },
      "command": "derive the production-base stage filesystem/input state and npm-install command from the Dockerfile under test, execute an equivalent isolated stage-prefix probe, and assert that the dependency-install step does not fail with a missing lifecycle-script dependency"
    },
    {
      "id": "red-builder-npm-ci-postinstall",
      "assertedBehavior": "The root Dockerfile's builder stage must be able to execute its declared npm dependency-install step without failing because package.json lifecycle-script dependencies are absent from the filesystem state established by that stage before the install step.",
      "authorityEvidence": { "kind": "file_line", "ref": "docker-compose.staging.yml:6-8", "note": "the declared staging web build necessarily traverses the builder stage" },
      "command": "derive the builder-stage filesystem/input state and npm-install command from the Dockerfile under test, execute an equivalent isolated stage-prefix probe, and assert that the dependency-install step does not fail with a missing lifecycle-script dependency"
    }
  ]
}
```
**Corrected in this revision, materially -- solution-neutral probes:** the prior probes asserted
"npm ci succeeds against exactly today's frozen file set," which only proves GREEN for a fix that
keeps the file set unchanged (e.g. `--ignore-scripts`). It would still show RED against an equally
valid fix that changes the pre-install file set itself (e.g. `COPY scripts ./scripts` before
`npm ci`) -- directly contradicting §5.3's own correction that the writer may choose any mechanism
satisfying the frozen contract. The probes above instead assert the *behavior* ("the declared
install step must not fail for this reason"), derived from the candidate's own declared stage state
at its `npm ci` point, not from a fixed file-set snapshot. On the unmodified base this still derives
today's real state -- builder: `package*.json` + `tsconfig.json`, no `scripts/`; production-base:
`package*.json` only, no `scripts/` -- so both remain genuinely RED today (§1), but after GREEN,
every legitimate fix (`--ignore-scripts`, `COPY scripts` reordering, or another correct lifecycle
change) passes, because the probe evaluates the candidate's own declared state rather than
re-asserting the base's. This is the core Pattern-Proof principle: RED freezes the desired
behavior, not the implementation the writer is expected to choose. Both probes cite
`docker-compose.staging.yml`'s own declared build contract directly (§8's authority-discovery
rule) -- neither invents a signal that does not already exist.

## 6. Terminal-state fixtures (small, deterministic, per the frozen design's §1 requirement)

Per the frozen design (as of v3): all six terminal states must have contract-test coverage, not
only a happy-path run. These are fixture *definitions* -- small, concrete scenarios a future GREEN
phase would implement as actual assertions -- not the assertions themselves (that is writer/GREEN
work, out of scope here per §0).

| Terminal state | Fixture |
|---|---|
| `HUMAN_DECISION_REQUIRED` | A **synthetic contract fixture, not the Docker target**, supplies a valid `DecisionGateArtifact` containing a genuine owner-level semantic choice with no mechanically derivable answer. Assert that the engine halts before `WRITER` and returns `HUMAN_DECISION_REQUIRED`. |
| `MISSING_AUTHORITY` | Supply a syntactically valid discovery/dependency input whose required authority `EvidenceLocator` cannot be resolved to an already-produced governed source. No `RedPlanArtifact` is emitted. Assert that authority resolution fails closed and the engine terminates with `MISSING_AUTHORITY` before RED synthesis can authorize a probe. |
| `SCOPE_VIOLATION` | Supply a valid `CandidateArtifact` whose resolved `baseSha..candidateSha` diff contains a path outside its frozen allow-list (e.g. only `Dockerfile` allowed, but the candidate also changes `package.json`). Assert `allowedPathsCompliance.result === 'FAIL'` and that the engine halts before verifier execution. |
| `FALSIFIED` | Supply a frozen candidate that closes only one of the two Docker RED probes. The verifier-owned adversarial probe independently exercises the other stage and breaks the candidate. Assert terminal state `FALSIFIED`; the candidate is not edited in place. |
| `NOT_PROVEN` | Make a mandatory verifier probe unavailable before execution (simulated missing required runtime/tool is sufficient). Assert `PatternVerificationArtifact.verdict === 'NOT_PROVEN'` and `reasonCode === 'VERIFICATION_BLOCKED'`; never convert inability to execute into `ACCEPT` or `FALSIFIED`. |
| `NON_REPRODUCIBLE` | Supply a **schema-valid and apparently complete** `InputManifest`, but make the fixture execution also depend on an intentionally undeclared input such as `PPE_FIXTURE_MODE`. Replay the identical declared manifest once with `PPE_FIXTURE_MODE=A` and once with `PPE_FIXTURE_MODE=B`, producing different results. Assert `NON_REPRODUCIBLE`. This tests semantic input closure rather than JSON/schema validation. |

**Corrected in this revision** (per Jimmy's cold review): the prior `MISSING_AUTHORITY` fixture
tested a schema-invalid `RedPlanArtifact`, not a genuine authority-resolution failure; the prior
`NON_REPRODUCIBLE` fixture tested by removing a required manifest field, which is schema validation,
not semantic input-closure failure. Both are replaced above with fixtures that test the real
property each state exists to catch. Each fixture is designed to be small and self-contained --
none require standing up the real Docker build pipeline; all six can be exercised with fixture-scale
inputs, consistent with Jimmy's own "inte sex stora end-to-end-scenarier; små deterministiska
contract fixtures räcker."

## 7. Stop point

Per Jimmy's own explicit instruction (§0): this document stops here. Not built, not started:
- The actual Workflow script implementing §4's orchestrator mapping.
- Any writer-lane fix to `Dockerfile`/`Dockerfile.builder` stage.
- Execution of either `RedPlanArtifact` probe as an automated, repeatable script (both were
  verified manually in §1 as grounding evidence, which is discovery/RED-synthesis work per the
  frozen design -- not the same as building the writer/verifier machinery itself).
- Implementation of any of §6's fixtures as actual runnable tests.
- A `PatternVerificationArtifact`, `ProofPackage`, or any GREEN state for this target.

**Corrected in this revision -- stale next-step, per Jimmy's own decided sequence:** the next step
is *not* writer-GREEN for the Docker probes. It is creating the reusable, on-demand
`PATTERN-PROOF-ENGINE-V1` routine and running it in `BOOTSTRAP_RED_ONLY` mode. That run builds:
`schemas/validators -> state machine -> orchestrator adapter -> isolation proof -> six terminal
fixtures -> executable solution-neutral Docker RED probes`, then stops -- no Dockerfile-GREEN in
that run. `FULL_PATTERN_PROOF` (writer builds a Docker candidate -> freeze -> fresh verifier ->
adversarial probes -> clean-room replay -> `ProofPackage`) is a separate, later unit requiring its
own review and its own separate go -- not taken by this session, and not triggered automatically by
`BOOTSTRAP_RED_ONLY` completing.

**Added per Jimmy's ADR-reconciliation pass (frozen design §12):** `BOOTSTRAP_RED_ONLY` builds the
engine's own infrastructure (schemas, state machine, orchestrator adapter, isolation proof,
fixtures, the two RED probes) -- it follows this program's own established practice for that kind of
work (a new branch, real code, real verification, push, stop for cold review; no PR, no merge). It
does not itself invoke the `WRITER` role against a target candidate, so the frozen design's
writer-commit constraint (§12, point 4 -- the writer produces a diff, not a commit, pending
`development-governance.md`'s current commit-authority policy) applies from `FULL_PATTERN_PROOF`
onward, not to this bootstrap run's own engine-building work.
