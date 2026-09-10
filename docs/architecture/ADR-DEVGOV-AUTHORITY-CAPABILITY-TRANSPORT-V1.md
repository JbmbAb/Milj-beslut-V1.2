# ADR — DEV-GOV Authority Capability / Transport V1

- Status: implemented, backend unprovisioned
- Base: `0d7b2bd566b0d5f7c9d27d645c941acd66cb1e85`
- Supersedes nothing. Evolves `dev-gov-v1-trusted-execution-record` to `dev-gov-v2-trusted-execution-record`.

## Problem

A proof may need bytes that are not in the repository — a frozen corpus, a signed
contract set, a captured fixture bundle. Before this unit, DEV-GOV had no way to
supply them. The observed consequence: authority-dependent suites detected the
absence of a hard-coded local path, skipped themselves inside `describe.skipIf`,
the runner exited 0, and the orchestration attested GREEN. The proof was never
executed, and nothing in the signed evidence said so.

Two things had to be true at once:

1. A candidate must be able to *ask* for the bytes it needs.
2. A candidate must not be able to influence *which* bytes those are.

## Decision

A candidate proof declares a capability id and nothing else:

```json
{ "id": "green", "command": "npx", "args": ["vitest", "run", "..."],
  "authority_requirement": { "id": "PHASE0-WORKSPACE-LIFECYCLE-V1" } }
```

`authority_requirement` accepts exactly one property. A candidate that also
declares `expected_digest`, `source`, `provider`, `materialization_path` or
`signer` is a governance denial at unit-definition validation — the extra field
is rejected by name, never silently ignored.

Everything else lives in `governance/devgov/authority/catalog-v1.json`:

```
AuthorityCatalog[id] -> { provider, source, archive.sha256,
                          content.digest, reference?, capability_env,
                          required_entries? }
```

The catalog is read only from the controller checkout. Its path is derived from
`scripts/devgov/authority.mjs`'s own `import.meta.url`; there is deliberately no
CLI flag, environment variable or unit-definition field that names it. The
candidate's copy of the same path is never consulted. Unknown id ⇒ deny.

### Content identity

`dev-gov-authority-tree-sha256-v1`:

```
sha256(stableJson([[posixRelativePath, sha256(fileBytes)], ...]))   sorted by path
```

Symlinks and non-regular entries are rejected outright rather than skipped, so a
materialization cannot hide content from the digest. An empty tree is rejected.

### Ordered resolution (`scripts/devgov/authority.mjs`)

1. Resolve the id through the protected catalog.
2. Retrieve bytes outside candidate-controlled storage.
3. Verify the retrieved archive against `archive.sha256` before expanding it.
4. Expand into a root outside both checkouts, after rejecting absolute or
   `..`-bearing archive entries.
5. Recompute the tree digest; compare to `content.digest`.
6. Compare the optional reference document to `reference.digest`.
7. Apply read-only modes and, on the trusted runner, root ownership.
8. **Probe** writability by actually attempting to write — as the proof identity
   when a uid/gid is supplied. The probes that ran are reported, so a skipped
   probe can never be mistaken for a passed one.
9. Only then launch the declared proof command.

Any failure terminates as `DENIED_GOVERNANCE` with **no execution record
written**. An authority-bound proof that cannot be granted authority is not
executed as an ordinary PASS/FAIL, so there is nothing for the signer to sign
and nothing for the gate to accept.

### Environment

Capability names come from the catalog, never from the candidate. Before the
proof is spawned the controller:

- denies any candidate `env` key that collides with a catalog capability name or
  with the retrieval credential (explicit denial, recorded in evidence);
- scrubs every catalog capability name from the inherited environment, so an
  ambient value cannot stand in for verified authority;
- scrubs `DEVGOV_AUTHORITY_TOKEN`, `GITHUB_TOKEN` and `GH_TOKEN`;
- applies the authority-issued values **last**, so nothing can override them.

### Signed evidence

The execution record is versioned `dev-gov-v2-trusted-execution-record` and adds:

| field | meaning |
|---|---|
| `authority_id` | capability granted, `""` when none |
| `authority_content_digest` | verified tree digest, `""` when none |
| `authority_reference_digest` | verified reference digest, `""` when none or absent |
| `authority_materialization_result` | `NOT_REQUIRED` \| `VERIFIED_READ_ONLY` |
| `authority_binding_digest` | canonical digest of the four fields above |

