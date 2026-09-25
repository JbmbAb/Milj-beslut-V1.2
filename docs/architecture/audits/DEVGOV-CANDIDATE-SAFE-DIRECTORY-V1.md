# DEVGOV-CANDIDATE-SAFE-DIRECTORY-V1 — CANDIDATE

**Status:** CANDIDATE / NOT YET PROVEN  
**Frozen base:** `b3d1a93bb4b1f7142dc3263ace694768973b0122`  
**Unit:** `DEVGOV-CANDIDATE-SAFE-DIRECTORY-V1`

## Finding

Trusted run `36140008613` exposed a controller isolation defect. The execution checkout is frozen to
`root:root`, while declared proof commands run as `devgov-candidate`. The workflow added
`safe.directory` only to root's global Git configuration, so a proof that invokes Git can fail with
`detected dubious ownership` even though the exact checkout is valid.

The defect was independently reproduced on Ubuntu: adding the repository to root's global
`safe.directory` did not make it trusted by `devgov-candidate`.

## Claim

Both candidate and execution checkout paths are added to the global Git configuration of the actual
proof OS identity, `devgov-candidate`, using `sudo -H -u devgov-candidate git config --global`.
Root-only safe-directory configuration is removed.

## Non-claims

This unit does not alter signer authority, environment protection, trust policy, candidate SHA
binding, execution-root verification, Step 5 invariant-pack semantics, product code, or any
governance schema. It does not weaken checkout ownership or write protection.

## Helper note

The advisory authoring helper reports DGL-003 because this unit must allow the exact protected
workflow file that it exists to repair. This is the same self-referential exception documented for
the already-PROVEN attest standalone-dispatch closure. The unit still forbids every other
controller workflow, `scripts/devgov/**`, schema, invariant packs, and product/runtime surfaces.
The helper is non-authoritative; trusted RED/GREEN and the canonical gate remain authoritative.

## Evidence

RED requires the existing isolation controls as positive controls and fails on the frozen base because
safe-directory is root-only. GREEN requires both paths to be configured for `devgov-candidate` and
runs the trusted-workflow regression suite.

Remain CANDIDATE until trusted RED/GREEN, canonical gate, merge, and tree-equivalence verification
succeed.
