export const meta = {
  name: 'kernel-integration-audit-01',
  description: 'Cold, independent falsification audit of 6 frozen GAO kernel candidates against Milj-beslut-V1.2',
  phases: [
    { title: 'Falsify', detail: 'one independent cold falsifier agent per frozen candidate, no proponent rationale' },
    { title: 'Gate', detail: 'authority-path hard gate for every candidate whose semantic survived falsification' },
  ],
}

const REPO_ROOT = '/home/user/Milj-beslut-V1.2'

// ---------------------------------------------------------------------------
// Frozen procedural spec (KERNEL-INTEGRATION-AUDIT-01, sections 1,3,4,5,6,7,9,13,14).
// This is neutral audit procedure, not proponent rationale for any candidate.
// ---------------------------------------------------------------------------
const FROZEN_SPEC = `
KERNEL-INTEGRATION-AUDIT-01 — ONTOLOGY-GATE, single-candidate falsification unit

GOVERNING PRINCIPLE
Semantic absence must be proven before semantic creation is permitted.
Sister principle: absence by naming is not absence by semantics; presence by naming is not proof of
semantic uniqueness. You are not confirming a target architecture. You are trying to show that the
candidate concept already exists, can be derived, sits at the wrong abstraction level, or does not
need to be an independent normatively-governed core concept. Treat the candidate as a hypothesis
under test, not as architectural truth.

WHAT THIS AUDIT IS FOR
The repository (Milj-beslut-V1.2 / "Mimer" platform) is considering freezing a minimal normative
"kernel" of core concepts for a future "Governed Autonomous Operations" capability. Before any such
kernel concept is adopted, each candidate must independently survive a falsification pass against the
platform's actual, current, frozen architecture (its ADRs under docs/architecture/ and its actual
TypeScript contracts under packages/ and server/).

WHAT YOU MUST NOT DO (no-create boundary — applies to this whole task)
- Do NOT create, edit, delete, move, or rename any file. Do NOT run any mutating command (no git add/
  commit/push, no rm/mv/touch/sed -i, no npm/pnpm install, no schema migration, no new ArtifactType,
  no new invariant, no ADR). This is a strictly read-only audit.
- Do NOT implement your own proposed minimum semantic delta. You may only describe it in prose.
- You do not get, and must not assume, any prior argumentation for why this candidate is needed, any
  suggested reuse candidates, any preferred implementation, or any expected conclusion. You must build
  your own case from the repository itself.

REQUIRED FALSIFICATION ORDER (deterministic — try in this order, first applicable primary class wins;
you may note others as secondary observations)
1. WRONG_ABSTRACTION_LEVEL — the semantics are real but do not belong in normative core.
2. MECHANISM_ONLY — the concept describes HOW the system does something, not a long-lived normative
   meaning.
3. ALREADY_REPRESENTED — an existing representation already carries the full semantics, with no
   governance or information loss.
4. SEMANTIC_DUPLICATE — multiple existing representations exist that express the same normative
   semantics as each other and as the candidate.
5. DERIVABLE — the semantics can be reproducibly reconstructed from existing authoritative state.
6. NOT_TECHNOLOGY_INDEPENDENT — the concept would disappear or become meaningless under a legitimate
   technology replacement (e.g. swapping the LLM, the risk model, the forecasting method).
7. NOT_INDEPENDENTLY_GOVERNED — the concept has no independent lifecycle/versioning/governance need of
   its own and should be state, attribute, or a relation on an existing artifact, not its own artifact
   family.
8. CORE_SEMANTIC_SURVIVES — active falsification against 1-7 failed; the semantics appears to need
   independent existence as a normative core concept.
If you genuinely cannot resolve the candidate with available evidence, use UNRESOLVED.

UNRESOLVED IS FAIL-CLOSED
UNRESOLVED must never be read as survival. It maps to primary_disposition DEFERRED and
new_core_representation_required MUST be DEFERRED (never YES) in that case. Absence of falsifying
evidence is not positive evidence for a new core concept.

LOSSLESS SEMANTIC REUSE TEST (mandatory whenever you claim ALREADY_REPRESENTED, SEMANTIC_DUPLICATE,
DERIVABLE, or that reuse is otherwise possible)
First state the governance questions this candidate would need to be able to answer if it existed as a
normative concept (you are given a starting set below — extend them if you find the platform asks
more of this concept than the starting set implies). Then answer each question STRICTLY from the
proposed existing/reused representation in the actual repository — not from what you imagine it could
be extended to do. The test PASSES only if every material governance question is answerable from the
existing representation with: the same semantic answer, the same authority, the same source of truth,
the same historical reconstructability, the same provenance, the same fail-closed behavior. If even one
material governance question cannot be reconstructed without semantic loss, the test FAILS and reuse is
not proven — the candidate is NOT ALREADY_REPRESENTED/SEMANTIC_DUPLICATE/DERIVABLE merely because
something with a similar name exists.

DISPOSITION MAPPING (default; deviate only with explicit justification in your explanation field)
- falsification_code CORE_SEMANTIC_SURVIVES -> primary_disposition TRUE_GAP
- falsification_code ALREADY_REPRESENTED or SEMANTIC_DUPLICATE -> primary_disposition LATENT_REUSE
  (or NORMALIZE if the gap is essentially a naming/attribute alignment issue, not a structural one)
- falsification_code DERIVABLE -> primary_disposition DERIVED
- falsification_code WRONG_ABSTRACTION_LEVEL, MECHANISM_ONLY, NOT_TECHNOLOGY_INDEPENDENT, or
  NOT_INDEPENDENTLY_GOVERNED -> primary_disposition FALSIFIED
- falsification_code UNRESOLVED -> primary_disposition DEFERRED

CORE DELTA CATEGORIZATION (delta_category field — required even for LATENT_REUSE/DERIVED/FALSIFIED)
Rank, most expensive first: NEW_CORE_TYPE (a wholly new artifact/type family) > NEW_NORMATIVE_CONTRACT
(a new invariant/contract on existing types) > NEW_DURABLE_RELATION (a new permanent binding between
two existing normative objects) > NEW_NORMATIVE_ATTRIBUTE (a new field/binding on an existing type) >
NORMALIZATION_ONLY (rename/alias only) > NONE (nothing required). IMPORTANT: LATENT_REUSE does not
automatically mean NONE. If the reuse still requires a new permanent binding between two normative
objects that does not exist today, that binding is itself new normative semantics and must be
categorized as NEW_DURABLE_RELATION or NEW_NORMATIVE_ATTRIBUTE, not NONE.

WHAT YOU MUST PRODUCE
A single Kernel Gap Ledger entry via the required structured output. Ground every claim in concrete
repository evidence (repo-relative file path plus line number or range, and a short description of what
that evidence shows). Do not fabricate citations — only cite files/lines you actually read. List every
existing representation you seriously considered as a reuse candidate (existing_semantic_candidates_examined),
including ones you rejected, with why. State your canonical_source_of_truth: the single file/ADR that
would govern this concept's meaning today, if reuse holds, or "NONE" if no such document/type exists.
`.trim()

