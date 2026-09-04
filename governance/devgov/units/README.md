# DEV-GOV-V0 Units

## V1 derived candidate identity

`dev-gov-v1-unit-definition` replaces the uninstantiable V0 manifest contract. A committed unit
definition contains stable proof policy and commands, but never `target_sha` or `worktree`.
Candidate identity is derived from the exact checkout by the protected controller and carried in a
separate execution envelope as `candidate_sha`. The controller signs and verifies the tuple:

- candidate SHA
- exact unit-definition hash
- controller SHA
- execution SHA and proof phase
- protected workflow/run and runner identity
- command result

The workflow loads the definition only from the exact candidate checkout and verifies its tracked
bytes against that commit. RED may execute at the declared `base_sha`; GREEN executes at the
derived candidate SHA. Both attestations remain bound to the same candidate and unit-definition
hash. V0 manifests and V0 execution attestations are historical records and are rejected by the V1
controller rather than implicitly upgraded.

The V0 schema remains in the repository solely so the historical V6 contract can be reproduced.
New units use `governance/devgov/schema/dev-gov-v1-unit-definition.schema.json`.

`DEV-GOV-V0` is a narrow development-governance guard for three invariants:

- path and branch lock
- RED before GREEN proof binding
- exact SHA and ancestry verification

The unit definition is intentionally local and boring. It does not create credentials, mutate databases,
merge branches, push code, deploy releases, or run autonomous agents.

Persisted local evidence is provenance, not execution authority. `evidence-gate` first resolves the
controller-supplied worktree and verifies live repository state, derived candidate SHA, ancestry policy, clean tree, and
remote policy. It then requires externally signed execution attestations for every declared RED and
GREEN command. Canonical-ledger JSON, caller-supplied evidence, hashes, nonces, and timestamps cannot
establish executable proof by themselves.

The trusted execution workflow runs the candidate command in a job with no signing credential. A
second job on the protected `devgov-attestation` environment receives only the execution record and
signs it with `DEVGOV_ATTESTATION_PRIVATE_KEY_PEM`. The producer can request verification but must not
possess that credential or write the verifier-controlled trust policy. The workflow must live on and
be dispatched from the protected default branch.

The verifier supplies a trust policy outside the producer's write domain. `evidence-gate` never
accepts a trust-policy path or trust-policy bytes from CLI input or the candidate checkout. The
protected gate workflow obtains the policy from `DEVGOV_VERIFIER_TRUST_POLICY_JSON` in the
`devgov-attestation` environment and proves that provenance with a GitHub-issued OIDC token. The
token must bind the repository, default-branch gate workflow, default-branch ref, protected
environment, GitHub-hosted runner, and `devgov-v0-gate` audience. Missing, invalid, redirected, or
caller-selected verifier configuration fails closed with `proof_status: NOT_PROVEN`.
The controller also pins that authority to
`JbmbAb/Milj-beslut-V1.2/.github/workflows/devgov-v0-gate.yml@refs/heads/main`; a policy cannot
redirect verification to another repository, workflow, ref, environment, or runner class.

The protected GitHub environment must provide `DEVGOV_ATTESTATION_PRIVATE_KEY_PEM` as a secret and
`DEVGOV_ATTESTATION_ISSUER` plus `DEVGOV_ATTESTATION_KEY_ID` as protected variables. The matching
verifier-owned policy is stored as the protected `DEVGOV_VERIFIER_TRUST_POLICY_JSON` secret. It has
this minimal shape and must not be sourced from the candidate checkout:

```json
{
  "schema_version": "dev-gov-v0-trust-policy",
  "authority": {
    "type": "github-oidc-protected-environment",
    "repository": "JbmbAb/Milj-beslut-V1.2",
    "workflow_ref": "JbmbAb/Milj-beslut-V1.2/.github/workflows/devgov-v0-gate.yml@refs/heads/main",
    "ref": "refs/heads/main",
    "environment": "devgov-attestation",
    "runner_environment": "github-hosted"
  },
  "trusted_issuers": [
    {
      "issuer": "github-actions:owner/repository:devgov-v0-attest",
      "key_id": "devgov-ci-ed25519-v1",
      "algorithm": "ed25519",
      "public_key_pem": "<verifier-controlled Ed25519 public key PEM>",
      "workflow_ref": "owner/repository/.github/workflows/devgov-v0-attest.yml@refs/heads/main",
      "runner_identity": "github-hosted:ubuntu-latest"
    }
  ]
}
```

The gate workflow downloads signed RED and GREEN attestations from their protected workflow runs,
checks the live candidate repository at the exact derived SHA, and publishes commit status context
`DEV-GOV-V0 / trusted-execution` for that exact SHA. Local `evidence-gate` output is diagnostic and
does not become merge authority merely because a caller can set process environment variables.
The OIDC audience includes the SHA-256 digest of the exact protected policy bytes and the candidate
SHA, so a valid token cannot be redirected to a replacement policy or another candidate.

Repository branch protection or a ruleset must require that exact status context before merge.
That administrator-owned repository setting is not created or modified by DEV-GOV-V0 and remains
an explicit external enforcement boundary until configured and independently verified.

The private key is never passed to the execution job. The signing job checks the unsigned record
against the exact manifest command, base/target SHA, phase, protected workflow run, and signer
identity before signing. Candidate code runs as a separate unprivileged OS user against a root-owned,
read-only checkout. It cannot rewrite tracked proof bytes, controller code, or the root-owned
execution-record directory. Only that user's separate home and system temporary area remain writable.

Signed execution attestations bind:

- unit
- base SHA
- head SHA
- portable proof-contract hash
- exact unit-definition hash
- command
- protected workflow and runner identity
- controller SHA and workflow run identity
- started/finished time
- exit code
- result classification
- environment/governance reason when not PASS
- stdout/stderr digests and result digest

`run-red` and `run-green` remain useful local diagnostics. Their files are never accepted as the
authority that makes `evidence-gate` pass.

Allowed and forbidden path rules are fail closed. `forbidden_paths` always wins.
