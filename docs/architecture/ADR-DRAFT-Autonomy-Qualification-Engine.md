# ADR (DRAFT) — Autonomy Qualification Engine (Section D)

## Status

**DRAFT / PROPOSED — NOT ADOPTED.** Committed per the same rule this repo already applies to
`ADR-DRAFT-Source-Registry-Pipeline.md`: a document that shapes future authority must not sit
uncommitted, claiming provisional weight it hasn't earned (see the C24 finding in the Section C
conflict matrix — an uncommitted document asserting "Frysta" invariants is exactly the anti-pattern
this ADR must not reproduce). Committing this draft is not adoption. It requires explicit owner
sign-off before any of it governs a real decision.

```
SECTION D:                    DESIGN_MATURE
IMPLEMENTATION:                NONE
PROOF_STATUS:                  NEVER_CLAIMED
RUNTIME ENFORCEMENT:           NOT IMPLEMENTED
AUTONOMY AUTHORIZATION:        NONE GRANTED BY SECTION D
```

**No capability in this repository may currently be labeled GA-L3, GA-L4, or GA-L5 on the basis of
this document.** The model exists at design level only. Qualification proof and runtime enforcement
do not exist yet.

## Context

Section A (Document Authority Map) and Section B (Product/Feature Truth Matrix) established, with
executed evidence, what documentation claims, what code exists, what runs, and what's reachable.
Section C (Conflict Matrix) classified where those things disagree — 26 conflicts across eight
categories: `AUTHORITY_CONFLICT`, `SCOPE_DRIFT`, `RUNTIME_DRIFT`, `DOCUMENTATION_DRIFT`,
`EXPOSURE_GAP`, `CURRENT_PRODUCT_DEFECT`, `PROOF_GAP`, `NOT_PROVEN`.

Section D answers a different question than A–C: not "what is true," but **"what may a system be
authorized to do autonomously, given what A–C already established is true."** It must inherit the
same proof discipline the rest of this program has been built on — most importantly, the distinction
established for LU (`docs/architecture/ADR-LEGAL-CORPUS-IMPORT-GATE.md`, and the Section B
`PROVEN`/`NEVER_CLAIMED`/`INVALIDATED` taxonomy) that **a proof claim is bound to an exact subject
at an exact point, and is never silently extended, generalized, or re-used past that binding.**

## Architectural Decision

### 1. Two-phase separation

Qualification (can this exact subject/configuration ever participate in autonomous execution, and
at what maximum ceilings) is architecturally separate from authorization (may this exact material
action execute right now). Conflating them was rejected: a system that re-derives eligibility at
every action call either re-runs expensive qualification work per-call, or — worse — is tempted to
skip it and trust a stale belief about eligibility. Splitting them forces qualification to produce a
durable, inspectable artifact, and forces runtime to independently re-verify it every time, exactly
as `GovernedAssessmentPersistence.persist()` already does for assessment artifacts: *"A caller may
present an artifact, but cannot declare its truth."*

```
PHASE 1 — BUILD/DEPLOY QUALIFICATION

Purpose:   establish whether an exact subject/configuration is eligible to participate
           in autonomous execution, and register its maximum verified ceilings.

Output:    qualification_status
           qualified_authority_ceiling
           qualified_evidence_ceiling
           qualified_runtime_ceiling
           qualified_action_ceiling

Never outputs: effective_level
```

```
PHASE 2 — RUNTIME QUALIFICATION

Purpose:   authorize or deny each material operation using current state.

Output:    effective_level   (transient / derived only, never persisted as a grant)
           or
           DENY
```

### 2. DENY-before-MIN semantics

Absolute invalidity predicates are evaluated first and unconditionally block the action. Only if
none apply does the system compute `effective_level` as a minimum over independently-scored
ceilings. This preserves a distinction the rest of this repository has repeatedly needed and
repeatedly gotten wrong when it was missing: **"insufficient knowledge" (`NOT_PROVEN`) is not the
same claim as "known to be false" (`INVALIDATED`)**, and folding either into a numeric ceiling erases
that distinction — a `MIN()` term of zero looks identical whether the underlying reason was "we
never checked" or "we checked and it failed."