const CANDIDATES = [
  {
    name: 'MISSION',
    definition:
      'The reason a system-level course of action is undertaken: the purpose or objective that justifies why work occurs at all, as distinct from what capability it uses (Capability) or what specific choice it produces (Decision).',
    questions: [
      'Why did a given Decision exist — what higher purpose was it in service of?',
      'Who issued the governing purpose, and were they authorized to issue it?',
      'What scope did that purpose cover, and did the Decision fall within that scope?',
      'Which capability/ability did the purpose require to remain intact or available?',
      'Was the purpose still active/valid at the time the Decision was made?',
      'Could the system itself originate or alter that purpose, or only a human/external authority?',
      'If the purpose later changes or is retired, can every Decision made under it still be explained historically?',
    ],
  },
  {
    name: 'CAPABILITY',
    definition:
      'A durable ability or function the system must be able to keep providing, as distinct from any one particular mechanism, tool, model, or implementation that currently provides it.',
    questions: [
      'What ability or function was at stake when a given Decision or action was taken or considered?',
      'Is that ability governed (versioned, tracked, subject to approval) independent of any one mechanism that provides it today?',
      'If the underlying implementation/mechanism/connector is replaced, does the concept of "what must keep working" survive unchanged?',
      'Can two different technical implementations be recognized as providing the "same" capability?',
      'Does anything in the system today track capability health/availability independent of a specific connector, tool, or model?',
    ],
  },
  {
    name: 'AUTHORITY',
    definition:
      'The scope of what an actor is permitted to do: the bounds within which an action is sanctioned, as distinct from evidence that an action occurred (Evidence) or the specific choice that was made (Decision).',
    questions: [
      'What permitted a given actor to take a given action, as opposed to merely being able to?',
      'What is the boundary of what was permitted, and how would an attempt outside that boundary be recognized and rejected?',
      'Who or what granted the permission, and can that grant be traced and verified after the fact?',
      'Can the permission be revoked, delegated, or scoped to a sub-actor?',
      'Does the system distinguish "permitted" from "physically possible" and from "evidenced as having happened"?',
    ],
  },
  {
    name: 'EVIDENCE',
    definition:
      'Material that supports or documents a claim about a past or present state of affairs, as distinct from an interpretation, conclusion, or decision drawn from it.',
    questions: [
      'What material supports the claim that a given fact/state/event is true?',
      'Can that material be traced back to its origin and verified as unaltered?',
      'Is the material kept structurally distinct from any interpretation, summary, or conclusion drawn from it?',
      'Can a decision be reconstructed or justified purely by tracing to this material?',
      'If the material is later found unreliable, can everything derived from it be identified?',
    ],
  },
  {
    name: 'DECISION',
    definition:
      'A specific choice made among identifiable alternatives at a point in time, as distinct from the reasoning material considered beforehand (Evidence) and the state that results afterward (Outcome).',
    questions: [
      'What specific choice was made among identifiable alternatives?',
      'At what point in time was the choice made, and under what authority?',
      'What material was considered in making the choice?',
      'Can this exact choice be distinguished, structurally, from the reasoning material that led to it and from what happened afterward?',
      'Is there exactly one authoritative, immutable-after-the-fact record of what was chosen?',
    ],
  },
  {
    name: 'OUTCOME',
    definition:
      'The state of affairs that resulted after a decision or action was carried out, as distinct from what was expected or intended beforehand.',
    questions: [
      'What state of affairs existed after a given decision/action was carried out?',
      'Can that resulting state be compared against what was expected/intended beforehand?',
      'Is the resulting state recorded as an observation, structurally distinct from any judgment about whether it was "good"?',
      'Can the system trace which decision produced this outcome?',
      'Does this resulting state need governance/versioning of its own, independent of the decision it followed and the evidence that documents it?',
    ],
  },
]

