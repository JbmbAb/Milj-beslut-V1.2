# AI-GOVERNANCE-AND-HUMAN-AUTHORITY-01

> ```
> Document class:                    AUTHORITY / NORMATIVE MAPPING
> Status:                            FROZEN mapping, NOT a compliance claim
> Track:                             separate governance authority, non-blocking
>                                     to REPRODUCIBLE-CHECKPOINT-V1 (no RC dependency)
> Normative sources:                 Digg/IMY "Riktlinjer för generativ AI"
>                                     (https://www.digg.se/ai-for-offentlig-forvaltning/riktlinjer-for-generativ-ai),
>                                     jointly issued by Digg and IMY
>                                     (Integritetsskyddsmyndigheten). AI Act and
>                                     GDPR are referenced only where a specific
>                                     Digg/IMY sub-page invokes them directly.
> ```

## Explicit non-claim

**This document does not assert that Mimer is compliant with the Digg/IMY
guidelines, the AI Act, or GDPR.** It is a first-version mapping from named
guideline principles to architectural invariants already present, partially
present, or absent in this codebase. Every mapped row ends in one of three
states — `IMPLEMENTED` (proof exists and is named), `PARTIAL` (mechanism
exists, proof/coverage is incomplete), or `GAP` (no mechanism yet) — and no
row may claim `IMPLEMENTED` without a proof reference a reader can run.

## 1. Scope and normative sources

The Digg/IMY hub (fetched and spot-checked before this document was written,
not transcribed from summary alone) organizes guidance into eight areas:
leadership/accountability (AI policy, human oversight), GDPR (eight
sub-guidelines), labor law, procurement, information security, copyright,
ethics, and specialized topics (public-facing / integrated AI systems). This
document addresses the five areas most load-bearing for an evidence-and-
governance platform: human decision authority, provenance/disclosure,
information classification, personal-data processing boundary, and
lifecycle/auditability. Labor law, procurement, and copyright are out of
scope here — they govern organizational process, not this system's
architecture.

---

## 2. Human decision authority

**Digg principle** (verified against
`beslut-med-stod-av-generativ-ai-bor-ha-mansklig-kontroll`): human control is
mandatory for AI-assisted decisions. AI must not independently make decisions
that directly affect people or businesses. Decisions must be "possible to
explain in their entirety." AI outputs may contain fabrications or bias, so
organizations must retain the internal capability to review them.

**Mimer invariant:**

```
AI MAY:      observe, retrieve, classify, analyze, recommend, draft,
             assemble evidence

AI MUST NOT: become the legal decision authority

FINAL DECISION AUTHORITY = an explicitly identified, authorized human actor,
recorded as an ActorReference with a governance-meaningful role — not a
generic "user" — on the artifact that constitutes the decision.
```

**Current implementation:**

| Mechanism | File | State |
|---|---|---|
| `ActorReference` (actor identity carried on governance artifacts) | `packages/mps-core/src/types.ts:58` | IMPLEMENTED |
| Import requires an actor with role `GOVERNANCE_REVIEWER`, checked defensively, absence treated as no authorization | `packages/mps-data-governance/src/ImportGate.ts` (Commit `66d9e0d`, this session) | IMPLEMENTED |
| Cryptographic promotion attestation binds `approver_actor_id` + `approver_role` to a signed record | `packages/mimers-brunn-core` (`createArtifactAttestation`, ADR-042 Level 2), proofed by `tests/unit/mimers/quarantinePromotionAttestation.test.ts` | IMPLEMENTED |
| Source Registry entries carry a full `approval_attestation` (Ed25519-signed, `approver_role: GOVERNANCE_REVIEWER`) before a source may be harvested | `source-registry/national-registry.json` (verified this session during RC4) | IMPLEMENTED |

**Gap:** no artifact type in this codebase is yet explicitly named or typed as
a *legal/administrative decision subject to this rule* (e.g. a permit
determination). The mechanisms above govern *governance actions on data*
(import, promotion, source approval), not yet an end-user-facing decision
artifact. Whether Mimer produces such decisions directly, or only decision
*support* consumed by a human caseworker outside this system, is unresolved
here and should be answered before this row can move past `PARTIAL`.

**State: PARTIAL.**

---

## 3. AI provenance and disclosure

