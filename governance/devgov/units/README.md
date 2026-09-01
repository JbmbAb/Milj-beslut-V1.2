# DEV-GOV-V0 Units

`DEV-GOV-V0` is a narrow development-governance guard for three invariants:

- path and branch lock
- RED before GREEN proof binding
- exact SHA and ancestry verification

The manifest is intentionally local and boring. It does not create credentials, mutate databases,
merge branches, push code, deploy releases, or run autonomous agents.

Persisted evidence is provenance, not standalone authority. `evidence-gate` must first resolve the
declared worktree and verify the live repository state, target SHA, ancestry policy, clean tree, and
remote policy from the manifest. Only after that live repository check passes may it read the
canonical evidence ledger derived from the unit and manifest hash. Caller-supplied arbitrary
evidence paths are non-authoritative and are denied for V0 gate decisions.

Load-bearing evidence must be finalized as JSON bound to:

- unit
- base SHA
- head SHA
- manifest hash
- command
- execution nonce
- tool version
- started/finished time
- exit code
- result classification
- environment/governance reason when not PASS
- canonical evidence path and sequence identity
- evidence hash

Allowed and forbidden path rules are fail closed. `forbidden_paths` always wins.