const CANDIDATE_NAMES = CANDIDATES.map((c) => c.name).join(', ')

const LEDGER_SCHEMA = {
  type: 'object',
  properties: {
    candidate: { type: 'string' },
    primary_disposition: {
      type: 'string',
      enum: ['TRUE_GAP', 'LATENT_REUSE', 'NORMALIZE', 'DERIVED', 'FALSIFIED', 'DEFERRED'],
    },
    falsification_code: {
      type: 'string',
      enum: [
        'WRONG_ABSTRACTION_LEVEL',
        'MECHANISM_ONLY',
        'ALREADY_REPRESENTED',
        'SEMANTIC_DUPLICATE',
        'DERIVABLE',
        'NOT_TECHNOLOGY_INDEPENDENT',
        'NOT_INDEPENDENTLY_GOVERNED',
        'CORE_SEMANTIC_SURVIVES',
        'UNRESOLVED',
      ],
    },
    confidence: { type: 'string', enum: ['PROVEN', 'STRONG', 'PARTIAL', 'UNRESOLVED'] },
    explanation: { type: 'string', description: 'Overall reasoning summary for the disposition reached.' },
    existing_semantic_candidates_examined: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          file: { type: 'string' },
          why_considered_and_verdict: { type: 'string' },
        },
        required: ['name', 'why_considered_and_verdict'],
      },
    },
    canonical_source_of_truth: { type: 'string' },
    lossless_reuse_test: {
      type: 'object',
      properties: {
        result: { type: 'string', enum: ['PASS', 'FAIL', 'NOT_APPLICABLE'] },
        governance_questions_answered: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              question: { type: 'string' },
              answerable_from_existing_representation: { type: 'boolean' },
              explanation: { type: 'string' },
            },
            required: ['question', 'answerable_from_existing_representation', 'explanation'],
          },
        },
      },
      required: ['result', 'governance_questions_answered'],
    },
    semantic_conflicts: { type: 'array', items: { type: 'string' } },
    constitutional_dependencies_existing: { type: 'array', items: { type: 'string' } },
    constitutional_guarantees_required_by_delta: { type: 'array', items: { type: 'string' } },
    delta_category: {
      type: 'string',
      enum: [
        'NEW_CORE_TYPE',
        'NEW_NORMATIVE_CONTRACT',
        'NEW_DURABLE_RELATION',
        'NEW_NORMATIVE_ATTRIBUTE',
        'NORMALIZATION_ONLY',
        'NONE',
      ],
    },
    minimum_semantic_delta: { type: 'string' },
    new_core_representation_required: { type: 'string', enum: ['YES', 'NO', 'DEFERRED'] },
    evidence_refs: { type: 'array', items: { type: 'string' } },
    negative_findings: { type: 'array', items: { type: 'string' } },
    discovered_candidates: {
      type: 'array',
      items: {
        type: 'object',
        properties: { name: { type: 'string' }, why: { type: 'string' } },
        required: ['name', 'why'],
      },
      description: 'Concepts you noticed that might themselves be future core-concept candidates, out of scope for this round.',
    },
  },
  required: [
    'candidate',
    'primary_disposition',
    'falsification_code',
    'confidence',
    'explanation',
    'existing_semantic_candidates_examined',
    'canonical_source_of_truth',
    'lossless_reuse_test',
    'delta_category',
    'minimum_semantic_delta',
    'new_core_representation_required',
    'evidence_refs',
  ],
}