**Digg principle** (from the AI-policy hub page and the human-oversight
page): AI itself bears no responsibility — organizational/human
accountability is what remains. AI use in external-facing services should be
transparent; AI use in case preparation/documentation should be traceable,
e.g. through source references.

**Mimer invariant:**

```
GENERATED  != OBSERVED
GENERATED  != SOURCE FACT
GENERATED  != DECISION

Every AI-derived claim must preserve:
  - model identity/version
  - input/evidence references
  - generation timestamp / run identity
  - transformation/prompt/policy version, where relevant
  - the responsible reviewing actor
```

This is close to a restatement of the platform's existing
observation → interpretation → decision separation and its replay
architecture, made explicit as a compliance-relevant property rather than
only a technical one.

**Current implementation:**

| Mechanism | File | State |
|---|---|---|
| Content-addressed, immutable artifacts with `content_hash` | `packages/mps-core/src/types.ts` (`ContentReference`) | IMPLEMENTED |
| Deterministic replay of governed execution | `packages/mps-runtime` (`ExecutionKernel`), proofed by `packages/mps-artifact-store/tests/*` (Golden Repository Replay family — see `REPRODUCIBLE-CHECKPOINT-V1.md` §2 for known gaps in that specific proof) | PARTIAL — replay mechanism exists; `GoldenRepositoryReplay.test.ts` itself is currently red for an unrelated interface-mismatch reason (RC5 triage, class B) |
| Model/version identity carried on AI-derived artifacts | not located as a named field this session | GAP |
| Explicit "this claim was AI-generated, here is its lineage" disclosure surface, distinct from internal provenance | not located | GAP |

**State: PARTIAL.** The evidence/replay substrate this claim depends on is
real and proofed elsewhere in this repository; the AI-specific labeling
(model identity, prompt/policy version) is not yet a named, checked field on
any artifact type.

---

## 4. Information classification before AI/model access

**Digg principle** (verified against
`identifiera-risker-for-informationssakerhet-vid-anvandningen-av-generativ-ai`):
organizations must establish rules for what information may be input to an AI
solution and from what equipment, implement working information
classification, and enforce individual authorization to specific
information — especially where the AI solution connects to existing systems.

**Mimer invariant:**

```
INFORMATION_CLASSIFICATION precedes MODEL_ACCESS.

No model or provider receives an artifact merely because the application
can technically read it. CAS-access != AI-access.
```

An artifact being retrievable from the content-addressed store is not, by
itself, authorization for a model or external AI provider to receive it.
This needs an explicit, checked classification — an "AI processing
eligibility" or disclosure classification — carried on or beside the
artifact, evaluated before any call to a model/provider, not inferred from
the fact that a service happens to have CAS read access.

**Current implementation:**

| Mechanism | State |
|---|---|
| CAS access control (who may read an artifact at all) | IMPLEMENTED — governed by the same actor/role mechanisms as §2 |
| A distinct, checked "may this specific artifact be sent to a model/provider" gate | GAP — not located this session |

**State: GAP.** This is the clearest actionable finding in this document: the
platform's access control answers "who may read this," not "may this be
shown to a model." Those are legally distinct questions per the cited
guidance, and only the first is currently enforced.

---

## 5. Personal-data processing boundary (GDPR/IMY)

**Digg/IMY principle** (verified against
`beakta-dataskyddsregelverket-som-utgangspunkt`): a large share of public-
sector generative-AI use can be assumed to involve personal data, including
indirectly via model training data. Data protection should be treated as a
starting point, not an afterthought. Organizations must be able to establish
data-controller/processor responsibility, legal basis, risk assessment, and
individual-rights handling.

**Mimer invariant:** not a generic `contains_personal_data: boolean`. A
`ProcessingContext` contract, to be attached wherever personal data may flow
through the platform:

```
ProcessingContext
  - contains_personal_data
  - personal_data_categories
  - processing_purpose
  - legal_basis
  - processor/controller context
  - permitted_processing_surfaces
  - retention constraints
```

**Current implementation:** GAP. No such contract exists in this codebase
today. This document freezes the *contract shape* the platform should
converge toward as personal-data-bearing flows grow (e.g. LU evidence tied
to a named property/individual, legal corpus records naming parties). It
does not implement it. Per the Digg/IMY source, this should be addressed
"as a starting point" rather than retrofitted once data volume makes it
costly — flagged here specifically so it is not lost as a later
afterthought.

