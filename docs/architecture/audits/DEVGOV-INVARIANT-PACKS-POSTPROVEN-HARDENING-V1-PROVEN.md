# DEVGOV-INVARIANT-PACKS-POSTPROVEN-HARDENING-V1 — PROVEN

**Final state:** PROVEN
**Promotion PR:** #188
**Gated candidate:** `f6e241d8dec0ff8dab2bcf6ec431eef63f5f860c`
**Merge commit:** `703a7f561701abc530b52a852820ddfc5c820aea`
**Merge tree:** `ee6695954856f276e792f924afe26a1f383a833c`
**Candidate tree:** `ee6695954856f276e792f924afe26a1f383a833c`

This record is introduced by its own DEV-GOV unit,
`DEVGOV-INVARIANT-PACKS-POSTPROVEN-HARDENING-PROVEN-DOC-V1`. The unit's final state takes effect
only when this record is itself admitted and merged through Dev-Gov. It does not edit or replace
the implementation record `DEVGOV-INVARIANT-PACKS-POSTPROVEN-HARDENING-V1.md`, and it does not
rewrite the historical Step-5 PROVEN record.

## Anchors

- Base before the hardening merge (`main`):
  `825a876bd8067f5307181d9033067217968892f2`.
- Gated hardening candidate:
  `f6e241d8dec0ff8dab2bcf6ec431eef63f5f860c`.
- Promotion merge:
  `703a7f561701abc530b52a852820ddfc5c820aea`.
- This PROVEN-record unit base (`main` at K-77 reconciliation):
  `0d58e83cd0b938d7fc21e43e66dff26c0f0bb305`.

`main` advanced after PR #188's merge. The implementation merge
`703a7f561701abc530b52a852820ddfc5c820aea` remains an ancestor of this record unit's base, so the
implementation delta is wholly present; this record unit still changes only this document and its
own unit definition.

## Why a post-PROVEN hardening record exists

The earlier Step-5 invariant-pack mechanism had already been admitted as PROVEN when a later cold
falsification pass against protected main found six attack classes that the live evaluator accepted
as `PASS`: F-04, F-05, F-06, F-08, F-13 and F-14.

The hardening candidate repaired those mechanisms without rewriting the historical admission. Its
candidate audit records the falsification fixtures and repairs. This record establishes only the
newer hardening's evidence chain and final merge identity.

## Trusted execution evidence

- Protected Dev-Gov orchestration run: `36398731433`.
- Canonical trusted evidence gate: `36401002711`.
- Gate result: `classification: PASS`, `proof_status: PROVEN`; job conclusion `success`.
- Required proof set: 6 proof ids — 1 RED + 5 GREEN.
- Protected controller SHA used by the orchestration/gate:
  `825a876bd8067f5307181d9033067217968892f2`.
- Gate trust-policy digest:
  `2c9ef79592495aba9dd2ddc7913e91f48b6f233b4aa35b9573848dfadec246d5`.
- Gate OIDC audience:
  `devgov-v0-gate:2c9ef79592495aba9dd2ddc7913e91f48b6f233b4aa35b9573848dfadec246d5:f6e241d8dec0ff8dab2bcf6ec431eef63f5f860c`.
- Controller-owned invariant-pack digest emitted by the gate:
  `5be20e1bff4d9fe67471804192c80c1f1072da92f31f5481c34b2c6bb84ea8c3`.
- Repository workflow `devgov-v0-gate.yml@refs/heads/main`; environment
  `devgov-attestation`; GitHub-hosted runner.
- Required commit status on the exact candidate:
  - context: `DEV-GOV-V0 / trusted-execution`
  - state: `success`
  - description:
    `Trusted RED/GREEN verified for exact candidate SHA; packs=v1:PASS:5be20e1bff4d9fe67471804192c80c1f1072da92f31f5481c34b2c6bb84ea8c3`
  - target URL: canonical gate run `36401002711`.

The implementation gate ran from protected controller SHA `825a876b…`, before the candidate's
new gate implementation was merged. Therefore the implementation gate **did not** publish the later
wording `Trusted RED/GREEN and controller-owned packs verified…`. This record binds only the
status text that was actually published by run `36401002711`.

### Trusted RED

Executed against exact base `825a876bd8067f5307181d9033067217968892f2`:

- `postproven-invariant-hardening-guards-present` — observed semantic `FAIL`, exit 1. The base had
  the existing Step-5 mechanism but lacked the declared post-PROVEN hardening guards.

### Trusted GREEN

Executed against exact candidate `f6e241d8dec0ff8dab2bcf6ec431eef63f5f860c`, all observed
`PASS`, exit 0:

- `postproven-invariant-hardening-guards-present`
- `postproven-invariant-hardening-live`
- `postproven-invariant-hardening-focused-tests`
- `postproven-invariant-hardening-full-devgov-suite`
- `postproven-invariant-hardening-targeted-format`

The GREEN set binds the hardening guards, the live invariant evaluator, focused regression tests,
the complete Dev-Gov suite and targeted formatting on the exact candidate.

## Merge topology and tree verification

PR #188 was merged with a merge commit only, pinned to exact head
`f6e241d8dec0ff8dab2bcf6ec431eef63f5f860c`. Squash and rebase were not used.

Merge commit parents:

1. `825a876bd8067f5307181d9033067217968892f2`
2. `f6e241d8dec0ff8dab2bcf6ec431eef63f5f860c`

Immediately after merge:

```text
tree(703a7f561701abc530b52a852820ddfc5c820aea)
==
tree(f6e241d8dec0ff8dab2bcf6ec431eef63f5f860c)
==
ee6695954856f276e792f924afe26a1f383a833c
```

The diff between the merge commit and the gated candidate is empty.

## Proven claims

`DEVGOV-INVARIANT-PACKS-POSTPROVEN-HARDENING-V1` proves the following mechanical protections on
the admitted implementation:

1. **F-04 / pack failure remains load-bearing.** Canonical pack verification cannot be weakened with
   `continue-on-error: true` while satisfying DG-IP-005, and final trusted-status publication
   requires the pack outcome/bindings to produce `pack_ok=true`.
2. **F-05 / candidate execution decoys fail closed.** Structural checks strip line-comment decoys
   and reject dynamic Node execution targets in the protected `pull_request_target` pack path.
3. **F-06 / protected-base binding is independently load-bearing.** DG-IP-007 requires the runtime
   equality `BASE_REF == DEFAULT_BRANCH`; event filtering alone is not sufficient.
4. **F-08 / report substitution is detected.** The canonical gate re-verifies result, registry
   version, pack-set digest, controller SHA and candidate SHA from the generated report, and final
   trusted-status success is conditioned on the corresponding bound pack outputs.
5. **F-13 / pack paths stay within controllerRoot.** Registry paths reject unsafe dot-segments and
   backslashes, and file reads enforce canonical realpath containment so traversal/symlink escape
   cannot select an external pack.
6. **F-14 / caller non-impact metadata cannot skip packs.** The protected pack execution blocks are
   structurally required to remain unconditional for the covered caller-controlled skip form.

## Non-claims

This hardening does **not**:

- modify LU, W1, W2, GIS, document, database, product, API or UI semantics;
- change the invariant registry's active pack membership;
- rewrite the historical Step-5 PROVEN record or claim that the earlier record had never been
  falsified;
- prove uniqueness of commit-status publication authority. Branch protection still keys
  `DEV-GOV-V0 / trusted-execution` to the GitHub Actions app identity rather than a unique workflow
  identity; the broader F4 status-authority problem remains a separate Dev-Gov hardening concern;
- claim that implementation gate `36401002711` used the new post-merge gate status wording. It did
  not; the exact status text is recorded above.

### Non-required PR checks at merge time

Branch protection on `main` required only `DEV-GOV-V0 / trusted-execution`, which passed. Five
non-required checks were red on PR #188 at merge time and are retained here as K-12-class
non-blocking merge evidence: `Typecheck`, `Lint`, `Format check`, `Security audit`, and
`Require staging proof in PR`. This record does not reinterpret those red checks as green.

At the same merge point, `DEV-GOV-V0 / invariant-packs`, read-only `DEV-GOV-V0` validation,
dependency review, `npm audit (high+)`, and CodeQL were green. The trusted required context was the
exact-candidate `DEV-GOV-V0 / trusted-execution` success from canonical gate `36401002711`.

## Final disposition

`DEVGOV-INVARIANT-PACKS-POSTPROVEN-HARDENING-V1 = PROVEN`

This disposition becomes authoritative only after this PROVEN-record unit itself passes trusted
RED/GREEN, its canonical gate, and merge/tree finalization.