`authority_binding_digest` is required on every record, including proofs needing
no authority — "no authority" is an explicit signed claim, not an absent field.
It is also folded into `proof_id`, so a partial forgery fails the signed proof-id
binding.

The v1 schema is **not** widened in place. A v1 attestation does not validate as
v2 and vice versa, so no previously signed evidence is reinterpreted under the
new contract. Consumers updated together: `devgov.mjs`
(`trustedExecutionRecord`, `validateExecutionRecordForManifest`,
`evaluateTrustedExecutionGate`, `execute-proof`, `attest-execution`,
`evidence-gate`), `trusted-attestation.mjs`, and the `scripts/audit/devgov*`
suites.

### Independent rejection at the gate

The signer and the gate both re-derive the expected authority identity from the
candidate's capability id plus the protected catalog, and compare it to the
attested record. Nothing in the record is trusted for this. A forgery that
re-signs *and* recomputes every internal digest — binding digest and proof id
alike — still fails, because the identity it claims is not the identity the
protected catalog binds.

### Trust direction

```
protected controller catalog ── knows ──▶ digest, source, path, capability names
candidate                    ── knows ──▶ capability id only
proof process                ── receives ─▶ a path to already-verified read-only bytes
signer / gate                ── recompute ─▶ expected identity, compare, reject substitution
```

No trust flows in the opposite direction.

## Backend

**`github-release-asset`**, retrieved with the run's own `github.token` under
`contents: read`.

Considered and rejected:

- **`packages/mps-*` CAS classes** (`mps-cas-boundary`,
  `ContentAddressedArtifactStore`, `CasArtifactRepository`) — candidate-side
  TypeScript product code. Importing it into the protected controller inverts the
  trust boundary and adds a build dependency to a deliberately dependency-free
  `.mjs` controller.
- **Bytes committed to the protected branch** — not a transport at all. It only
  relocates the problem to "commit the payload to `main`", which for the Phase-0
  corpus is a 5.7 MB product-tree change and a decision that belongs to the
  owning track.
- **GCS via Workload Identity Federation** — reachable (the repo already federates
  for Vertex), but it puts cloud credentials in the same job that executes
  candidate code, and needs bucket plus IAM provisioning. Disproportionate for V1.

Release assets win on three counts: they are outside the git object graph, so no
candidate commit can influence them; they need no new secrets; and adding a
future authority is a release upload plus a catalog entry, with no product-tree
change.

## Current provisioning state

`governance/devgov/authority/catalog-v1.json` ships with `authorities: {}`.

No authority is provisioned, and that is the honest state, not an oversight. The
consequence is correct and fail-closed: a proof declaring
`PHASE0-WORKSPACE-LIFECYCLE-V1` today is **denied** (`AUTHORITY_ID_UNKNOWN`)
rather than silently attested GREEN.

### To provision `PHASE0-WORKSPACE-LIFECYCLE-V1`

External steps, none of which this unit performs:

1. Pack the verifier-controlled mirror
   (`mirrors/sha256/e2eb8fbd111ae0e6efdf2b40e2b746e97b1f708d0f34c6ee45576f852e9b22a6`,
   285 files, ~5.7 MB) as `tar.gz`, with the authority reference document
   (`sha256:96e784e7683aa7815ecad807fe43d7ee11bf11ad5a31c5a407c575cedc090f84`)
   included at a fixed relative path.
2. Publish it as a release asset on `JbmbAb/Milj-beslut-V1.2` under a tag that
   only repository writers can create.
3. Measure `archive.sha256` and the `dev-gov-authority-tree-sha256-v1` digest of
   the expanded tree.
4. Add the catalog entry on the protected default branch, binding
   `capability_env.root` to `WLC_AUTHORITY_ROOT` and `capability_env.reference`
   to `WLC_AUTHORITY_REFERENCE`.

The externally recorded `mirror_content_digest` (`e2eb8fbd…`) and reference self
digest (`96e784e7…`) are anchors for step 3, not substitutes for it: a digest is
authority only once it is in the protected catalog. A candidate repeating either
value is not authority.

## Explicitly out of scope

The following belong to a later, separate workspace-lifecycle portability and
proof-contract repair and are untouched here:

- `ObserverDeterminism.test.ts` eager `loadCorpus`
- `ObserverReplay.smoke.test.ts` eager `loadCorpus`
- `AcceptanceRunner.ts` hard-coded `\\corpus`
- authority-required acceptance using skip semantics

This unit makes verified authority *available and bound*. Making those suites
hard-fail rather than skip when it is absent is the downstream repair.
