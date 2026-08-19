# LU-V0.1-REPRODUCIBLE-GOVERNED-CHECKPOINT

> ```
> Document class:                    AUTHORITY / CHECKPOINT FREEZE
> Status:                            PROVEN / FROZEN
> Baseline:                          46c44b4
> Date:                              2026-08-19
> Scope:                             freezes LU v0.1 as a reproducible, governed
>                                     checkpoint — does NOT claim platform-wide
>                                     RC8 or global test-suite health
> ```

## What this document freezes

LU v0.1 is frozen as a **reproducible governed checkpoint**: the localization
assessment (LU) pipeline, from property/site input through to a persisted
`LocalizationAssessmentArtifact`, is proven to survive a fresh clone, fresh
dependency install, fresh disposable database, and versioned-authority spatial
provisioning — not just the state of a long-lived local worktree.

This is not a claim that the platform's full RC8 reproducibility gate is
closed, nor that the whole test suite is green. It is a claim about LU
specifically, proven on its own evidence.

## Evidence baseline

```
fresh checkout                     git clone --branch feat/p2-p3-governed-chain-reproducible
                                    (not the working worktree)
commit                              46c44b4
install                             npm ci (from lockfile)
test env                            explicit .env / .env.test, never committed
DB safety gate                      disposable-DB admission confirmed (riskguard_test)
spatial provisioning                scripts/db/provision-spatial-test-db.ts --drop
                                    (versioned DDL chain, not ad hoc)
lanes                               unit + component + compliance
result                              730 passed / 11 failed / 5 skipped (741 files)
                                    5526 passed / 11 failed / 45 skipped (5582 tests)
LU-specific failures in that run    ZERO
```

The 11 remaining test failures are enumerated in full below (§4). None of
them touch LU, admission, or the trust boundary this document freezes.

## 1. The governed admission trust invariant — FROZEN

```
Execution identity is issued by an independent authority.

LU consumer:
  - CANNOT mint an authority-issued identity
  - CAN ONLY verify one
  - fails closed when an identity is absent, unverifiable, or invalid

No bootstrap admission is reachable from the real production path.
Bootstrap admission requires an explicit capability opt-in
(MPS_LU_BOOTSTRAP_ADMIT=1) and is reachable only from declared
test/harness callers.
```

Both directions are proven, together, in the same clean-checkout run:

```
authority-issued execution identity, explicitly provisioned ahead of the run
  → resolved
  → cryptographically pre-verified (predicate bound to the exact
    identity/site/capability/release, not just "a valid signature exists")
  → admitted through RuntimeAdmissionKernel
  → LocalizationAssessmentArtifact produced

no authority-issued identity (or a self-issued / tampered one)
  → GOVERNANCE_DENIED
  → no assessment artifact
  → no verdict (bestAlternativeId undefined)
```

This is a materially different evidentiary claim than existed a few days
earlier in this same session, where `bootstrapAdmit: true` was hardcoded
unconditionally in the one production LU assessment path
(`packages/mps-lu/src/execution/LuExecutionKernelClient.ts`), so every call —
production included — self-admitted regardless of whether any real governed
admission existed. That defect (**RC8-K**) and the subsequent absence of a
real, independent issuing authority (**PROD-LU-ADMISSION-01C**, explicitly
rejected as "self-sign-then-verify in a different file") are why this
document now uses the word *governed* rather than merely *admitted*.

## 2. Checkpoint scope — what's proven

```
property / site input
  → canonical spatial query (SpatialLayerRegistry: water/ebh/protected_area
    → env.sgu_well / env.ebh_potentiellt_fororenade_omraden / env.protected_area)
  → SpatialEvidenceArtifact (honest EXISTENCE_WITHIN_DISTANCE semantics;
    geometry is null by design — no fabricated envelope, see §3)
  → LU rules (LURuleEngine)
  → governed execution admission (authority-issued identity → RuntimeAdmissionKernel)
  → LocalizationAssessmentArtifact
  → persisted / referenced assessment (CAS, WORM identity)
  → UI / Magic Moment consumer (LuWorkspace)
```

Proven end to end, in a fresh clean checkout, via:

- `packages/mps-lu/tests/HM1CGovernedAssessmentPersistence.test.ts` — real entrypoint, authority-issued identity, assessment persistence bound to outcome + attestation
- `packages/mps-lu/tests/P4ALU05RealRuntimeEntrypoint.test.ts` — real runtime entrypoint through registry resolution, production spatial provider, evidence, findings, assessment
- `packages/mps-lu/tests/HM1BRealGovernedDocumentChain.test.ts` — real governed document/fact chain into findings
- `packages/spatial-provider-postgis/tests/LUMagicMomentE2E.chain.test.ts` — full PostGIS → evidence → CAS → assessment chain, no mocks
- `tests/components/luWorkspace.magicMoment.e2e.test.tsx` — real UI → production service → real PostGIS chain
- `tests/unit/services/localizationReportService.test.ts` — the fail-closed side: no issuance → `GOVERNANCE_DENIED` → no artifact → no verdict (**not modified** to reach this checkpoint — it was already correct and stayed correct)
- `src/application/unit/P3LuVerdictTypeBoundary.test.ts` — the LU verdict type boundary compiles cleanly across its full import closure

## 3. Two defects closed on the way here, not hidden by this freeze

- **CAP-26-I1-EVIDENCE-TYPE-01** — `packages/mps-compliance/src/validators/CAP_26_I1.ts` returned bare artifact-id strings where `ValidationResult.evidence` requires `readonly ValidationEvidence[]`. Pre-existing, only surfaced once LU's admission composition pulled this file into the strictly type-checked closure. Fixed at the source, not worked around in LU.
- **LU-MAGIC-MOMENT-GEOMETRY-SEMANTICS-01** — a test asserted `geometry` must be truthy on spatial evidence; production (`SpatialProviderPostGIS.createEvidence()`, P4A-LU-S6) deliberately returns `geometry: null` for `EXISTENCE_WITHIN_DISTANCE` evidence, since a prior fabricated-envelope defect was removed. The test was stale, not the product. Fixed test-only; no synthetic geometry was reintroduced.

## 4. NOT claimed by this freeze

```
- whole-platform RC8 green
- full national spatial coverage
- complete legal/document knowledge coverage
- all optional LU enrichment capabilities available
- all historical compliance/audit suites green
```

The 11 test failures present in the same clean-checkout baseline run,
unchanged and unrelated to LU, tracked separately as platform debt:

```
scripts/audit/final-freeze-audit.test.ts               (1)
scripts/audit/master-boundary-audit.test.ts             (1)
packages/mps-compliance/package24/EVT.test.ts            (4)
packages/mps-artifact-store/tests/ReplicationAdversarial.test.ts (3)
packages/mps-artifact-store/src/tests/golden/GoldenRepositoryReplay.test.ts (1)
packages/mps-runtime/src/verification/generality/GeneralityProof.test.ts (1)
```

These must not be described as blocking LU v0.1 — the clean-checkout run
proves LU's surface is green *simultaneously* with these staying red,
unchanged across every clean-checkout run this session. They also must not
be quietly closed or reclassified by implication of this freeze; they remain
open, separately, as **RC8 platform debt**, not LU debt.

Also explicitly deferred, not claimed, and not blocking this freeze —
correctly separated by the LU-SPATIAL-COLDSTART-GAP-01 recon as enrichment
completeness, not Magic Moment critical path:

```
hydro.water_catchment            — real gap, no authored DDL creator;
                                    matters for municipality/jurisdiction
                                    resolution, not Magic Moment
env.natura2000_area               — optional enrichment, source not proven
topo10.vatten                     — likely legacy/naming drift; do not create
                                    this table; investigate redirect to the
                                    already-real VISS tables instead
env.kulturmiljo_omrade            — authored DDL exists (prisma/spatial/002),
                                    never wired into the bootstrap chain;
                                    clean, trivial future fix
env.sgu_soil_type_25k_100k        — real production data, schema-authority
                                    drift (compat view contradicts real
                                    ogr2ogr population path)
env.sgu_landslide_feature         — same class: real data once existed,
                                    canonical DDL/provenance lost
```

## 5. Next work is scoped as LU v0.2 / capability expansion, not a v0.1 condition

Candidates, not committed to: `hydro.water_catchment` + municipality/
jurisdiction correctness, or a national spatial enrichment closure pass over
§4's deferred relations. Neither blocks the existence of this checkpoint.

---

**Decision:** LU v0.1 is FROZEN as a REPRODUCIBLE GOVERNED CHECKPOINT at
`46c44b4`. Platform-wide RC8 reproducibility remains separately NOT_PROVEN,
tracked by `docs/architecture/REPRODUCIBLE-CHECKPOINT-V1.md`, and is not
superseded or closed by this document.
