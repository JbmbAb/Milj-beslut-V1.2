# ADR GA-D1 — Capability Qualification Artifact v1

| Field               | Value                                                       |
| ------------------- | ----------------------------------------------------------- |
| Status              | CANDIDATE — requires independent verification before freeze |
| Unit                | `GA-D1-CAPABILITY-QUALIFICATION-ARTIFACT-V1`                |
| Base                | `2855f6c6e890f1631bb4236d64b41171ca1f3dc1`                  |
| Scope               | Build/deploy-time structural autonomy qualification only    |
| Governing invariant | GA-N1 — autonomy creates no authority                        |

## 1. Decision

Mimer SHALL separate structural capability qualification from runtime authorization.

Build/deploy-time Section D emits a `CapabilityQualificationArtifact` describing the maximum structurally proven GA level for one exact candidate/build under one exact qualification policy.

Runtime authorization is explicitly outside this artifact. A later `PERMIT(action)` contract consumes a valid qualification artifact together with request-scoped authority and runtime context.

```text
BUILD / DEPLOY
observed predicates + qualification policy
        ↓
CapabilityQualificationArtifact
        ↓
qualified_level

RUNTIME
CapabilityQualificationArtifact
+ action
+ authority context
+ revocation state
+ runtime validity
        ↓
PermitDecisionArtifact
```

`qualified_level` is a structural ceiling. It is never an authorization grant.

## 2. GA-N1 hard separation

The qualification artifact has scope:

```text
STRUCTURAL_CAPABILITY
```

The build-time qualification engine accepts only blockers that can legitimately describe structural qualification state:

- `STRUCTURAL_BLOCKER`
- `CONFIGURATION_BLOCKER`
- `DEPENDENCY_BLOCKER`

The following classes MUST NOT be frozen into structural qualification truth:

- `AUTHORITY_BLOCKER`
- `REVOCATION_BLOCKER`
- `RUNTIME_TRANSIENT`

`AUTHORITY_BLOCKER` and `REVOCATION_BLOCKER` belong to the runtime authority gate. `RUNTIME_TRANSIENT` belongs to retry/reconcile execution semantics and must not become a durable architectural ceiling.

This prohibition is enforced both when the artifact is created and when an existing artifact is replay-validated. A hash-valid artifact containing a forbidden runtime blocker is invalid GA-D1 structural truth.

## 3. Artifact contract

Canonical schema identifier:

```text
capability-qualification/v1
```

Artifact type:

```text
capability_qualification
```

Derivation version:

```text
qualification-engine/v1
```

Canonicalizer:

```text
rfc8785-sha256-v1
```

The artifact binds at minimum:

```yaml
artifact_type: capability_qualification
artifact_id: <assigned by governing identity authority>
content_hash: <canonical SHA-256>
references:
  - artifact_id: <proof artifact>
    artifact_type: <proof type>

payload:
  schema_version: capability-qualification/v1
  qualification_scope: STRUCTURAL_CAPABILITY

  subject:
    repository: JbmbAb/Milj-beslut-V1.2
    candidate_sha: <exact 40-char SHA>
    build_identity: <exact build identity>
    controller_version: <qualification controller version>

  target_level: GA-L4
  qualified_level: GA-L3
  delta_qualification: 1

  predicates:
    - predicate_id: runtime_wiring_verified
      result: FAIL
      evidence_refs:
        - artifact_id: <proof>
          artifact_type: <proof type>
      blocker:
        class: STRUCTURAL_BLOCKER
        code: RUNTIME_WIRING_NOT_PROVEN

  qualification_policy_version: ga-policy/v1
  qualification_policy_hash: <sha256:64-hex policy hash>
  derivation_version: qualification-engine/v1
  evaluator_hash: <sha256:64-hex evaluator hash>
```

## 4. Derived fields are not caller authority

`qualified_level` and `delta_qualification` SHALL be derived from predicates + policy.

They are not accepted as free caller-provided decisions.

Replay invariant:

```text
derive(target_level, predicates, qualification_policy)
  == qualified_level
```

and:

```text
ordinal(target_level) - ordinal(qualified_level)
  == delta_qualification
```

Failure of either equality invalidates replay.

## 5. Level monotonicity

GA levels are ordered:

```text
GA-L0 < GA-L1 < GA-L2 < GA-L3 < GA-L4
```

Requirements are cumulative. Qualification at L4 requires all requirements for L0 through L4, not only predicates newly introduced at L4.

The v1 policy model is total and fail-closed: every GA level from L0 through L4 MUST have an explicit requirement array. Missing levels, malformed requirement arrays, empty predicate identifiers, and duplicate policy requirements are invalid policy inputs rather than implicit empty requirements.

This prevents a higher-level proof from masking a missing lower-level foundation.

## 6. Exact-candidate binding

Qualification is bound to one exact normalized 40-character hexadecimal candidate SHA.

A qualification artifact for candidate A MUST NOT be reused as qualification authority for candidate B.

Changing candidate SHA, build identity, controller version, policy identity, evaluator identity, predicates, blocker classification, proof references, or externally assigned artifact id changes canonical content and therefore the content hash.