```
DENY IF ANY:
    authority_revoked
    qualification_expired
    proof_invalidated
    subject_binding_invalid
    profile_invalid
    prohibited_action
    qualification_status == NOT_QUALIFIED
    required_runtime_precondition_missing

ELSE:
    effective_level =
        MIN(
            qualified_authority_ceiling,  current_authority_ceiling,
            qualified_evidence_ceiling,   current_evidence_ceiling,
            qualified_runtime_ceiling,    current_runtime_ceiling,
            qualified_action_ceiling,     current_action_ceiling
        )
```

A revoked authority does not degrade to `L0` — it produces `DENY`. An invalidated proof does not
degrade the evidence ceiling to zero — it produces `DENY`. `L0` remains a valid, present,
actionable state; `DENY` is not a level, and the two must never be interchangeable in behavior or in
how a caller interprets the response.

### 3. Qualified ceilings vs. current ceilings, and the ratchet invariant

Each of the four dimensions (authority, evidence, runtime, action) has two values: the ceiling
*Phase 1 proved was ever justified* (`qualified_*`), and the ceiling *runtime observes right now*
(`current_*`). The invariant:

```
current_effective_ceiling  <=  qualified_ceiling
```

holds unconditionally, in both directions of asymmetry:

```
runtime MAY move:      L4 -> L3,  L4 -> L1,  L4 -> DENY
runtime MAY NEVER move: qualified L3 -> runtime L4
```

No runtime observation, however favorable, may exceed what qualification already proved. This is
what makes the GA-N6 revocation/requalification asymmetry mechanical rather than a special case:

```
authority revoked
    -> ACTIVE Lx -> SUSPENDED / DENY               (immediate, runtime-only)

renewed external authority
    -> requalification
    -> new qualified ceiling
    -> runtime may derive a level again             (never a direct jump back to Lx)
```

Restoration is never a runtime act. It re-enters at Phase 1.

### 4. Predicates as machine-checkable contracts

Every DENY predicate and ceiling input is defined here as a checkable boolean derived from a named
source — not prose. This table is normative; an implementation that cannot point to the exact source
of one of these booleans does not satisfy this ADR.

| Predicate | Definition |
|---|---|
| `subject_binding_valid` | `qualification.subject_hash == hash(current_exact_subject_configuration)` |
| `qualification_not_expired` | `now < expires_at` (see §5 — `expires_at` is canonical, not observational) |
| `authority_valid` | `authority_grant_ref` resolves **AND** grant is active **AND** not revoked **AND** subject/action fall within the grant's declared scope |
| `proof_valid` | every required `proof_ref` resolves **AND** no required `proof_ref` carries status `INVALIDATED` **AND** each proof's own subject binding matches the current subject |
| `profile_valid` | qualification artifact's canonical hash re-verifies **AND** `policy_ref` resolves and is current **AND** `qualification_status == QUALIFIED` **AND** exact subject/config binding holds |
| `prohibited_action` | the requested action appears on the current policy's explicit prohibition list for this subject/scope — independent of any ceiling, always absolute |
| `required_runtime_precondition_missing` | a precondition the policy declares mandatory for this action class (e.g. a required current health/reachability check) did not resolve to true at call time |

`authority_revoked`, `qualification_expired`, `proof_invalidated`, `subject_binding_invalid`,
`profile_invalid` in the DENY list are the negations of `authority_valid`, `qualification_not_expired`,
`proof_valid` (invalidated-specific case), `subject_binding_valid`, `profile_valid` respectively.

### 5. Canonical qualification artifact

