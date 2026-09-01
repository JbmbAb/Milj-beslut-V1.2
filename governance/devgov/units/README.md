# DEV-GOV-V0 Units

`DEV-GOV-V0` is a narrow development-governance guard for three invariants:

- path and branch lock
- RED before GREEN proof binding
- exact SHA and ancestry verification

The manifest is intentionally local and boring. It does not create credentials, mutate databases,
merge branches, push code, deploy releases, or run autonomous agents.

Load-bearing evidence must be finalized as JSON bound to:

- unit
- base SHA
- head SHA
- manifest hash
- command
- exit code
- result classification
- timestamp

Allowed and forbidden path rules are fail closed. `forbidden_paths` always wins.
