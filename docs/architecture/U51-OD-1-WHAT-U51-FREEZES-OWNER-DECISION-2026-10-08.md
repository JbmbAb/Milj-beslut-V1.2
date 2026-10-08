# U51-OD-1 -- what U51 freezes (owner decision record)

**Status: DECIDED.** Not PROVEN, not VERIFIED. This record fixes the object of U51. It makes no candidate READY and freezes nothing.

| Field | Value |
| --- | --- |
| decision_id | `U51-OD-1` |
| owner | Jimmy Bruce |
| contract | `2d937d6336d73ab11d428af7d56afc6fdb38d0ee` (tree `4f2b720ae247f5e15b2040a17275353a85df0f95`), `U51-CANONICAL-MANIFEST-CONTRACT-01` R2 section 2.1 and 15 (OD-1). Not modified by this record. |
| source anchor | `a652d7b6160a62dc9fc3c5ba73a9820141b9cb6a` (tree `2ce1c2004ba3aaf324c1e3120f4b3cdd3b65d402`), branch `rt/u51-generation-absence-proof-01` |
| external spec | `U40-U50B-SPEC.md` (sha256 prefix `fa6fe270a77f3617`), sections 2.2, 2.3, 2.6, 3 and 4 |
| date | 2026-10-08 |

## 1. Decision

```
U51_MANIFEST     = FREEZE_RECORD_OF_G
U50B_RED         = SEPARATE_REQUIRED_EVIDENCE
STAGING_UI_RUN   = OUTSIDE_MANIFEST
```

1. The U51 canonical manifest is the freeze record of exactly one GREEN candidate G.
2. It freezes the candidate's commit and tree identity, its release identity, and the provider, runtime and schema identities and the evidence that
   U51 requires (contract sections 3 and 5-6).
3. The U50b RED record is a separate, REQUIRED prerequisite. It must be verified before the U51 staging run can count as GREEN. Its payload is not
   absorbed into the canonical identity domain of the manifest.
4. The logged-in staging/UI run is outside the manifest. It consumes and verifies the frozen candidate after the freeze.

## 2. How the decision was made

The owner authorised these values conditionally: record them only if the agent, after re-reading the frozen contract and the evidence, concludes they
are the best choice. The agent concluded that they are, and found no better interpretation. The authorisation was used.

## 3. Review

| Check | Result | Basis |
| --- | --- | --- |
| Does it preserve the spec's meaning of G? | **Yes.** | Spec 2.2: "GRÖN kandidat G: exakt SHA på origin", containing U40, U42a, U50a and the frozen fix set F. A frozen record of one exact commit is that object. |
| Does it avoid treating runtime success as identity? | **Yes.** | Contract 2.1: the manifest "is neither a statement that the candidate works, nor the UI run, nor a verdict". The staging run is an observation of G, not part of it. |
| Does it keep UI screenshots and runtime observations out of canonical identity? | **Yes.** | Spec 2.3 puts run id, times, proof-org id and CAS volume name in INSTANS ("får skilja sig men registreras"). Contract 3.3 forbids timestamps, hostnames, UUIDs and free text in the manifest. |
| Why can RED not be inside G's identity? | **Order and tree.** | Spec 2.2: the RED candidate R is "exakt en commit med förälder G". Spec 2.6 steps 1-4: G is landed and its release issued first, then R is built and the RED run is done. The RED record therefore depends on G and cannot be part of what G is. R's tree is not G's tree, so evidence about R can never be same-tree evidence for G (I1, I2). |
| Is the U50b RED prerequisite still enforceable? | **Yes, at the consumer.** | Spec 2.6 step 6: U51 at G "får räknas som GRÖN först när steg 4 finns på record". That is a rule on counting the staging run, so it is enforced where the run is counted, see section 4. |
| Does `product-release-v3` stay the release and composition authority? | **Yes.** | Contract 2.4: the manifest refers to the release by `artifact_id` and `release_hash_sha256`. Spec 2.3 puts the v3 id and hash and `composition_manifest_sha256` in the identity. Nothing here changes that. |

Spec 2.3 also lists a RUNTIME_ID (runtime environment hash, key ids, data census per governed layer, base image digests) that must be equal for RED and
GREEN (V7, V8). That is a property of the RED/GREEN comparison, so it belongs to the U50b record, not to G's manifest.

## 4. Where the RED prerequisite is enforced

The frozen contract has no field that carries required evidence beside the manifest: the freeze record (contract 7.5) binds the manifest, the
evidence, the policy, the subject, the verifier and the reproduction. This record does not change that.

The U51 staging run counts as GREEN only when all three hold:

- the manifest of G is FROZEN and re-verifies;
- a valid U50b RED record exists whose negative candidate has parent G (`Negative-Candidate-Of: G`, `git rev-list --parents -n1 R` = `R G`) and which satisfies
  spec 2.5 and V1-V8;
- the staging run observes the release identity of G (`/api/release`) equal to the manifest's `release`.

Binding a required-evidence hash into the freeze record would be a contract revision (R3). It is not made here.

## 5. What this record does not say

It does not say U51 is READY or FROZEN. It does not prove staging, U50b RED or product correctness. It does not answer OD-10 (embedding worker
environment), OD-11 (component lineage), OD-16 (origin reachability) or OD-2/14/15 (trust roots and gate). Because the manifest is now the freeze
record of G and spec 2.2 says G is an exact SHA on origin, the contract's own recommendation for OD-16 (`REQUIRED`) now applies. It is still the
owner's value and is not decided here.
