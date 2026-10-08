# U51-OD-3 -- generation requirement (owner decision record)

**Status: DECIDED.** Not PROVEN, not VERIFIED. This record decides a policy value. It proves nothing about any candidate.

| Field | Value |
| --- | --- |
| decision_id | `U51-OD-3` |
| decision | `ABSENT_ADMISSIBLE` |
| policy field | `policy.generation_requirement = ABSENT_ADMISSIBLE` (`u51-freeze-policy-1`) |
| owner | Jimmy Bruce |
| scope | U51 generation freeze eligibility. Nothing else. |
| contract | `2d937d6336d73ab11d428af7d56afc6fdb38d0ee` (tree `4f2b720ae247f5e15b2040a17275353a85df0f95`), `U51-CANONICAL-MANIFEST-CONTRACT-01` R2 section 5.3 and 15 (OD-3). Not modified by this record. |
| source anchor reviewed | `b549c4bee84af7a7639675f5f6c131ab16b070d8` (tree `3d583df7b44cf47bf66c2ba4108bf419842c7564`) |
| date | 2026-10-08 |

## 1. Decision

U51 does not require generated text for freeze eligibility. Generation may therefore be `DECLARED_ABSENT` only when every real production
entrypoint is execution-probed and demonstrates that no local generation runtime is registered and every generation attempt fails closed with
exactly `BLOCKED_BY_LOCAL_GENERATION_RUNTIME`.

This is a U51 scope decision only. It is not a decision to abandon local generation in Mimer. A later governed unit may introduce a `BOUND`
local generation runtime.

## 2. How the decision was made

The owner authorised the value conditionally: it was to be recorded only if the implementation agent, after reading the frozen contract and the
current runtime state, concluded that it is the technically and architecturally best value for U51. The agent concluded that it is. The
authorisation was not a licence to pick the value because it is cheaper. The review behind it is section 3.

## 3. Optimality review (reviewed at the source anchor above)

| # | Question | Answer | Basis |
| --- | --- | --- | --- |
| 1 | Is generated text required to establish U51 freeze eligibility? | **No.** | The contract defines the manifest as a freeze record of a candidate's identity (section 2.1), "neither a statement that the candidate works". No invariant I1-I16 requires a capability. |
| 2 | Does `DECLARED_ABSENT` satisfy every applicable U51 invariant? | **Yes, by design, once its proof exists.** I5 is met by the explicit posture; I11 by the exact fail-closed status; I12 because the verifier selects no runtime. | Contract 5.3, C6 steps 2-3. The proof itself is a separate matter, see section 5. |
| 3 | Would `BOUND_REQUIRED` add evidence or capability that U51 itself needs? | **No.** | The LU reach contains no generation (below). `BOUND` is also unsatisfiable today: the generation registry (OD-8) does not exist, so it would end in `U51_GENERATION_IDENTITY_UNRESOLVED`. |
| 4 | Would implementing `BOUND` now widen U51? | **Yes.** | It would pull in runtime selection, model selection and download, the OD-8 registry, `runtime_implementation_sha256`, `runtime_config_sha256`, `model_snapshot_manifest_sha256` and a `generation_contract_version` that the port does not define. None of these is a U51 concern. |
| 5 | Does `DECLARED_ABSENT` preserve a later local generation capability? | **Yes.** | The posture is per candidate and the policy is an authenticated artifact whose hash is bound into every evidence record. A later candidate can be `BOUND` under a later policy. No manifest shape changes. |

Runtime facts used (read-only, at the anchor):

- LU reach: the 393-module import closure from `luReachClosure` (`tests/unit/luErrorCodeInventory.scan.mjs`) contains neither
  `server/modules/ai/generation/LocalGenerationPort.ts` nor any of the 16 non-test files that import it.
- `registerLocalGenerationRuntime` occurs in no non-test source file other than the port module. It occurs in 3 test files, which the contract
  does not count and which cannot satisfy or hide anything.
- No usable local generation runtime or generator model weights exist, and no generation-model owner decision exists.
- Without a registered runtime every generation call fails closed with `BLOCKED_BY_LOCAL_GENERATION_RUNTIME`.

## 4. What this record does not say

It does not say local generation is unnecessary to Mimer, that generation will never be implemented, that no model will ever be selected, or
that generation is VERIFIED. It does not say absence is already proven: the boot evidence does not exist yet. Under `DECLARED_ABSENT` no UI,
report or proof may present generated text as a capability of the candidate (contract 5.3, downstream constraint).

## 5. Prerequisites this decision does not remove

The policy value is decided. The absence proof stays unexecuted until all of the following hold. The state at the anchor is stated, not assumed.

- **Entrypoint set.** The contract derives it from the release composition (`composition_manifest_sha256` of `product-release-v3`). That
  content is not in the anchor tree; it exists on `rt/integration-u51` and other unmerged branches (contract D3). `Dockerfile` has the targets
  `web`, `gdpr-worker`, `search-indexer-worker`, `domstol-rss-worker` and no LU worker, while `deploy/onprem/build-image.sh` says the same image
  runs "web and the four LU workers". The anchor therefore cannot give a complete, consistent set.
- **OD-17** (non-literal dynamic imports) is open. The contract requires `nonliteral_dynamic_imports == 0`. The anchor has 6 (2 in vendored
  `public/cesium`, 4 in `server/services` and `services/`).
- **OD-1** (what U51 is) is open and blocks implementation of the verifier package.

Evidence for these counts: `U51-GENERATION-ABSENCE-PROOF-01` on branch `rt/u51-generation-absence-proof-01`.
