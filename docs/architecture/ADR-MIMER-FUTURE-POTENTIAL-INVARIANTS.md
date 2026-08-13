# ADR — Mimer Future-Potential Invariants

| Field | Value |
| --- | --- |
| **Status** | **FROZEN** — reviewed 2026-08-11; invariant-count inconsistency, five scope-sharpening fixes, and one stale cross-reference corrected before freeze |
| **Date** | 2026-08-11 |
| **Owner** | MPS Architecture Governance |
| **Purpose** | Reserve the architectural degrees of freedom Mimer will need in 1–3 years, without building any of it now |
| **Relationship to `ADR-MPS-CONSTITUTIONAL-INVARIANTS.md`** | That ADR freezes what Mimer's identity/hash/lineage/retrieval layers already **are**. This ADR freezes what today's implementation must **not foreclose** for capabilities that don't exist yet. Where the two overlap (temporal semantics touching canonical hashing, schema versioning touching canonical version namespaces), the constitutional ADR wins — this document adds constraints, it does not loosen any. |

## 0. Why this document exists, and why it's small

Mimer's core already has an unusually strong foundation — immutable artifacts, content hashing, provenance, replay, governance/authority separation. The risk at this stage is not "missing features," it's **cheap-now-expensive-later architectural lock-in**: a field, a type shape, or a hardcoded assumption that's trivial to generalize today and requires a breaking migration in two years.

This ADR does **not** authorize building any of the 15 forward-looking capabilities discussed in the originating design conversation (temporal query engine, evidence graph traversal, uncertainty decomposition, outcome tracking, controlled evolution, archival export pipeline, multi-tenant boundary, etc.). Building those now would be premature and is explicitly out of scope — see §10. What this ADR does is name **9 invariants** (FUTURE-I01–FUTURE-I09) that today's implementation work (in mps-chunking, mps-text-projection, mps-lu, mps-governance, mps-decision-governance, and anything touching mps-core) must keep true, so that none of those 15 doors get quietly welded shut by an unrelated feature PR.

Each invariant below is graded against the actual codebase as of this date (not aspirationally) — audited by reading the real type definitions and implementations, not inferred from naming. Grades: **STRONG** (the seam already exists and is load-bearing), **PARTIAL** (the seam exists in some form but is incomplete, inconsistent across packages, or documented-but-unimplemented), **NONE** (no seam yet). A PARTIAL or NONE grade is not a defect to fix immediately — it is the current baseline the freeze rule protects going forward.

---

## 1. FUTURE-I01 — Temporal semantics must stay pluggable, not collapse onto `created_at`

**Current grade: PARTIAL.** `mps-core/src/types.ts`'s `Timestamp` type is explicitly documented as provenance-only and forbidden from participating in canonical identity/hashing/replay equality (`IMPORT-TIME-001`, `SV-I06`) — this is actually the *right* starting constraint, not a gap. But there is no shared temporal vocabulary above it: `mps-lu` uses `observed_at`/`document_date`/`effective_from`/`effective_to`, `mps-decision-governance` uses `period_start`/`period_end`/`created_at`, each package inventing its own subset of "when did this matter" independently.

**Freeze rule:** New temporal fields introduced by any package MUST NOT be given ad hoc names that collide in meaning with `observed_at`/`effective_from`/`period_start` etc. from another package without checking whether they're the same concept. Nothing may be built that makes it structurally impossible to later ask "what did the system consider true at time X" — e.g., no artifact may overwrite a prior value's temporal validity in place; a superseding value must be a new artifact version, not a mutation (this is already how CAS/immutability works — the rule is: don't special-case an exception to it for time-varying fields).

This ADR does not introduce temporal types now, but any new time-related field MUST declare, at minimum in its doc comment, which of at least three distinct temporal dimensions it represents:

- **OBSERVATION_TIME** — when Mimer (or its source) observed/recorded the fact (`observed_at`, `retrieved_at` fall here)
- **VALID_TIME** — when the fact was/is true or in effect in the world, independent of when anyone recorded it (`effective_from`/`effective_to`, `document_date`, `period_start`/`period_end` fall here)
- **SYSTEM_TIME** (a.k.a. record time) — when the artifact itself was created/superseded in Mimer's own storage (`created_at` and equivalents fall here; per `Timestamp`'s existing doc comment, this dimension already correctly stays out of canonical identity/hashing)