const GATE_SCHEMA = {
  type: 'object',
  properties: {
    candidate: { type: 'string' },
    integration_path_found: { type: 'boolean' },
    authority_root_used: { type: 'string' },
    second_authority_root_detected: { type: 'boolean' },
    parallel_governance_path_detected: { type: 'boolean' },
    authority_bypass_detected: { type: 'boolean' },
    duplicate_source_of_truth_detected: { type: 'boolean' },
    verdict: { type: 'string', enum: ['CLEAR', 'BLOCKED'] },
    explanation: { type: 'string' },
    evidence_refs: { type: 'array', items: { type: 'string' } },
  },
  required: [
    'candidate',
    'integration_path_found',
    'second_authority_root_detected',
    'parallel_governance_path_detected',
    'authority_bypass_detected',
    'duplicate_source_of_truth_detected',
    'verdict',
    'explanation',
  ],
}

function falsifyPrompt(c) {
  return `${FROZEN_SPEC}

CANDIDATE UNDER AUDIT: ${c.name}

This audit is independently evaluating 6 frozen candidates in total this round: ${CANDIDATE_NAMES}.
Each is being audited separately by a different cold reviewer with no visibility into the others'
work. You are ONLY evaluating ${c.name} in this task. Do not attempt to evaluate or rule on the others,
though you may note a SEMANTIC_DUPLICATE concern against another candidate name if you find one.

Minimal semantic definition (a starting point only — verify, refine, or refute it yourself; it is not
a conclusion, and it is not necessarily how the repository itself would phrase it):
"${c.definition}"

Starting governance questions this candidate would need to answer if adopted as a normative core
concept (extend this list yourself if the platform's actual architecture asks more of the concept):
${c.questions.map((q, i) => `${i + 1}. ${q}`).join('\n')}

Repository root: ${REPO_ROOT}
Suggested (not mandatory) starting points: docs/architecture/README.md (the authority chain index),
docs/architecture/ADR-MPS-CONSTITUTIONAL-INVARIANTS.md (current normative constitution),
docs/architecture/ADR-MPS-CORE-001.md, the docs/architecture/ADR-24-2*.md family (actor identity,
signature, audit/replay, retention, execution identity, capability trust), and the actual TypeScript
contracts under packages/mps-core, packages/mps-governance, packages/mps-governance-runtime,
packages/mps-capability, packages/mps-decision-governance, packages/mps-compliance, packages/mps-runtime,
packages/mps-evolution. You are not limited to these — explore as broadly as the audit requires, and
check actual code, not only documentation, since documentation can drift from implementation.

Read-only audit. Do not modify anything. Produce your Kernel Gap Ledger entry via the required
structured output tool.`
}

