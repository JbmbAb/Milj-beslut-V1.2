# PATTERN-PROOF-ENGINE-01 -- design (V1 scope only)

**Status:** `ACCEPT / FROZEN` (2026-09-30, Jimmy's final surgical check) -- design only, no code,
no workflow script written under it yet. Not self-reviewed by its own author: Jimmy was the
independent architecture/falsification reviewer throughout (v1 `ACCEPT_WITH_CHANGES`, v2
`ACCEPT_WITH_MINOR_CHANGES`, v3 two remaining stale formulations, v4 clean -- see the revision
notes below), precisely because a writer/verifier-separation engine should not have its own design
self-approved by the agent that wrote it. Next separate decision point: RED-only/design of the V1
implementation itself, plus selection of the small real backlog target (§10, Q-PPE-1) -- not
something this session proceeds to on its own initiative.

**Revision note (v2, 2026-09-30):** Jimmy's independent cold review returned
`ACCEPT_WITH_CHANGES` -- no architecture rework, four required corrections plus one
generalization, all applied below (§2, §3, §5, §7, §8, §10). Everything else in this document is
unchanged from v1 to keep the remaining delta-review scoped to just these edits, per Jimmy's own
"jag ser inget behov av att läsa om hela designen från noll om resten förblir byte-identiskt."

**Revision note (v3, 2026-09-30):** Jimmy's delta-review of v2 returned
`ACCEPT_WITH_MINOR_CHANGES`, then, once these are applied, `ACCEPT / FREEZE-READY` -- two
must-fix internal inconsistencies (§3's `MISSING_AUTHORITY` wording had not been updated to match
§8's generalized `EvidenceLocator` language; `VerificationArtifact.claims[]` needed an array of
evidence grounds, not exactly one, to actually represent §5's own "writer-regression plus a
verifier-owned ground" case) and two recommended hardenings (canonical `NOT_PROVEN` verdict with a
`reasonCode` rather than a double-barreled state name; `InputManifest` must identify
secret-dependent authority via non-secret fingerprints/references, never secret material itself),
plus one §1 wording tightening (contract tests must cover all six terminal states, not three). All
applied below (§1, §2, §3, §5, §7). Everything else remains byte-identical from v2, per Jimmy's own
"En sista kirurgisk delta-check av just §2, §3, §7 och den enda meningen i §1 räcker."

**Revision note (v4, 2026-09-30):** Jimmy's final surgical delta-check on v3 found two remaining
stale formulations, not new architectural findings: `WRITER_TEST_REGRESSION_ONLY` was
self-contradictory once that value could legitimately co-occur with another ground in
`evidenceGrounds[]` (renamed to `WRITER_TEST_REGRESSION`, §2), and §3's `NON_REPRODUCIBLE` still
described replay against "base/candidate/tool-version inputs alone" -- predating §7's own extension
to the full `InputManifest`, which would have left §3 and §7 defining two different replay
contracts (§3 now points at the `InputManifest`). Both fixed; mechanically confirmed absent from
the live document afterward (only the correction notes themselves now quote the old wording, to
explain what changed). Per Jimmy's own stated verdict once these two land:
**`PATTERN-PROOF-ENGINE-01 DESIGN -- ACCEPT / FREEZE-READY`.** No further cold review is expected.

**Relationship to today's other work:** explicitly a separate platform track from W4
(project-context readiness + canonical LU projection). Not blocked by W4, does not block W4. The
only connection: W4, once PROVEN, may later become one of this engine's own historical training/
test cases (§9) -- that is future work, not part of this design.

## 0. Jimmy's own scoping, verbatim (the authority for everything below)

**First message (initial vision, three levels: mechanical automation, real autonomous engineering,
institutional memory):**

> Ja. Jag skulle inte bygga workflowet som en engångsmaskin för de två LU-bryggorna... Det bör bli
> en generell Pattern → Candidate → Falsification → Proof-motor som kan återanvändas i Mimer...
> [10-point list: autonomous discovery; authority/dependency graph; pattern extraction from PROVEN
> units; semantic-diff/decision detector; RED synthesis that refuses to invent authority; writer
> lane with no proof-policy/acceptance-criteria authority; independent verifier lane that derives
> its own probes and does not trust writer evidence; autonomous adversarial probe generation from
> real historical bug families; evidence assembler; learning registry]
> ...Första versionen bör bevisa själva autonomiloopen: discover → dependency graph → decision gate
> → RED → writer → independent verifier → adversarial probes → evidence. Sedan lägger vi på learning
> registry + återanvändning... Den stora målbilden är alltså inte "Mimer kan bygga brygga två
> själv". Den är: Mimer kan känna igen att ett tidigare bevisat arkitekturmönster gäller på en ny
> plats, avgöra vad som kan härledas automatiskt, stoppa vid verkliga ägarbeslut, bygga kandidaten,
> försöka slå sönder den och lämna ett verifierbart proof package.

**Second message (sequencing decision + concrete V1 additions + reviewer-role decision):**

> jag håller med om båda besluten. W4 ska gå vidare nu och motorn ska vara ett separat
> plattformsspår... Det finns några saker jag skulle lägga till i PATTERN-PROOF-ENGINE-01 redan i
> designen: [artifacts not just agent steps; explicit stop semantics; exact writer/verifier
> isolation; verifier must create its own evidence; candidate freeze before adversarial review;
> clean-room replay as final requirement; authority-discovery before RED synthesis, citing
> `mapLayerSelection.unavailable` as the canonical regression example; no learning registry in V1]
> ...Jag skulle alltså köra: Claude → Design author. Jag → independent architecture cold review.
> Claude/annan writer → RED-only. separat verifier → falsification.

Both messages are the authority for this document. Nothing below claims to resolve anything they
did not ask for, and nothing below reflects this session's own approval -- this document is
`ACCEPT / FROZEN` on Jimmy's own independent review alone (revision notes above), never
self-approved.

## 1. Scope of V1 (the only thing this design proposes building)

**In scope:** proving the core loop once, end to end, on one real target:

```
discover -> dependency graph -> decision gate -> RED synthesis -> writer -> independent verifier
-> adversarial probes -> evidence (proof package)
```

**Added per Jimmy's cold review (Q-PPE-1 answer, §10):** a single successful happy-path run is not
sufficient proof for V1. The V1 proof run must also include **contract tests for all six terminal
states** (§3), not a subset -- **tightened per Jimmy's v2 delta-review**: since V1 already defines
six terminal outcomes, testing only some of them would leave the state-machine contract frozen
while half of it stays unproven. Required coverage, each as a small, deterministic contract fixture
rather than a full end-to-end scenario: `HUMAN_DECISION_REQUIRED`, `MISSING_AUTHORITY`,
`SCOPE_VIOLATION`, `FALSIFIED`, `NOT_PROVEN`, `NON_REPRODUCIBLE`. Proving the happy path alone would
not demonstrate that the engine's stop semantics (§3) are real rather than aspirational.

**Explicitly out of scope for V1 (per §0, second message):**
- Learning registry (structured PROVEN/FAIL knowledge extraction across units). Comes after the
  loop above is proven once, not alongside it -- building a memory system for a process whose own
  semantics are not yet stable is backwards.
- Pattern extraction *reuse* from prior PROVEN units as an automated capability (the 10-point list's
  item 3). V1 proves the loop can run once on a fresh target; reusing what it learned across targets
  is the V2 question the learning registry exists to answer.
- Loke (`source -> quarantine -> approval -> CAS -> import`), spatial/runtime reconciliation, and
  Dev-Gov detector (Runtime Reachability, Authority Bypass, Semantic Fallback) plugins. Real,
  named synergies (§10) -- not built in V1. V1 targets one domain end to end rather than several
  domains shallowly.
- Any actual target unit. This document does not nominate what V1 runs against -- that is a
  separate decision after this design itself is accepted, matching the same "design before target
  selection" discipline this whole program has used all day (design frozen and reviewed *before*
  RED, RED before implementation).