Qualification is bound to a durable, hash-identified artifact — never a set of loose fields. This
follows the same discipline every other artifact family in this repository already uses (content
canonicalization → `sha256ContentHash` → `artifact_id`), and explicitly separates identity-bearing
fields from observational metadata, per the repo's existing rule
(`mps-core/src/types.ts`: *"Timestamps SHALL NOT participate in canonical identity, hashing, signing,
or replay equality"*) — with one deliberate, explicitly-decided exception.

```
CANONICAL QUALIFICATION BODY (hash-bound identity)

qualification_id
subject_ref
subject_hash
configuration_ref
policy_ref
authority_grant_ref
qualification_status
qualified_authority_ceiling
qualified_evidence_ceiling
qualified_runtime_ceiling
qualified_action_ceiling
proof_refs
conflict_refs
qualification_policy_version
expires_at
```

```
NON-IDENTITY / OPERATIONAL METADATA (excluded from the canonical hash)

qualified_at
observed_at
display metadata
runtime evaluation timestamps
qualifier_identity            (attested separately — a signer identity, not content identity)
```

**Explicit decision on `expires_at`:** it is canonical, not observational — the one deliberate
exception to the general timestamp-exclusion rule. `qualified_at` records *when* a claim was issued
and carries no semantic weight of its own; two qualification runs issued a minute apart with
identical ceilings are the same claim. `expires_at`, by contrast, is a substantive term of the grant
itself — two otherwise-identical qualifications with different validity windows are materially
different claims about how long the ceiling may be relied on, not the same claim observed at
different times. Excluding it from the hash would let an artifact's validity window be silently
altered without changing its identity, which is exactly the kind of drift this ADR exists to
prevent. `qualifier_identity` is attested (signed) separately from the content hash, the same
pattern this repo already uses for `outcome_attestation_ref` and `signer_key_id` elsewhere — content
identity and the identity of who attested it are deliberately different bindings.

**`qualified_authority_ceiling` is a verified ceiling derived from external authority. It does not
create, extend, or replace that authority.** Runtime must still independently resolve authority per
GA-N1/GA-N4 — the qualification artifact is a verified *claim about* a grant, never the grant itself.

The four `qualified_*` fields keep a uniform `qualified_` prefix rather than special-casing
authority's field name — the "this doesn't grant authority" risk is addressed by the invariant
statement above and by the artifact's own re-verification requirement, not by inconsistent naming.

### 6. Section C conflict → qualification consequence mapping

Normative default mapping from a Section C conflict category to its consequence in Phase 1. A
specific conflict may be more severe than its category's default (judgment applied per-conflict at
qualification time), never less.

| Section C category | Default qualification consequence |
|---|---|
| `AUTHORITY_CONFLICT` | `NOT_QUALIFIED` above a safe baseline; frequently `DENY` for any material action |
| `RUNTIME_DRIFT` | caps `qualified_runtime_ceiling`, or `DENY` if the drift is itself unresolved at call time |
| `SCOPE_DRIFT` | caps `qualified_action_ceiling` — no autonomous action outside explicitly-established scope |
| `PROOF_GAP` | caps `qualified_evidence_ceiling` |
| `CURRENT_PRODUCT_DEFECT` | `NOT_QUALIFIED` for the affected capability/path specifically |
| `EXPOSURE_GAP` | normally imposes no ceiling by itself — exposure is a product-surface concern, not an autonomy-safety concern, unless the specific gap conceals a safety-relevant signal from an operator |
| `NOT_PROVEN` | `NOT_QUALIFIED` wherever the unresolved conflict is material to the qualification decision |
| `DOCUMENTATION_DRIFT` (resolved or unresolved, non-normative) | no ceiling by default; provenance retained |
| resolved conflict (any category) | no active constraint; provenance retained on the artifact via `conflict_refs` |

### 7. Runtime enforcement boundary

None of the above is implemented. No code in this repository currently computes `effective_level`,
issues an `AutonomyQualificationArtifact`, or enforces any DENY predicate defined here. Any future
implementation must itself earn `PROVEN` status under this repo's existing rule — *"PROVEN is a
RESULT, not a document label"* — via an actually-executed, actually-green test exercising the real
production path, registered in `architecture-authority-map.jsonc` like every other proven
capability in this repository.

## What this ADR does not do

- Does not grant any capability GA-L3/L4/L5.
- Does not create runtime enforcement.
- Does not resolve any of the 26 conflicts in the Section C matrix — it defines how future
  qualification tooling *would* consume them, once built.
- Does not itself constitute the external authority `authority_grant_ref` would point to — that
  authority source is out of scope for this document and must be established separately.

## Required before adoption (owner sign-off)

1. Confirm the two-phase architecture and DENY-before-MIN ordering (§1–2).
2. Confirm the ratchet invariant and revocation/requalification asymmetry (§3).
3. Confirm or amend the predicate table (§4) — implementation cannot proceed against an
   unconfirmed contract.
4. Confirm the canonical-body/metadata split and the `expires_at` decision (§5).
5. Confirm or amend the Section C mapping table (§6).
6. Name the actual external authority source `authority_grant_ref` will resolve against — not
   defined by this ADR.
