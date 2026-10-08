# U51-OD-10 and U51-OD-11 -- the last manifest-shape decisions (owner decision record)

**Status: DECIDED.** Not PROVEN, not VERIFIED. These two decisions close the Step-0 shape gate of the frozen contract. They make no candidate READY and
freeze nothing.

| Field | Value |
| --- | --- |
| decision_ids | `U51-OD-10`, `U51-OD-11` |
| owner | Jimmy Bruce (decision text relayed in the session on 2026-10-08) |
| contract | `2d937d6336d73ab11d428af7d56afc6fdb38d0ee` (tree `4f2b720ae247f5e15b2040a17275353a85df0f95`), `U51-CANONICAL-MANIFEST-CONTRACT-01` R2 sections 3.3, 14 (step 0) and 15. Not modified by this record. |
| source anchor | `f196d278886a42f0b98af22aeb66b524885b1743` (tree `5627d21a5158642d64f824b1e1e2aa85d579e0a9`), branch `rt/u51-generation-absence-proof-01` |
| related records | `U51-OD-1`, `U51-OD-3`, `U51-OD-17` in this directory |
| date | 2026-10-08 |

## 1. Decisions

```
OD-10 = NO
OD-11 = COMPONENT_LINEAGE_OUTSIDE_MANIFEST   (YES: lineage stays outside)
```

**OD-10 -- NO.** The concrete execution environment of the embedding worker (Python, Torch, device, runtime device) is not part of the identity
domain of the U51 v1 manifest. It may be bound in separate execution or reproducibility evidence, or by a later manifest version. U51 v1 explicitly
accepts the limitation the contract states.

**OD-11 -- component lineage outside the manifest.** Component lineage stays outside the U51 manifest and is derived from git and verified there. The
candidate commit and tree are the canonical code identity. No duplicated lineage fields are introduced.

## 2. Reasoning

- **OD-10.** Putting the numeric execution environment into the manifest would make one git tree plus one model snapshot into different candidates
  depending on the host that ran them. For a freeze record of G (OD-1) that is the wrong level. The manifest already binds the canonical embedding
  identity: model, exact revision, pipeline, dimension, normalization, query and passage prefix, maximum sequence length, the snapshot manifest and the
  registry, admission and selection evidence (contract 3.2, 5.4).
- **Boundary that matters.** A pipeline-defined dtype is part of the model definition. Which CUDA, Torch or device combination happened to execute it is
  not. At the anchor the registry entry of the admitted pipeline carries `dtype` (`float32`), documented as "the runtime must report exactly this
  dtype, it is never a free worker choice". The contract hashes the entire registry entry (`pipeline_spec_sha256`), so that dtype is bound through the
  pipeline spec, although the manifest has no separate field for it. The contract's table row that lists "dtype" under the worker environment was written
  against a registry without a dtype field; this record reads the boundary as above.
- **OD-11.** The candidate commit and tree bind exact content, and ancestry is deterministically derivable from git. A second lineage representation
  inside the manifest would be two competing forms of the same fact.

## 3. Effect on the contract

The contract classed both as shape-defining and as blocking implementation step 1 (section 14 step 0, section 15: "OD-1, and OD-10/OD-11 where the owner
wants a shape change"). Both are answered **without** a shape change, so:

- the manifest shape of contract section 3.2 stands for `u51-canonical-manifest-1`; no field is added;
- the Step-0 shape gate is closed together with U51-OD-1. Implementation steps 1-8 of section 14 are no longer blocked by an open owner shape decision;
- steps 9-15 (real zero-google, embedding, schema, generation and release adapters, policy and trust roots, freeze) keep their own blockers and are
  unaffected.

## 4. What this record does not say

It does not say U51 is READY or FROZEN, that embedding numerics are reproducible across hosts, or that the embedding worker environment is irrelevant. It
does not change the runtime identity checks of `LocalEmbeddingProvider`. It does not decide OD-2, 4, 5a, 5b, 6, 7, 8, 9, 12, 13, 14, 15 or 16. Adding
the worker environment or lineage to a manifest later is a new `contract_version`, not an edit of this one.