**State: GAP, contract frozen.**

---

## 6. Model/provider authorization

Not a named Digg/IMY sub-page on its own, but implied by §3 and §4 together:
if provenance must be preserved and classification must precede model
access, then *which* model/provider handled a given artifact is itself
governance-relevant metadata, not incidental.

**Current implementation:** GAP. No registry of authorized models/providers
analogous to the Source Registry (§2 of `SPATIAL-SCHEMA-OWNERSHIP-01.md`'s
sibling pattern, or `source-registry/national-registry.json` itself) exists
for AI model/provider access. This is a natural extension of the existing
Source Registry pattern — an authorized-model registry with the same
approval-attestation shape — but is not built.

---

## 7. Auditability and lifecycle records

**Digg principle** (AI-policy hub page; reinforced by the ethics sub-page
`anvand-generativ-ai-pa-ett-etiskt-satt`): documentation of AI solution use,
development, and lifecycle management should exist; the ethics guidance
separately emphasizes the full lifecycle, transparency, reliability,
security, and accountability of an AI solution.

**Mimer invariant:** the platform's existing architecture — immutable
artifacts, explicit model/version identity where present, deterministic
replay, and a proof fabric with named test lanes — is not merely technical
elegance. It is documented here as also being the platform's answer to this
specific compliance requirement, so the connection is not lost the next time
someone asks "where is our AI lifecycle documentation."

**Current implementation:** PARTIAL, same substrate as §3. The replay/proof
mechanism exists and is proofed (with the known, already-triaged gaps
recorded in `REPRODUCIBLE-CHECKPOINT-V1.md` §2); it has not, until this
document, been explicitly labeled as satisfying an AI-governance
documentation requirement rather than only a data-governance one.

---

## 8. Relationship to existing Mimer governance

This document does not introduce a new governance layer. It reuses the
platform's existing primitives — `ActorReference`, `GOVERNANCE_REVIEWER`
role checks, `approval_attestation`, content-addressed immutable artifacts,
and the observation/interpretation/decision separation — and states which
Digg/IMY-named obligation each one already happens to discharge, partially
discharges, or does not yet touch. Where §2–§7 above found a `GAP`, the
recommended shape reuses the same attestation/registry patterns already
proofed elsewhere in this codebase (Source Registry, `ImportGate`,
`QuarantinePromoter`) rather than proposing a parallel mechanism.

This document is also explicitly **not** gated on
`REPRODUCIBLE_CHECKPOINT_V1` (RC1–RC8) and does not block it. It is a
separate, post-checkpoint governance-authority track. If a future recon
finds one of its `GAP` rows is in fact an active checkpoint blocker, that
finding gets raised in `REPRODUCIBLE-CHECKPOINT-V1.md` directly, not
inferred silently from this document.

---

## 9. Executable invariants / future proof targets

Ordered by how directly each maps to an already-existing pattern this
codebase can extend, not by external priority:

```
AI-GOV-1   Model/artifact classification gate (§4)
           Extend CAS access checks with a distinct "eligible for model
           access" predicate, checked before any provider call.
           Proof target: a test proving a classified-ineligible artifact
           cannot reach a model-call code path.

AI-GOV-2   AI-derived artifact provenance fields (§3)
           Add model identity/version, prompt/policy version, and
           generation run identity to the artifact types that carry
           AI-derived content.
           Proof target: a test asserting these fields are non-optional
           on that artifact type and are preserved through replay.

AI-GOV-3   Decision-subject artifact typing (§2)
           Name and type the artifact(s) that constitute a decision this
           rule applies to, distinct from governance actions on data.
           Proof target: a test proving such an artifact cannot reach
           APPROVED/finalized state without a human ActorReference with
           an appropriate decision-authority role attached.

AI-GOV-4   ProcessingContext contract (§5)
           Freeze the contract now (this document); implement attachment
           to personal-data-bearing artifact types before those flows
           scale further.

AI-GOV-5   Authorized model/provider registry (§6)
           A Source-Registry-shaped registry for models/providers, same
           approval_attestation pattern.
```

None of AI-GOV-1..5 is scheduled against `REPRODUCIBLE_CHECKPOINT_V1`. They
are named here so the next time AI-derived decision support grows in this
platform, the gap is a known, tracked item rather than a rediscovery.