## 2. Artifact pipeline (machine-readable output per phase, not just agent transcripts)

Per Jimmy's explicit requirement: every phase of the loop leaves a typed, machine-readable artifact
-- not merely an agent's prose conclusion buried in a transcript.

**Corrected per Jimmy's cold review (point 1):** the exact wire schema/serialization format for
each artifact *is* writer-lane implementation detail -- but each artifact's **mandatory semantic
fields and invariants are not**. Because artifacts are the only permitted communication channel
between phases, their semantics are part of the proof protocol itself, not an ordinary
implementation choice any given writer round gets to make. The writer lane implements how an
artifact is serialized; it does not get to decide what a `VerificationArtifact` must contain to
count as evidence, or what an edge in a `DependencyGraphArtifact` must carry to count as real. Full
JSON Schema is not frozen here (that remains real implementation work) -- the mandatory fields
below are.

**`EvidenceLocator` (generalization, per Jimmy's cold review):** every artifact below that requires
evidence must cite one or more `EvidenceLocator`s, not necessarily a `file:line`. A `file:line` is
one *kind* of `EvidenceLocator` -- correct and sufficient for a pure-code claim, but too narrow for
this engine's own stated future domains. Other valid kinds: a CAS artifact id, a Git object SHA, a
PostGIS schema/table reference, a signed attestation id, or a runtime execution result reference
(e.g. a specific test run's output). The invariant that matters is not "the locator is a source
line" -- it is that authority is proven via a **resolvable, governed source**, not merely asserted
to "exist in the codebase" (this sharpens §8's rule the same way).

```
DiscoveryArtifact -> DependencyGraphArtifact -> DecisionGateArtifact -> RedPlanArtifact
-> CandidateArtifact -> VerificationArtifact -> ProofPackage
```

- **`DiscoveryArtifact`**: what the discovery phase found -- candidate consumer sites, duplicated
  semantics, authority bypasses, legacy fallbacks, hand-written DB queries, or whatever pattern the
  run was scoped to look for.
  **Mandatory fields:** `findings[]`, each with a `category` (the pattern type being searched for),
  a `description`, and **at least one `EvidenceLocator`**. A finding with zero `EvidenceLocator`s is
  not admissible into the next phase -- this replaces v1's narrower `file:line`-only requirement.
- **`DependencyGraphArtifact`**: the actual dependency chain the candidate would sit on, built
  *before* any code is written -- e.g. this afternoon's own real example, `ProjectPlan -> Project ->
  ProjectContextBinding -> LU assessment -> projection -> consumer`. This is explicitly the
  artifact that should have made the binding-vs-bridge problem visible mechanically, before any
  design note was hand-written to discover it the same way today.
  **Mandatory fields:** `nodes[]` (real symbols/files/artifacts, not asserted concepts) and
  `edges[]`, each edge carrying a `relationType` (e.g. imports/calls/binds-to/verifies-against) and
  its own `EvidenceLocator` -- an edge asserted without evidence is not a valid graph edge.
- **`DecisionGateArtifact`**: the semantic-diff/decision-detector's output -- a list of items each
  tagged either mechanically-derivable (with the derivation) or one of the terminal decision states
  (§3). This is the artifact a human decision blocks on; the engine does not proceed past an open
  `HUMAN_DECISION_REQUIRED` item in this artifact.
  **Mandatory fields:** `items[]`, each with a `classification` (`MECHANICAL` or one of §3's
  terminal states), and -- if `MECHANICAL` -- the actual `derivation`, or -- if a terminal state --
  the specific `blockingReason`. An item with neither is incomplete, not merely terse.
- **`RedPlanArtifact`**: the RED probes the writer lane is authorized to build against, generated
  only from what `DecisionGateArtifact` and `DependencyGraphArtifact` actually established --
  never from an assumed authority. §8 is the hard rule this artifact must obey.
  **Mandatory fields:** `probes[]`, each with the `assertedBehavior` it will prove false today (the
  correct RED state), and the `EvidenceLocator` of the governed authority source it is asserting
  against -- a probe that cannot cite one fails §8's authority-discovery rule and must not be
  included.
- **`CandidateArtifact`**: the writer's frozen output -- exact SHA, exact diff, exact allowed-paths
  compliance. Frozen means frozen (§6): once this artifact exists, the writer lane's job for this
  round is done.
  **Mandatory fields:** `candidateSha`, `baseSha`, `diff` (or a resolvable reference to it), and an
  explicit `allowedPathsCompliance` result with its own supporting evidence, not a bare boolean
  assertion.
- **`VerificationArtifact`**: the independent verifier's own findings, evidence, and probes --
  never a copy of or reference to the writer's own reasoning (§4-5).
  **Mandatory fields, per Jimmy's cold review point 2, corrected in the v2 delta-review:**
  `claims[]`, each with an `evidenceGrounds[]` (an array, at least one entry, not exactly one field
  -- a single enum could not represent §5's own "writer-regression plus a verifier-owned ground"
  case), each entry one of `VERIFIER_OWNED_PROBE`, `INDEPENDENT_CODE_DERIVATION`, or
  `WRITER_TEST_REGRESSION` (renamed from `..._ONLY` in the v3 delta-check -- the trailing `_ONLY`
  was self-contradictory once this value could legitimately sit alongside another ground in the
  same array), and a `materialInvariant: boolean` flag. **Invariant this artifact
  must satisfy: `materialInvariant: true` implies `evidenceGrounds` contains `VERIFIER_OWNED_PROBE`
  or `INDEPENDENT_CODE_DERIVATION`** -- `WRITER_TEST_REGRESSION` may still appear alongside
  either as supplementary regression evidence, but never as the only entry on a material claim --
  see §5. The artifact's own `verdict` must be one of `ACCEPT`, `FALSIFIED`, or `NOT_PROVEN` (§3);
  when `verdict` is `NOT_PROVEN` because a mandatory probe could not run at all (rather than having
  run and found nothing wrong), the artifact also carries `reasonCode: VERIFICATION_BLOCKED` (§3).
- **`ProofPackage`**: the evidence assembler's final output. Per the 10-point list: exact
  candidate SHA, exact base SHA, tree, test/probe identities, verifier authority, and exactly which
  invariants were actually proven -- not a generic "tests passed."
  **Mandatory fields, extended per Jimmy's cold review point 3:** the above, plus a declared
  `InputManifest` (§7) -- a `ProofPackage` without one is not eligible for clean-room replay.

Each artifact is the *only* channel the next phase may read from the previous one. A phase may not
reach backward into an earlier phase's raw agent transcript -- that would silently reintroduce
exactly the kind of unstructured, unverifiable hand-off this design exists to replace.

## 3. Explicit stop semantics (terminal states, not just "success" or generic failure)

Per Jimmy's explicit requirement, the engine must be able to halt in one of several named terminal
states instead of always forcing itself toward producing code:

- **`HUMAN_DECISION_REQUIRED`** -- the decision gate found something no mechanical derivation can
  resolve (example from today, verbatim: "ska C-anmälan visa hela verdictet eller en förenklad
  projektion?"). The engine stops; a human answer is a new input, not something the engine
  guesses at or defaults on its own authority.
- **`MISSING_AUTHORITY`** -- discovery or dependency-graph construction found that the authority the
  candidate would need to assert (a coverage signal, a binding, a governed state) **cannot be
  resolved to any already-produced, governed source via a valid `EvidenceLocator`** (§2, §8 --
  wording corrected in the v2 delta-review to match §8's generalization; the earlier "does not exist
  anywhere in the codebase" phrasing was too narrow, since the same rule must hold for CAS
  artifacts, PostGIS schema, and signed attestations, not only source code). This is §8's terminal
  state -- the engine does not fall through to inventing the missing authority as a RED fixture.
- **`NON_REPRODUCIBLE`** -- the clean-room replay check (§7) fails: the proof package cannot be
  regenerated from its complete declared `InputManifest` (§7) -- corrected in the v3 delta-check
  from the earlier "base/candidate/tool-version inputs alone" wording, which predated §7's own
  extension to the full `InputManifest` and would otherwise leave §3 and §7 defining two different
  replay contracts.
- **`SCOPE_VIOLATION`** -- the writer touched a path outside its authorized allow-list, or attempted
  to alter proof policy, verifier authority, or its own acceptance criteria (§4).
- **`FALSIFIED`** -- the independent verifier's own adversarial probes broke the candidate. This is
  a normal, expected, *useful* terminal state, not an error condition to be suppressed -- a
  falsified candidate with a documented attack that worked is exactly the kind of evidence the
  10-point list's item 8 (attack-family accumulation) depends on.
- **`NOT_PROVEN`** (added per Jimmy's cold review, point 4; canonicalized in the v2 delta-review) --
  the verifier could not execute a mandatory probe: the test environment is missing, a required
  database is unavailable, or a tool crashed. This is distinct from both `FALSIFIED` (the probe ran
  and broke the candidate) and `NON_REPRODUCIBLE` (replay of a completed proof package failed) --
  here, the probe never completed at all, so the candidate is neither proven nor disproven. This is
  a fail-closed terminal state specifically so that a verifier's own inability to test something
  never gets silently pressed into `ACCEPT`, `FALSIFIED`, or any other semantics it did not actually
  earn. **`NOT_PROVEN` is the one canonical verdict/state name** (not the double-barrelled
  `NOT_PROVEN`/`VERIFICATION_BLOCKED` v2 wording, which risked two different implementation rounds
  inventing two different enum values for the same state) -- the specific reason is carried as
  `reasonCode: VERIFICATION_BLOCKED` (or another future reason code) on the `VerificationArtifact`
  (§2), not as a second state name.

A run that reaches none of these and instead produces a `ProofPackage` is the only path to
"proceed to owner push-go" -- matching, not replacing, this program's existing human-authorizes-
promotion rule.

## 4. Writer/verifier isolation (exact boundary)

**Writer lane receives:** the frozen design/spec for this round, the explicit allowed-paths list,
and the `RedPlanArtifact`'s RED contract (what must fail, and why). Nothing more.

**Writer lane may never:**
- Alter proof policy, the verifier's own authority, or its own acceptance criteria (a `SCOPE_
  VIOLATION` terminal state per §3 if it tries).
- Write outside its allowed-paths list.
- See or influence what the verifier lane will independently derive.

**Verifier lane receives:** the source repository, the base SHA, the candidate SHA, and the frozen
spec/`RedPlanArtifact` -- exactly the same design-level authority the writer had, not the writer's
output reasoning. **It does not initially receive the writer's own `CandidateArtifact` narrative,
rationale, or self-reported test results.** It re-derives, from source and spec alone, what needs
to be true of a correct candidate, and only then examines the actual candidate diff to check it.

This mirrors, formalized, exactly what this session did today for W4 (§ this session's own
messages to W3D): re-read `resolveCanonicalProjectContext.ts`'s real implementation directly,
re-ran RED on a freshly isolated worktree instead of trusting the reported result, grepped the real
source for the claimed `REJECT_*` strings instead of trusting the test's mock strings at face
value, and re-ran a corrected scoped-typecheck methodology after the first naive attempt gave a
misleading result. None of that depended on reading the writer's own explanation of why its work
was correct -- the same discipline this section formalizes as a hard boundary, not a habit.

## 5. Verifier must produce its own evidence (the ACCEPT bar)

Per Jimmy's explicit requirement: **"review complete" is never sufficient.** Every claim in a
`VerificationArtifact` (§2) must cite at least one of three evidence grounds in its
`evidenceGrounds[]` array (an array, not a single field -- corrected in the v2 delta-review so a
claim can legitimately carry more than one, e.g. writer-regression *plus* a verifier-owned probe):
- **Verifier-owned probes** -- the verifier's own executed tests/scripts/queries against the
  candidate, run by the verifier, not copied from or re-run-unmodified-from the writer's own test
  files (re-running the writer's literal RED/GREEN files independently, as this session did for W4,
  still counts -- what does not count is trusting their *reported exit code* without executing
  anything).
- **An explicit code derivation**, for claims where a runtime probe is not the right instrument
  (e.g. "this diff touches zero files outside `src/application/`" is proven by reading the diff,
  not by running anything).
- **Writer-test regression evidence** -- re-running the writer's own RED/GREEN files and confirming
  they still hold.

**Corrected per Jimmy's cold review (point 2):** the third ground alone is not sufficient for a
*material* security/authority invariant (`materialInvariant: true` on the claim, §2). For every such
invariant, the verifier must additionally provide either a verifier-owned probe/attack of its own or
an independent code derivation -- re-running the writer's test may serve as regression evidence on
top of that, but never as the sole ground for a material invariant. This is the depth that finds
real defects (this program's own Dev-Gov history: base-staleness dispatch failures, the F04
auto-dispatch regression, the root-run writability probe denial -- none of those would have
surfaced from re-running an already-written test unmodified). Non-material claims (e.g. "the diff
is exactly N files") may still rest on writer-test regression evidence or a direct code derivation
alone.

A `VerificationArtifact` that cannot cite which ground(s) each of its claims stands on is incomplete,
not merely weakly-worded -- this is a structural field on the artifact (§2), not a stylistic norm.

## 6. Candidate freeze before adversarial review

The `CandidateArtifact` is immutable once created: exact SHA, exact diff. The writer lane's
involvement in this round ends when this artifact is produced. If the verifier's adversarial
probes falsify the candidate (`FALSIFIED`, §3), the correct next step is a **new round** -- a new
writer invocation against the accumulated evidence (the attack that worked becomes part of the next
`RedPlanArtifact`, per the 10-point list's item 8) -- not a live edit to the same candidate while
verification is still running. Without this, writer and verifier begin co-authoring the same
artifact in real time and the independence the whole design exists to guarantee disappears exactly
the way it would if one person both wrote and cold-reviewed a design note.

## 7. Clean-room replay (the final requirement on a `ProofPackage`)

A `ProofPackage` is not accepted as final until it can be **regenerated** from nothing but its
declared inputs -- with no dependency on hidden state left over in a particular agent session (an
open worktree with manual fixups, an in-memory mock not captured in the candidate's own files, a
locally-cached dependency version not pinned anywhere). If replay from those declared inputs alone
produces a different result, the correct terminal state is `NON_REPRODUCIBLE` (§3), not a passing
proof package with an asterisk.

**Corrected per Jimmy's cold review (point 3):** "base SHA + candidate SHA/diff + tool/policy
versions" is not a sufficient input closure in general -- it works for pure repo-code targets but
breaks the moment this engine is used against PostGIS, Loke, or CAS, where the result also depends
on data the repo diff does not capture. The declared inputs must instead be a full **`InputManifest`**
(a mandatory field on `ProofPackage`, §2):
- the declared base SHA and candidate SHA/diff (as before);
- a dependency-lock hash (e.g. `package-lock.json`'s own content hash);
- content hashes for every fixture/data artifact the verification actually depended on;
- the runtime/container/toolchain identity (language/runtime version, OS, relevant tool versions);
- explicit environment configuration, with secrets excluded, not merely unmentioned;
- **added per Jimmy's v2 delta-review:** for any secret-dependent authority whose identity can
  affect the result (e.g. which signer key produced an attestation) -- a **non-secret** identifier:
  a public-key fingerprint or key id, plus a reference to the secret's provider/store. Never the
  private key material or the secret value itself. This is what lets the manifest satisfy the
  principle below for authority that happens to be secret-backed, without the manifest itself
  becoming a thing that must be handled as a secret.

The governing principle: **every input that can affect the result must be identified or
content-addressed.** A `ProofPackage` whose `InputManifest` omits an input that turns out to affect
the outcome is, by definition, not clean-room -- and should be caught by attempted replay producing
a different result, which is exactly what `NON_REPRODUCIBLE` exists to name.

## 8. Authority-discovery before RED synthesis (the hard rule)

**The canonical regression example, named explicitly by Jimmy: `mapLayerSelection.unavailable`.**
Today's own real sequence: a design brief assumed an authoritative "layer is incomplete" signal
existed in the LU chain because analytically-accurate prose in a demo document described one.
Investigation (this session, direct code search across `services/`, `packages/mps-lu`,
`packages/spatial-provider-postgis`) found no such signal anywhere in the codebase -- the prose was
correct as narrative, but not backed by any executable authority. Had a RED probe been written
against that assumption, it would have "proven" a fixture invented to match the prose, not a real
governed behavior -- exactly the failure mode this rule exists to prevent structurally, not just
catch by chance the way it was caught today.

**The rule, generalized:** `RedPlanArtifact` generation must consult `DependencyGraphArtifact` and
`DiscoveryArtifact` for whether the authority a candidate would assert actually exists as real,
already-produced, already-governed state. If it does not, the engine's only valid move is the
`MISSING_AUTHORITY` terminal state (§3) -- documenting the gap as a **future upstream contract
dependency**, matching exactly how today's `mapLayerSelection.unavailable` finding was frozen and
handed to Jimmy rather than built around. The engine is never permitted to synthesize a RED fixture
that asserts a signal it cannot first prove exists.

**Sharpened per Jimmy's cold review (generalization alongside the four points):** "exists" here does
not mean "exists in the codebase" specifically -- source-code presence was simply what today's
`mapLayerSelection.unavailable` example happened to require. The general test is that the authority
must be provable via a **resolvable, governed source**, cited as an `EvidenceLocator` (§2): source
code is one such source, but a CAS artifact, a signed attestation, a PostGIS schema entry, or a
prior `ProofPackage`'s own recorded invariant are equally valid grounds once this engine runs
against those other domains (§9). What stays invariant is the rule itself, not the medium: no
`RedPlanArtifact` probe may assert an authority it cannot resolve to a real governed source of any
of these kinds.

## 9. Named synergies (not built in V1, recorded so they are not lost)

- **Loke** (`source -> quarantine -> approval -> CAS -> import`) can use the same writer/verifier
  split: writer is ingestion/import, verifier tries to break provenance and reproducibility.
- **Spatial/runtime reconciliation** can reuse `DependencyGraphArtifact` construction to find
  missing relations before a migration/reconciliation run, rather than after.
- **Dev-Gov's own detectors** (Runtime Reachability, Authority Bypass, Semantic Fallback) are a
  natural shape for discovery-phase plugins in this same engine, once V1 proves the loop.
- **W4** (canonical LU projection), once PROVEN, is a strong candidate for this engine's own first
  historical training/test case -- it already required both authority reasoning (§8) and consumer
  discovery, which is exactly why Jimmy named it as a good fit. Not started now; a future decision
  once both W4 is PROVEN and V1 of this engine exists to run it against.

## 10. Q-PPE-1--3, resolved per Jimmy's independent cold review (2026-09-30)

- **Q-PPE-1 (target selection for the V1 proof run) -- resolved:** a real but small backlog item --
  not a sterile demo, and not the most valuable/complex product candidate. It must have established
  authority (a real governed source exists for it, §8) and be well-understood enough that Jimmy can
  personally judge whether the engine's own conclusions were correct. Additionally (§1): the V1
  proof run must include contract tests for the terminal states themselves, not just a happy-path
  run. Actual target selection remains a separate future decision, not made by this document.
- **Q-PPE-2 (verifier lane identity) -- resolved:** V1 requires a separate, fresh-context verifier
  session with its own role/prompt and its own separated evidence output. The same underlying model
  is acceptable for V1 -- independence does not require a different vendor/model (e.g. Claude vs.
  GPT) to count as real. What is not acceptable: two agent calls that share hidden context or state.
  Identity-level cryptographic authority separation (distinct signing identities per lane, matching
  this program's own DevGov actor/authority patterns) is a real future hardening step, not required
  for V1.
- **Q-PPE-3 (where V1 actually runs) -- resolved:** the Workflow tool is a reasonable first
  orchestrator, but the engine's architecture must not be bound to `agent()`/`pipeline()`/`phase()`
  as though those primitives were the authority contract itself. The state machine (§3's terminal
  states plus the loop in §1) and the artifact protocol (§2) must be designed independently of any
  specific orchestrator; Workflow becomes the *first orchestrator adapter* implementing that
  protocol, not the protocol's definition. Building that adapter is still implementation, not part
  of this design, and still requires Jimmy's own explicit opt-in in his own words when the time
  comes, separately from approving this design.

## 11. Non-claims

This document does not claim to have selected V1's actual target (§10, Q-PPE-1 narrows the
selection criteria but does not name a target), written any workflow script or orchestrator
adapter, or defined full JSON Schema for any artifact in §2 (mandatory semantic fields are frozen;
wire format is not). Its approval is not this session's own -- v1 received `ACCEPT_WITH_CHANGES`
from Jimmy's independent cold review, v2 `ACCEPT_WITH_MINOR_CHANGES` from his delta-review (two
must-fix inconsistencies, two recommended hardenings, one wording tightening), v3 two remaining
stale formulations from his final surgical check, and v4 (this document) `ACCEPT / FROZEN` -- no
further cold review expected. It does not claim the named synergies in §9 are scoped, sized, or
scheduled -- they are recorded so the ideas are not lost, nothing more. It does not claim the next
decision point (RED-only/design of the V1 implementation itself, and selection of the small real
backlog target, §10 Q-PPE-1) has started -- that remains a separate decision, not something this
session proceeds to on its own initiative.