## 7. Determinism

Predicate order and evidence-reference order are normalized before hashing.

Equivalent observations presented in different input order MUST produce the same normalized payload and canonical content hash when all identity-bearing inputs are otherwise equal.

Duplicate predicate ids are rejected. Unknown blocker classes are rejected positively; the runtime JavaScript boundary MUST NOT rely on TypeScript unions as validation.

## 8. Identity boundary

`mps-compliance` does not own artifact-id authority.

Therefore GA-D1 does not manufacture `artifact_id`. The governing identity authority supplies it to the artifact constructor.

The qualification engine owns:

- structural derivation
- normalization
- canonical content hashing
- replay validation

It does not own:

- issuance authority
- runtime authorization
- revocation authority
- remediation execution

## 9. Replay verifier boundary

Replay is a verifier boundary, not merely a recomputation of `qualified_level`.

A replay-valid artifact MUST satisfy all of the following:

- exact artifact type, schema version, structural scope, and derivation version
- externally assigned non-empty artifact id
- exact normalized 40-character candidate SHA
- non-empty repository, build identity, and controller version
- valid `sha256:<64 hex>` policy and evaluator identities
- complete fail-closed L0-L4 policy shape
- normalized predicates with only structural blocker classes
- references equal to the normalized predicate evidence-reference set
- canonical SHA-256 content hash over the complete artifact body
- deterministic `qualified_level` and `delta_qualification` under the supplied matching policy

A caller cannot make an otherwise invalid artifact replay-valid merely by recomputing its content hash. Structural schema and GA-N1 invariants are independently revalidated during replay.

## 10. Signature / attestation semantics

A `CapabilityQualificationArtifact` is canonical proof content, but SHALL NOT be treated as authoritative merely because its content hash is valid.

Authoritative consumption requires a separate trusted attestation/signature envelope issued by the designated qualification authority.

That attestation MUST bind at least:

```text
artifact_id
content_hash
artifact_type = capability_qualification
subject.candidate_sha
qualification_policy_version
qualification_policy_hash
derivation_version
```

A valid cryptographic signature over unrelated qualification content is insufficient.

The signing key, trust policy, revocation semantics, and trusted-time semantics remain outside GA-D1 implementation and must reuse an existing platform attestation authority or be introduced by a separately governed unit. GA-D1 does not create a new signing authority.

## 11. Section E boundary

`CapabilityRemediationArtifact` is deliberately separate from `CapabilityQualificationArtifact`.

Qualification records truth. Remediation records a derived plan.

```text
CapabilityQualificationArtifact
        ↓
Section E deterministic derivation
        ↓
CapabilityRemediationArtifact
```

A change in remediation policy must not mutate or force reissuance of otherwise unchanged qualification truth.

Section E MUST NOT generate technical privilege-escalation remediation from:

```text
AUTHORITY_BLOCKER
REVOCATION_BLOCKER
```

Those classes require external authority change / reauthorization and belong to runtime governance.

## 12. Runtime boundary

The next contract is `GA-D2-RUNTIME-PERMIT-CONTRACT-V1`.

It shall evaluate a concrete action, not grant a generic autonomous mode:

```text
PERMIT(action_request, qualification_artifact, authority_context)
  -> PermitDecisionArtifact
```

Conceptually:

```text
required_level(action)
qualified_level
current authorized level
runtime ceiling
revocation state
        ↓
ALLOW / DENY + effective_level
```

D1 MUST NOT implement or infer this runtime decision.

## 13. Section E ordering

The intended governance sequence is:

```text
GA-D1  CapabilityQualificationArtifact
  ↓
GA-D2  Runtime PERMIT(action) contract
  ↓
GA-E1  Deterministic remediation derivation
```

This ordering prevents Section E from becoming an autonomy optimizer that treats denied authority as an engineering defect.

## 14. Required verification

Independent verification of GA-D1 must attack at least:

1. caller attempts to choose `qualified_level`
2. L4 passes while a lower-level required predicate fails
3. authority/revocation blockers injected into structural qualification
4. runtime transient injected into frozen qualification
5. unknown blocker class injected at the runtime boundary
6. duplicate predicate ids
7. predicate order permutation
8. evidence reference order permutation
9. candidate SHA substitution and malformed candidate SHA
10. policy version/hash substitution and malformed policy hash
11. incomplete/malformed L0-L4 policy shape
12. evaluator identity substitution
13. derivation-version substitution
14. qualified-level/delta tampering
15. evidence-reference tampering without rehash
16. hash-valid artifact containing forbidden runtime blocker contamination
17. hash-valid artifact whose references do not match predicate evidence
18. replay under a different policy
19. attempt to treat unsigned/unattested artifact as authority

## 15. Non-goals

GA-D1 does not:

- grant runtime permission
- create authorization
- implement revocation
- implement runtime retry
- generate remediation plans
- execute remediation
- create or rotate signing keys
- promote code
- change DEV-GOV, branch protection, rulesets, or environments

It only defines and derives structural qualification truth for an exact build candidate.