function gatePrompt(entry) {
  return `AUTHORITY-PATH HARD GATE for candidate ${entry.candidate}.

A prior, independent falsification pass concluded this candidate's semantics survived falsification
(disposition: ${entry.primary_disposition}, code: ${entry.falsification_code}, confidence:
${entry.confidence}) and proposed this minimum semantic delta:
"${entry.minimum_semantic_delta}"
Its stated canonical_source_of_truth / proposed home: "${entry.canonical_source_of_truth}"

Your job is narrow and adversarial: verify whether the integration path for this candidate's proposed
representation would run through the platform's EXISTING single authority root
(docs/architecture/ADR-MPS-CONSTITUTIONAL-INVARIANTS.md, per docs/architecture/README.md, which states
that document is the sole source of architectural truth) — or whether it would require or imply any of:
- SECOND_AUTHORITY_ROOT — a second document/mechanism claiming constitutional/root authority
- PARALLEL_GOVERNANCE_PATH — a governance flow that does not pass through existing actor/authority
  mechanisms (ActorReference, ActorRole, TrustDomainArtifact, AuthorityEvidenceArtifact, GovernanceEngine,
  PolicyArtifact, etc. in packages/mps-core, packages/mps-governance, packages/mps-governance-runtime)
- AUTHORITY_BYPASS — a path that could create or mutate authority-bearing state without going through
  those existing mechanisms (see packages/mps-governance-runtime/src/authorityTypes.ts's
  AUTHORITY_ARTIFACT_TYPES and the GOVERNANCE-22.9-I13 "Observation Cannot Become Authority" invariant)
- DUPLICATE_SOURCE_OF_TRUTH — a second place that could independently claim to be authoritative for the
  same fact this candidate would represent

Repository root: ${REPO_ROOT}. Read-only. Verdict CLEAR only if none of the four risks above are
present; otherwise BLOCKED. Ground your verdict in concrete file/line evidence. Produce your result via
the required structured output tool.`
}

phase('Falsify')
const results = await pipeline(
  CANDIDATES,
  (c) => agent(falsifyPrompt(c), { label: `falsify:${c.name}`, phase: 'Falsify', schema: LEDGER_SCHEMA, effort: 'high' }),
  (ledgerEntry, c) => {
    if (!ledgerEntry) {
      return Promise.resolve({ candidate: c.name, ledger: null, gate: null })
    }
    if (ledgerEntry.new_core_representation_required === 'YES') {
      return agent(gatePrompt(ledgerEntry), { label: `gate:${c.name}`, phase: 'Gate', schema: GATE_SCHEMA, effort: 'high' }).then(
        (gate) => ({ candidate: c.name, ledger: ledgerEntry, gate })
      )
    }
    return Promise.resolve({ candidate: c.name, ledger: ledgerEntry, gate: null })
  }
)

return { frozen_candidate_set: CANDIDATE_NAMES, results }
