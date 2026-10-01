# @miljobeslut/mps-pattern-proof

PATTERN-PROOF-ENGINE-01 V1 — `BOOTSTRAP_RED_ONLY` engine infrastructure.

Authority (frozen, read these first):

- `docs/architecture/PATTERN-PROOF-ENGINE-01-DESIGN-V1-FROZEN.md` — the protocol (artifacts, terminal
  states, writer/verifier isolation, evidence grounds, InputManifest, authority-discovery rule, ADR
  reconciliation, existing-platform reuse map).
- `docs/architecture/PATTERN-PROOF-ENGINE-01-V1-BOOTSTRAP-RED-ONLY-DESIGN-FROZEN.md` — the V1
  implementation design (concrete schemas, state machine, orchestrator boundary, Docker target
  artifacts, six terminal-state fixtures, stop point).

Unit record: `docs/architecture/audits/PATTERN-PROOF-ENGINE-01-V1-BOOTSTRAP-RED-ONLY.md`.

What is here:

| Area                                                  | Files                                                                         |
| ----------------------------------------------------- | ----------------------------------------------------------------------------- |
| Artifact protocol                                     | `src/evidence.ts`, `src/artifacts.ts`, `src/validators.ts`, `src/schemas.ts`  |
| Identity + persistence (reuses CAS-backed repository) | `src/identity.ts`, `src/persistence.ts`                                       |
| Authority resolution (frozen §8)                      | `src/authority.ts`                                                            |
| Six-terminal-state machine (frozen §3)                | `src/state-machine.ts`, `src/replay.ts`                                       |
| Writer/verifier isolation proof (frozen §4, §13)      | `src/isolation.ts`                                                            |
| Solution-neutral Docker RED probes (BOOTSTRAP §5.4)   | `src/docker/*`, `scripts/red-probe.ts`                                        |
| Orchestrator adapter (BOOTSTRAP §4)                   | `workflow/ppe-v1.js`, `scripts/gen-workflow-adapter.ts`, `scripts/ppe-cli.ts` |
| On-demand routine prompt                              | `routine/PATTERN-PROOF-ENGINE-V1.prompt.md`                                   |

Run the tests: `npx vitest run --config vitest.config.ts packages/mps-pattern-proof/tests` (from the repo root).

Run a RED probe: `npx tsx packages/mps-pattern-proof/scripts/red-probe.ts --dockerfile Dockerfile --stage production-base --executor auto --json`
(exit 0 = PASS, 1 = FAIL i.e. RED confirmed, 2 = BLOCKED).

This package produces evidence only. It never mints authority, never decides PROVEN or promotion, and in
`BOOTSTRAP_RED_ONLY` mode never invokes a writer against a target.
