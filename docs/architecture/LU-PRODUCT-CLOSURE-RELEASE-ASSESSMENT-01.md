# LU-PRODUCT-CLOSURE-RELEASE-ASSESSMENT-01

**Purpose:** state, precisely and without inflation, exactly which product claims the now-proven
LU golden path actually carries — and which it does not. This closes the authority-bootstrap
sequence (`LU-EXECUTION-AUTHORITY-BOOTSTRAP-01`, `PRODUCT-LU-CONTEXT-AND-EVIDENCE-BINDING-V1`,
`LU-PRODUCT-GOLDEN-PATH-01`, all `IMPLEMENTED / PROVEN`) and reorients subsequent work toward
breadth rather than further authority units.

## The proven chain

```
authenticated project
→ verified ProjectContextBinding
→ canonical property/context
→ canonical geometry
→ governed evidence
→ verified ExecutionIdentity
→ ExecutionKernel
→ genuine ASSESSED verdict
→ persisted LocalizationAssessmentArtifact
→ verified ViewerIdentity
→ verified ProductViewerCapability
→ fresh reopen
→ replay without PostGIS dependency
```

Run for real, against the real Mimer CAS and the real product database. Full evidence in
`LU-EXECUTION-AUTHORITY-BOOTSTRAP-01-PROVEN.md`, `PRODUCT-LU-CONTEXT-AND-EVIDENCE-BINDING-V1-PROVEN.md`,
`LU-PRODUCT-GOLDEN-PATH-01-PROVEN.md`.

## The two invariants that make this claim real, not test-shaped

1. **`ExecutionIdentity` is not caller-/UI-derived.** `site_id` and `deterministic_seed` come from
   the canonical execution tuple (`property_identity`, project/property/context-binding refs,
   release ref + hash, rule-registry snapshot) via `deriveLuExecutionSeed()` — never from the
   UI-facing site-alternative label a caller can set.
2. **Replay is not live-source recomputation.** `DefaultReplayEngine.replay()` reopens persisted
   state from CAS and the in-memory execution attempt; it has no PostGIS or spatial-provider
   dependency in its signature or implementation. A replayed outcome is not a re-run against
   live data — it is the same decision reopened.

## Two real blocking defects closed during proof, not cosmetic

- `verifyProjectContextBindingArtifactAuthority` verified the issuer but never recomputed the
  canonical content_hash of the binding artifact itself — a payload field outside the attestation
  predicate (e.g. `geometry_ref`) could have been tampered without detection. Closed with
  `validateProjectPropertyBindingArtifact` (new) wired into the authority check.
- The viewer-identity/viewer-capability issuer keys from the earlier unit were generated
  in-process and never persisted — the resulting artifacts were unverifiable and non-reopenable
  outside the single script run that minted them. Closed with real, persisted keypairs and a
  fresh capability/identity pair.

Both were found by actually running the proof against real data, not by inspection.

## Claims matrix

```
LU_PRODUCT_GOLDEN_PATH = PROVEN

PROPERTY:
ORSA STACKMORA 3:12 (project cmt2m7bdj0000h0f7uj4jykis)

PROVEN:
- authenticated real product project path (no lu-workspace / synthetic-project fallback)
- canonical context resolution (no proj-*/prop-*/geom-* fabrication)
- governed spatial evidence (real PostGIS-backed provider query, real canonical geometry)
- canonical execution identity (site_id + deterministic_seed from the canonical tuple, not UI input)
- persisted assessment (real LocalizationAssessmentArtifact, outcome, attestation)
- viewer capability chain (verified ViewerIdentity + ProductViewerCapability, real persisted keys)
- public-key-only fresh reopen (separate process, no private key material present)
- source-free replay (DefaultReplayEngine has no live-source dependency)

NOT IMPLIED:
- national coverage (proven for exactly one property)
- high legal/document coverage (document-evidence path exercised structurally; this run's
  finding_ids was empty -- no governed document evidence was supplied)
- all LU rules/domains (only the rules the single real run's evidence set could trigger were
  exercised; the rule engine's broader domain coverage is untested by this claim)
- production BankID owner proof (the authenticated actor in this proof chain is the platform's
  admin-console/service identity, not a real BankID-verified human owner -- see
  PRODUCT-ADMIN-AUTHORITY-BOOTSTRAP-01-PROVEN.md's own frozen scope note on this same distinction)
- all properties (no claim is made about any property other than ORSA STACKMORA 3:12)
- upstream data-source health (NVR/RAA/VISS/SGU calls surfaced real errors during the proof run,
  captured as warnings -- those data-source/schema gaps are unresolved, not silently absorbed)
```

## Maturity classification

```
LU PRODUCT GOLDEN PATH
PROVEN

LU HIGH MATURITY
CANDIDATE — requires broader regression/operational coverage before this label is earned

LU HIGH COVERAGE
NOT PROVEN
```

`PROVEN` here means: the vertical slice is real, authority-verified, and reproducible for one real
property end to end. It does not mean the LU domain is broadly hardened, that most properties will
succeed the same way, or that the surrounding data sources are healthy. Those are the next body of
work, and they are breadth work — more real properties, more layers, document coverage, rule
coverage, regression suites — not further authority bootstrapping unless a new, concrete gap
surfaces.

## Closure

```
LU-EXECUTION-AUTHORITY-BOOTSTRAP-01               IMPLEMENTED / PROVEN
PRODUCT-LU-CONTEXT-AND-EVIDENCE-BINDING-V1         IMPLEMENTED / PROVEN
LU-PRODUCT-GOLDEN-PATH-01                          IMPLEMENTED / PROVEN
LU-PRODUCT-CLOSURE-RELEASE-ASSESSMENT-01           IMPLEMENTED / PROVEN (this document)

LU PRODUCT GOLDEN PATH: PROVEN
LU HIGH MATURITY: CANDIDATE
LU HIGH COVERAGE: NOT PROVEN
```

Next work is breadth: additional real properties through the same proven chain, document/evidence
coverage, rule-domain coverage, and operational regression — not new authority units, unless proof
against real data surfaces a concrete new gap.
