# DEV-GOV-AUTHORING-TOOLING-01 — CANDIDATE

**Status:** CANDIDATE / NOT YET PROVEN  
**Frozen base:** 864a62f7d1f6f480c41a9c9395e6ce7b920fed99

## Purpose

Reduce authoring/rework cost before trusted Dev-Gov without creating a new trust root.

This unit adds ordinary developer tooling only:

- a non-authoritative authoring preflight helper;
- focused unit tests for R1-class mechanical mistakes;
- reusable producer and cold-verifier prompt templates.

The existing scripts/devgov/devgov.mjs controller and protected trusted evidence gate remain authoritative.

## Frozen claim

The candidate provides a read-only authoring helper that:

1. delegates to the existing controller preflight instead of reimplementing it;
2. surfaces base-RED references to candidate-only repository paths;
3. surfaces allowed_paths entries that match no actual changed path;
4. surfaces RED harnesses with no dedicated blocked-environment exit handling;
5. runs Prettier only on changed files already covered by the repository's current format:check scope;
6. runs ESLint only on changed lintable files;
7. emits authoritative=false so its local result cannot be confused with trusted evidence;
8. ships frozen producer/cold-verifier prompt templates incorporating the lessons from R1.

## Non-claims

This unit does not:

- change scripts/devgov/**;
- change any GitHub workflow;
- create policy, authority, trust roots, attestations, or invariant packs;
- change branch protection;
- change product/runtime semantics;
- make local authoring PASS equivalent to trusted proof;
- repair existing repository-wide lint/type/format/security baseline failures.

## RED property

On the frozen base the load-bearing Dev-Gov controller exists, but the authoring helper, focused test,
and prompt template do not. The RED program handles that absence explicitly as the semantic feature
gap and uses a separate harness exit for unexpected execution failures.

## GREEN proof

The candidate must:

- contain the three authoring artifacts while leaving controller paths untouched;
- pass the focused unit tests;
- run the helper against this exact unit definition;
- receive PASS from the real existing controller preflight;
- pass changed-file Prettier and ESLint checks;
- exercise the candidate-only RED-reference warning on this unit's deliberate absence-style RED;
- still report authoritative=false.

## Known baseline context

Repository-wide CI currently has pre-existing failures outside this unit, including the known
read-only Dev-Gov orchestration assertion and broader format/type/security baseline issues. They are
not converted to PASS here. This unit's GREEN proofs are deliberately changed-file/focused.

## Finalization

This record remains CANDIDATE until the exact candidate SHA receives
DEV-GOV-V0 / trusted-execution = success and is merged under the protected main process.
