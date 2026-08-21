# LU-EXECUTION-AUTHORITY-BOOTSTRAP-01 — IMPLEMENTED / PROVEN

**Status:** IMPLEMENTED / PROVEN. Adopted, not rebuilt: commit `8979fb03` ("feat(lu): bootstrap
execution authority chain"), authored by a concurrent session, was verified against this track's
full frozen proof contract. No defect was found in the adopted design — everything named PASS/
FAIL CLOSED actually does, against the real, already-provisioned root/issuer chain and the real,
already-issued execution identity for the LU golden-path project. Nothing in the adopted
implementation was changed.

## What was adopted

- `packages/mps-lu/src/artifacts/LuExecutionAuthorityArtifact.ts` — the two-tier chain:
  `LuExecutionAuthorityRootArtifact` (`lu_execution_authority_root`) and
  `LuExecutionAuthorityIssuerArtifact` (`lu_execution_authority_issuer`, `root_ref`-bound), both
  with `validate*Artifact` canonical recompute-and-compare functions and scope
  (`LU_EXECUTION_AUTHORITY_V1`) hardcoded into construction, not caller-parameterized.
- `packages/mps-lu/src/execution/LuExecutionAuthorityChain.ts` — `verifyLuExecutionAuthorityChain`:
  resolves and canonically validates the issuer, resolves and canonically validates the root,
  verifies the root's self-attestation, and verifies the issuer's attestation was **signed by the
  root's own key** — a real two-tier cryptographic delegation, not merely an audit-trail
  reference.
- `packages/mps-lu/src/execution/LuExecutionIdentitySeed.ts` — `deriveLuExecutionSeed`: a pure
  function of the full canonical execution tuple (site_id, project_id, project/property context
  refs, context-binding ref, release ref + hash, contract version, rule-registry snapshot id).
  No entropy input exists in its signature — a random or caller-chosen seed cannot enter through
  this function at all.
- `ExecutionIdentityAttestation.ts` (extended) — `executionIdentityCanonicalBody` +
  full-body recompute now run before any other check in `verifyExecutionIdentityAttestation`.
- `LuExecutionIdentityIssuer.ts` (extended) — `issueExecutionIdentity` now accepts an optional
  `issuer_ref` (embedded into the identity's `references`) and `governed_references`, so a minted
  identity carries a real link to the issuer that authorized it and to the canonical context it
  was issued against.
- `LuExecutionKernelClient.ts` (extended) — when a root authority is configured
  (`LU_EXECUTION_AUTHORITY_ROOT_KEY_ID`/`_ROOT_PUBLIC_KEY_PEM` present), admission additionally
  requires the resolved identity's issuer to pass `verifyLuExecutionAuthorityChain` against the
  trusted root before the identity is trusted at all — a failure here silently returns to the
  "no identity" state, so `RuntimeAdmissionKernel`'s own existing denial fires, not a fabricated
  trust.
- `scripts/ops/bootstrap-lu-execution-authority.ts` — owner-only issuance command, hardcoded to
  the real golden-path project/property/binding/release, with a `--verify`-only mode that
  explicitly asserts no private key env var is present before running.

## Proof, against the real Mimer CAS and the real, already-provisioned keys

`scripts/db/lu-execution-authority-bootstrap-01-adoption-proof.ts`. Private key files were never
read by this proof — only `~/.mimers/secrets/lu-execution-authority/{root,issuer}-public.pem`.

| Required positive | Result |
|---|---|
| root authority artifact canonical hash / identity / signature-trust | **PASS** |
| delegated issuer canonical hash / identity | **PASS** |
| issuer scope = `LU_EXECUTION_AUTHORITY_V1` | **PASS** |
| issuer rooted in exact trusted root | **PASS** |
| canonical `site_id` resolved from `ProjectPropertyBindingArtifact.property_identity` | **PASS** — `lm_fastighetsytor_merged:merged:ORSASTACKMORA3:12` |
| same canonical execution subject → same `deterministic_seed` | **PASS** |
| changed `site_id` → different seed | **PASS** |
| changed project/context/release input → different seed | **PASS** |
| `ExecutionIdentity` full-body recompute | **PASS** |
| deterministic artifact identity | **PASS** |
| execution attestation | **PASS** |
| persistent CAS write | **PASS** |
| actual runtime resolver | **PASS** |
| `runLuAssessmentViaKernel` admission | **PASS** — `admitted: true` for the real golden-path subject, real CAS, zero evidence (the earlier `GOVERNANCE_DENIED: Invalid or missing Execution Identity` finding from `PRODUCT-LU-CONTEXT-AND-EVIDENCE-BINDING-V1-PROVEN.md` is closed) |
| fresh reopen, public-key-only | **PASS** — real `--verify` run in a separate process |
| private execution key absent at reopen | **PASS** |

| Required negative | Result |
|---|---|
| missing execution identity | **FAIL CLOSED** |
| wrong `site_id` | **FAIL CLOSED** (`PREDICATE_MISMATCH`) |
| caller-supplied wrong `deterministic_seed` | **FAIL CLOSED** (`PREDICATE_MISMATCH`) |
| random seed substitute | **FAIL CLOSED**; also structurally impossible — `deriveLuExecutionSeed` has no entropy parameter |
| tampered body with old `content_hash` | **FAIL CLOSED** (`CONTENT_HASH_MISMATCH`) |
| valid narrow attestation + tampered body (a field outside the attestation predicate, `references`, mutated) | **FAIL CLOSED** (`CONTENT_HASH_MISMATCH`) — proves the full-body recompute, not just the predicate, is what catches this |
| wrong project/context/release | **FAIL CLOSED** (covered by the seed-derivation and predicate checks above) |
| unsigned identity | **FAIL CLOSED** |
| unknown execution issuer | **FAIL CLOSED** (`UNKNOWN_SIGNING_KEY`) |
| issuer with wrong scope | scope is hardcoded in construction, never a caller input, and never read by `verifyLuExecutionAuthorityChain` as an authorization discriminant either — proved structurally: an attempted constructor override has zero effect on the resulting artifact's scope |
| issuer not rooted in trusted execution root | **FAIL CLOSED** (a freshly-signed rogue root/issuer chain, verified against the *real* trusted root verifier, rejects) |
| caller-selected artifact identity | **FAIL CLOSED** (`CONTENT_HASH_MISMATCH`) |

`npx tsc --noEmit`: 98 pre-existing errors, identical file set — zero new.
`npx vitest run --project unit` (execution-scoped): 56 passed, 0 failed.

## Closure

```
LU-EXECUTION-AUTHORITY-BOOTSTRAP-01
IMPLEMENTED / PROVEN
```

No implementation changes were required — the adopted commit held under the full proof contract.
Only this proof script and this document are new. `LU-PRODUCT-GOLDEN-PATH-01` may proceed
immediately: the execution-identity gate that blocked `PRODUCT-LU-CONTEXT-AND-EVIDENCE-BINDING-V1`
is closed, using the real, already-issued identity for `cmt2m7bdj0000h0f7uj4jykis` / ORSA
STACKMORA 3:12.