A field that doesn't fit cleanly into one of these three is a signal a fourth dimension may be needed — that's fine, but it must be named and declared, not left implicit. This is cheap to require now and expensive to retrofit once a dozen packages have silently mixed observation-time and valid-time under fields that merely sound similar.

## 2. FUTURE-I02 — Observation, interpretation, and decision must stay distinguishable, even where not yet a typed union

**Current grade: PARTIAL, intentional.** `ADR-29-Intelligence-Projection-Boundary.md` (`MIMER-SCALE-I01`) and `ADR-MPS-CORE-001.md` §5.1's Category A/B/C split already state this rule in prose; `mps-lu`'s `EvidenceRAGService` enforces a working version of it at runtime (`analyzeEntailment`/`verifyGrounding` reject ungrounded LLM claims). What's missing is a shared, closed type-level discriminant in `mps-core` itself — the rule currently lives in ADRs and per-package convention, not in a type the compiler enforces.

**Freeze rule:** No new artifact type may collapse this distinction at the type level — e.g., no `Finding`-like type may reuse the same shape as a raw `Observation`/`Evidence` type such that a model output could be stored and later read back indistinguishably from a directly-observed fact. A model/LLM output MUST be structurally tagged as derived (even informally, e.g. a `derivation` or `source_kind` field) wherever it's persisted, so a future formal `OBSERVATION | INTERPRETATION | DECISION` union can be introduced as a refinement, not a rewrite.

## 3. FUTURE-I03 — Evidence relations must accumulate toward one graph, not multiply into disconnected vocabularies

**Current grade: PARTIAL.** Two independent typed-relation vocabularies already exist and don't talk to each other: `EvidenceChunker`'s `supports_permit`/`controlled_by`/`monitors_condition`/etc. (produced, never read downstream — write-only today) and `mps-lu`'s `LegalEvidence.relation: SUPPORTED | CONTRADICTED | INSUFFICIENT` (actively used to gate LLM answers). `mps-artifact-store`'s `LineageGraph` (the natural home for a real graph) is a stub — every method returns `[]`.

