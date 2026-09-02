# DEV-GOV-V0 Units

`DEV-GOV-V0` is a narrow development-governance guard for three invariants:

- path and branch lock
- RED before GREEN proof binding
- exact SHA and ancestry verification

The manifest is intentionally local and boring. It does not create credentials, mutate databases,
merge branches, push code, deploy releases, or run autonomous agents.

Persisted local evidence is provenance, not execution authority. `evidence-gate` first resolves the
declared worktree and verifies live repository state, target SHA, ancestry policy, clean tree, and
remote policy. It then requires externally signed execution attestations for every declared RED and
GREEN command. Canonical-ledger JSON, caller-supplied evidence, hashes, nonces, and timestamps cannot
establish executable proof by themselves.

The trusted execution workflow runs the candidate command in a job with no signing credential. A
second job on the protected `devgov-attestation` environment receives only the execution record and
signs it with `DEVGOV_ATTESTATION_PRIVATE_KEY_PEM`. The producer can request verification but must not
possess that credential or write the verifier-controlled trust policy. The workflow must live on and
be dispatched from the protected default branch.

The verifier supplies a trust policy outside the producer's write domain. It binds the accepted
Ed25519 public key to an exact issuer, workflow ref, and runner identity. Missing or invalid trusted
attestation returns `DENIED_GOVERNANCE` with `proof_status: NOT_PROVEN`.

The protected GitHub environment must provide `DEVGOV_ATTESTATION_PRIVATE_KEY_PEM` as a secret and
`DEVGOV_ATTESTATION_ISSUER` plus `DEVGOV_ATTESTATION_KEY_ID` as protected variables. The matching
verifier-owned policy has this minimal shape and must not be sourced from the candidate checkout:

```json
{
  "schema_version": "dev-gov-v0-trust-policy",
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
- source manifest hash for provenance
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