**Freeze rule:** The principle to protect is **one extensible relation model, not one prematurely frozen enum**. `mps-lu`'s `SUPPORTED | CONTRADICTED | INSUFFICIENT` is today's most-used vocabulary and a reasonable default to reach for, but it MUST NOT be treated as the future graph ontology by default — note in particular that `INSUFFICIENT` is arguably not a relation between two nodes at all but an epistemic state of a single claim ("not enough evidence"), which is exactly the kind of category error a future formal graph schema needs to be free to fix. What's actually frozen here: do not introduce a third, incompatible relation vocabulary for a new feature without either reusing an existing one or explicitly flagging in your own ADR that you're adding a second vocabulary and why. Do not implement a real graph store (`LineageGraph`'s eventual implementation) in a way that hardcodes today's two-vocabulary split — or `mps-lu`'s specific enum — as permanent; it should be able to absorb a redesigned relation/state model without a rewrite of callers.

## 4. FUTURE-I04 — Execution identity (executor/model/rule/version) must generalize from `mps-evolution`'s pattern, not be reinvented per call site

**Current grade: PARTIAL — strong precedent exists, inconsistently applied.** `mps-evolution`'s `MutatedCodeArtifact.mutation_metadata` (model, model_version, model_digest, temperature, prompt_hash, ...) is a genuinely good, rich executor-identity record. `mps-runtime`'s `FrozenCapabilityExecutionArtifact` captures inputs/outputs/hash but not executor version/config/environment/determinism class. `mps-lu`'s actual RAG/LLM calls (`EvidenceRAGService`) capture no execution identity at all today.

**Freeze rule:** Any new code path that invokes a rule, a spatial algorithm, a statistical model, or an LLM/agent and produces output that becomes part of governed evidence or a decision MUST record at minimum: what ran (identity + version), and MUST NOT be wired in a way that makes it structurally impossible to later add config/environment/determinism-class capture without changing the call site's contract. Concretely: don't hardcode "LLM call → plain string result" as the persisted shape anywhere new; wrap it in a record with at least an identity/version field, even if minimal today.

Execution identity is not one field. This ADR reserves (without requiring all of them populated today) five distinct concepts that a future full `ExecutionArtifact` will need to keep separate: **executor identity** (which system/model/rule ran — e.g. "claude-opus", "PostGIS ST_Distance", a specific rule id), **executor version** (which version of that executor), **configuration identity** (temperature/top_p/prompt/parameters — the specific invocation shape, distinct from the executor's own version), **environment/fingerprint** (runtime environment the execution happened in), and **determinism class** (whether replaying this execution is expected to be byte-identical, statistically-equivalent, or non-reproducible). The freeze rule: don't collapse two or more of these into a single `model_version`-style field anywhere new, even informally — that's the exact shortcut `mps-evolution`'s richer `mutation_metadata` already avoided, and re-collapsing it elsewhere reintroduces the same semantic debt this invariant exists to prevent.

## 5. FUTURE-I05 — Schema evolution must stay additive-projection, and the two documented patterns must not silently diverge further

**Current grade: PARTIAL, with an internal inconsistency to flag rather than resolve here.** `mimers-brunn-core`'s `SchemaMigrationRegistry` and `mps-text-projection`'s `TextProjection` both implement "old version stays immutable, new version is an explicit, registered, fail-closed migration/projection" — this is the correct pattern and is real, working code. Separately, `ADR-MPS-CORE-001.md` §10 documents a different model (new canonical serialization + new hash + new signature, old signatures not reused) for artifact migration generally. `mps-core`'s actual `CanonicalArtifact` type has no `schema_version` field at all, despite `SchemaReference` existing as a standalone, unused-on-the-base-type concept.

**Freeze rule:** Do not add a third schema-evolution pattern. New packages needing versioned artifacts should follow the `mimers-brunn-core`/`mps-text-projection` additive-projection pattern (old version's bytes and identity are permanently readable; a new version is a new, explicitly-registered artifact, never an in-place overwrite).

> **OPEN-FUTURE-01 — Canonical artifact schema evolution semantics (unresolved).** There are currently two documented, unreconciled patterns for how an artifact's schema may evolve: (a) the additive-projection pattern above (old version stays, new version is a separate registered artifact), real and working in `mimers-brunn-core`/`mps-text-projection`; (b) `ADR-MPS-CORE-001.md` §10's re-signing model (new canonical serialization + new hash + new signature per migration, old signatures not reused), documented at the constitutional level but not implemented as such in `mps-core` — which also lacks a `schema_version` field on `CanonicalArtifact` entirely, despite `SchemaReference` existing unused for that purpose. This ADR does not resolve which pattern (or what reconciliation of the two) is correct for `mps-core` generally. It is named here as an explicit open item so it is decided deliberately, by a future ADR, rather than by whichever package needs schema versioning next.

## 6. FUTURE-I06 — Cryptographic agility's type-level design must not get hardcoded away at the implementation layer

**Current grade: STRONG at the type/interface level, PARTIAL in implementation coverage.** `HashDescriptor`/`SignatureDescriptor` in `mps-core` are already algorithm-open (`algorithm: string`, not an enum), and `mimers-brunn-core/src/serialization/algorithms.ts` already reserves `blake3` and declares `ECDSA_P256_SHA256`/`RSA_PSS_SHA256` as first-class signature algorithms — ahead of most systems at this stage. The gap is that only SHA-256/512 hashing and Ed25519 signing are actually implemented (`NodeHashProvider`, `LocalPemSigningKeyProvider`).

**Freeze rule:** This one is close to done — the main obligation is negative: no new code may check `algorithm === "sha256"` or `algorithm === "Ed25519"` as a hardcoded assumption outside the `HashProvider`/`SigningKeyProvider` implementations themselves. Any code consuming a `HashDescriptor`/`SignatureDescriptor` must treat `algorithm` as opaque/dispatchable, not as a known constant. Adding the second concrete provider (a KMS-backed one, or `blake3`) is a good next step but is explicitly not required by this ADR.

## 7. FUTURE-I07 — No canonical artifact family may require the original Mimer runtime to be identified and interpreted

**Current grade: PARTIAL leaning NONE.** `ArtifactExporter`/`ProjectionExporter` and `LineageGraph` exist as interfaces but are unimplemented stubs (`export()` returns `{}`; lineage methods return `[]`). The one genuinely working self-describing format — `MimersBrunnManifest`'s versioned-media-type + `CASDescriptor` pattern in `mimers-brunn-core` — is scoped narrowly to pipeline/policy/runtime/metrics sealing, not general artifact export.

**Freeze rule (strengthened on review):** the invariant is not "keep the `ArtifactExporter` interface alive" — an interface can exist and still be worthless if the artifacts behind it are runtime-dependent to interpret. The actual rule: **no canonical artifact family may be designed such that its stored representation can only be identified and interpreted by running Mimer's own code.** Concretely: don't delete, narrow, or bypass the `ArtifactExporter` contract to route around its current stub — if something needs export functionality now, implement `ProjectionExporter.export()` for real rather than adding a parallel one-off export path elsewhere. New artifact types should remain describable using `MimersBrunnManifest`'s pattern (content + hash + media-type-as-schema-version) in principle, even if no exporter is wired for them yet — avoid opaque binary blobs, proprietary in-memory-only structures, or any format whose only decoder lives inside a running Mimer process, even for artifacts that aren't exported yet. Preserving the *interface* is necessary but not sufficient; preserving *interpretability without the runtime* is the actual freeze target, and is directly load-bearing for the archival-export gap analysis (see companion document).

## 8. FUTURE-I08 — Human review must stay a distinct artifact from whatever it reviews, even before a `RecommendationArtifact` type exists

**Current grade: PARTIAL.** `GovernanceReviewArtifact` (reviewer + `GovernanceDecision: APPROVE|REJECT|REQUEST_CHANGES` + comments + `subject_ref`) is real and structurally separate from what it reviews. `ADR-26-22-HumanInterface.md`'s `GOVERNANCE-22.9-I13` ("Observation Cannot Become Authority") is a strong, frozen, directly-relevant invariant already. What's missing: no `RecommendationArtifact` type exists anywhere, so there's no explicit typed link from "this specific AI output" to "this specific human review of it," and no `MODIFIED` outcome state (only approve/reject/request-changes).

**Freeze rule:** Do not build a review/approval flow for any new AI-assisted feature that lets a human's acceptance of a model output silently become indistinguishable from the model output itself, or from an authoritative fact. `GOVERNANCE-22.9-I13` already forbids this in the audit-viewing case; treat it as the general rule. When a new feature needs "human approved this AI suggestion," reuse `GovernanceReviewArtifact`'s reviewer+decision+subject_ref+comments shape rather than inventing a parallel approval concept, so a future `RecommendationArtifact` + `MODIFIED` state can be introduced as an extension of one pattern instead of a reconciliation of several.

## 9. FUTURE-I09 — Domain vocabulary stays out of `mps-core`

**Current grade: NONE (confirmed clean — this is good).** A repo-wide audit found zero domain terms (`fastighet`, `Natura 2000`, `förorening`, `lokalisering`, `vatten`) anywhere in `mps-core`. `ArtifactType` is deliberately left as an open `string` rather than a closed enum of every domain's artifact kinds, specifically so core doesn't need to know about domains to exist.

**Freeze rule — the one this document's author considers most important:** `packages/mps-core` MUST NOT gain a dependency on, import from, or define types named after `mps-lu` domain concepts (property, permit, watercourse, protected-area designation, etc.), now or for any future domain (medical, insurance, industrial). If a future domain needs a new concept, it is added in that domain's package, not in core. One narrower flag from the audit: `mps-decision-governance` (a platform-adjacent governance package, not `mps-lu` itself) already has a `DecisionType` enum containing `WASTEWATER | BUILDING_PERMIT | ENVIRONMENTAL_PERMIT | PLANNING_DECISION`. That's outside `mps-core` so it doesn't violate this invariant, but it's worth a deliberate decision (not addressed here) about whether `mps-decision-governance` should also be domain-blind, or whether "governance-of-a-domain-list" is an acceptable place for that vocabulary to live.

---

## 10. What this ADR does not do

Per the design discussion that produced this ADR: no implementation work is authorized by this document. Explicitly out of scope here (grouped by the originating conversation's own SNART/SENARE tiers):

- Uncertainty decomposition beyond a single confidence score
- Contradictory-evidence-aware reasoning
- `OutcomeArtifact` / `EvaluationArtifact` / outcome tracking
- Differential replay, controlled evolution, autonomous candidate generation
- Capability-based dispatch generalized beyond what already exists spatially
- Privacy/classification/access-policy fields on artifacts
- Multi-tenant/sovereignty boundary
- Archival export pipeline (RA-FS/FGS/SIP/SIARD) — tracked separately, see companion gap-analysis document

These remain real future priorities. This ADR's only job is to make sure none of the 9 invariants above get accidentally closed off while other work proceeds.

## 11. Rule of change

Same discipline as `ADR-MPS-CONSTITUTIONAL-INVARIANTS.md` §0: a PR that would make any FUTURE-I01–I09 grade regress (PARTIAL → NONE, or STRONG → PARTIAL/NONE) requires updating this ADR explicitly, with the tradeoff stated, not a silent regression discovered later. A PR that improves a grade (NONE → PARTIAL, PARTIAL → STRONG) is welcome and should update the grade + evidence in the relevant section above.

## 12. Review history

**2026-08-11 — pre-freeze review.** Assessment: architecture direction STRONG, scope discipline STRONG, future-option preservation STRONG, internal consistency NEEDS_SMALL_FIX (8-vs-9 invariant count drift in §0/§10), freeze readiness ALMOST_READY.

Six substantive corrections were applied before FROZEN status was set:

1. Invariant count corrected 8 → 9 (§0, §10) — the document defines FUTURE-I01 through FUTURE-I09, not eight.
2. FUTURE-I01 now requires new temporal fields to declare which of OBSERVATION_TIME/VALID_TIME/SYSTEM_TIME they represent.
3. FUTURE-I03 reframed around "one extensible relation model, not one prematurely frozen enum" rather than normatively pointing at `mps-lu`'s specific enum, and flags `INSUFFICIENT` as likely a category error (an epistemic state, not a relation) worth revisiting.
4. FUTURE-I04 now explicitly reserves five separate execution-identity concepts (executor identity, executor version, configuration identity, environment/fingerprint, determinism class) so they don't get collapsed into one `model_version`-style field later.
5. FUTURE-I05's schema-evolution conflict is now named as an explicit open item, `OPEN-FUTURE-01`, rather than left implicit in body text.
6. FUTURE-I07's freeze rule was strengthened from "keep the exporter interface alive" to "no artifact family may require the original Mimer runtime to be identified and interpreted" — interpretability, not just interface preservation.

Additionally: a stale `§9` cross-reference in §0 (which should have pointed at §10, "What this ADR does not do") was corrected.

FUTURE-I02, I04, I05, I06, I08, and I09 were confirmed as the six invariants judged most load-bearing for Mimer's long-term identity and were kept substantively as drafted.

## Related

- `docs/architecture/ADR-MPS-CONSTITUTIONAL-INVARIANTS.md` — frozen identity/hash/lineage/retrieval layers (this ADR's counterpart for what already exists)
- `docs/architecture/ADR-29-Intelligence-Projection-Boundary.md` — MIMER-SCALE-I01, referenced in §2
- `docs/architecture/ADR-MPS-CORE-001.md` — Category A/B/C split (§2), migration constitution (§5)
- `docs/architecture/ADR-26-22-HumanInterface.md` — GOVERNANCE-22.9-I13, referenced in §8
- `docs/architecture/ADR-CHUNKING-Subsystem.md`, `ADR-TEXT-PROJECTION.md` — the additive-projection schema pattern referenced in §5
