# AUTHORITY-CHAIN-PROMOTION-01 — PRE-FREEZE CANDIDATE RECORD

**Status:** PRE-FREEZE / BLOCKED ON INHERITED BASELINE EXECUTION  
**Promotion base M:** `406842dd21e69f779c412fc2ae814616ac840ba8`  
**Authority source A:** `43ea32804cfa288b34051b6874185077a6ec3c50`  
**Merge convergence C1:** `9f30527df2f058616bd4751dd7994d0184e39763`

This record deliberately contains no C2 SHA. C2 is created only after the inherited baseline commands have been executed at A and the pre-freeze checks below are satisfied.

## 1. Scope

AUTHORITY-CHAIN-PROMOTION-01 promotes the already-proven authority chain from the audit line onto current main without changing authority semantics.

The promotion claim is intentionally narrow:

> Dev-Gov trusted proofs prove byte identity and regression preservation on one exact candidate SHA. Historical merge topology is verified separately by producer and owner from a full Git graph.

No promotion proof may claim that shallow trusted execution proves ancestry or merge topology.

### 1A. 03B 21-file path-history check

The 21-file set is the exact diff `0d7b2bd566b0d5f7c9d27d645c941acd66cb1e85..b5d8c7a2300de74892cdc36396eac5474ac0d625`.

Path-history verification from `b5d8c7a2...` through A gives:

- **11** paths touched by at least one later commit;
- **10** paths never touched again.

This count is based on commit/path history, not final-tree blob equality. A path changed and later restored still counts as touched.

## 2. C1 convergence topology — VERIFIED_FROM_GIT

C1 is a two-parent merge commit with ordered parents:

1. M = `406842dd21e69f779c412fc2ae814616ac840ba8`
2. A = `43ea32804cfa288b34051b6874185077a6ec3c50`

C1 tree: `fc5fe44b8ae1a92a783754875310eb6f83fe2f8f`.

Verified tree deltas:

- `M -> C1`: exactly **62 authority-source paths**.
- `A -> C1`: exactly **3 main-only Dev-Gov paths**:
  - `.github/workflows/devgov-v0-orchestrate.yml`
  - `governance/devgov/units/devgov-orchestrator-explicit-repo-dispatch-v1.json`
  - `governance/devgov/units/devgov-orchestrator-explicit-repo-watch-v1.json`

The full 62-path manifest and individual Git blob IDs are frozen in
`AUTHORITY-CHAIN-PROMOTION-01-SOURCE-MANIFEST.json`.

## 3. Frozen byte-digest semantics

For each frozen path, sorted using JavaScript's default string sort:

```text
blob_sha = SHA1(
  UTF8("blob " + byte_length(file_bytes) + "\0")
  || file_bytes
)

record_i =
  UTF8(path)
  || 0x00
  || ASCII(blob_sha_hex)
  || 0x0a

aggregate =
  SHA256(record_1 || ... || record_n)
```

Frozen authority-source digest (62 paths at A):

```text
5f852a98f110d6c5c6a2a1eff3667928e214c8384541e564a6d724680efadd7c
```

Frozen main-only preservation digest (3 paths at M):

```text
45f0d902730f000c39b1c14d7debed10f69e5f23db21a5ea55a1ee17bfbc7949
```

The trusted unit embeds both path arrays and expected digests directly in command args. It MUST NOT read the manifest to discover expected values.

## 4. Candidate record contents

The eventual C2 candidate record may contain only:

- M;
- A;
- C1;
- source manifest;
- authority-source aggregate digest;
- main-only preservation digest;
- historical matrix;
- proof contract;
- `status = PROMOTION_CANDIDATE`.

It MUST NOT contain its own C2 SHA.

C2 SHA belongs only in the producer report, PR description, Dev-Gov dispatch input, and the later PROVEN record.

## 5. Mandatory workflow reconnaissance before proof design

Before freezing C2, the producer MUST read the protected `.github/workflows/devgov-v0-attest.yml` used by the controller.

Current verified constraints:

- proof/execution checkouts use the default shallow checkout depth;
- trusted proof commands therefore MUST NOT depend on commit ancestry/history;
- proof execution runs as `devgov-candidate`;
- `safe.directory` is configured under a different OS identity and MUST NOT be relied on by proof commands;
- trusted proof commands MUST be file/byte based and Git-free.

## 6. Trusted RED/GREEN A — authority source identity

The promotion unit contains one inline `node -e` proof with the frozen 62 paths and expected digest in its args.

- RED runs the same command at M and MUST return exit 1 / `FAIL`.
- GREEN runs the same command at C2 and MUST return exit 0 / `PASS`.
- No `git` invocation, `.git` inspection, network access, or candidate-controlled manifest input is permitted.

The failing RED property is the byte identity itself, not absence of a candidate-only helper test.

## 7. Trusted GREEN B — preserved main-only blobs

A second inline `node -e` proof runs only on C2 and requires byte identity with the three main-only files at M.

Expected aggregate:

`45f0d902730f000c39b1c14d7debed10f69e5f23db21a5ea55a1ee17bfbc7949`.

This proves the authority promotion did not overwrite the Dev-Gov fixes present only on main.

## 8. Git history evidence outside trusted execution

Before C2 freeze, the producer MUST verify from a full clone and record `VERIFIED_FROM_GIT` evidence for:

- C1 has exactly parents M and A;
- `af8fc602502045e34387f71e0e8d2ad71d48c7e0` is an ancestor of C1;
- A is an ancestor/parent of C1;
- M -> C1 is exactly the frozen 62 paths;
- A -> C1 is exactly the three main-only paths;
- C1 -> C2 contains only the three promotion metadata files;
- authority-source blobs in C1/C2 equal A;
- main-only blobs in C1/C2 equal M.

Dev-Gov gate-native checks remain responsible for `descendant_of_base`, changed-path containment, allowed/forbidden paths, exact candidate SHA, and trusted command attestations.

## 9. Evidence classification

Knowledge source and historical state are independent axes.

```text
evidence_source:
  VERIFIED_FROM_GIT
  VERIFIED_FROM_API
  REPORTED_UNVERIFIED

historical_state:
  PROVEN
  IMPLEMENTED_UNPROVEN
  SUPERSEDED_FAILED
  UNGATED
  UNKNOWN
```

Historical matrix at pre-freeze:

| Unit | Exact candidate | evidence_source | historical_state | Evidence |
|---|---|---|---|---|
| 03B | `e5584d8a087962ce6a9fa6249c11e352b1cab9c5` | VERIFIED_FROM_API | PROVEN | DEV-GOV success run 35051848055 |
| 04A | `d3f08076c8408dff9fbb9f9fff510a3f3759a0c0` | VERIFIED_FROM_API | PROVEN | DEV-GOV success run 35053627203 |
| 04B | `e5d261385b9616e695e1e344faa54344e7e75253` | VERIFIED_FROM_API | PROVEN | DEV-GOV success run 35055579624 |
| 04C initial | `09af70554fe9b41eee856d62df6e3bd94a276a32` | VERIFIED_FROM_API | SUPERSEDED_FAILED | DEV-GOV success existed, later cold audit found semantic defects |
| 04C-R1 | `02fe470d4a3a5a6d6e0f500521a5a4cc4fcb6bba` | VERIFIED_FROM_API | PROVEN | DEV-GOV success run 35078243573 |
| 04D | `31ac9192b02874e6b804de1185f5cd8093909e84` | VERIFIED_FROM_GIT | SUPERSEDED_FAILED | audit document + later 04D-R1 cold-review closure; no exact success status |
| 04D-R1 | `abe09effc6d685058f0f13bbe9ac74b1fae94e16` | VERIFIED_FROM_GIT | SUPERSEDED_FAILED | F04 cold audit found integrity/replay defects; no exact success status |
| F04 corrected | `c2c47efaea8cb2fb38055bdd72bc2c0e55422039` | VERIFIED_FROM_API | PROVEN | DEV-GOV success run 35184423759 |
| 04E | `af8fc602502045e34387f71e0e8d2ad71d48c7e0` | VERIFIED_FROM_API | PROVEN | DEV-GOV success run 35293145008 |

A trusted status proves only the proof contract that was executed at that SHA. Later semantic review may therefore move a historical state to `SUPERSEDED_FAILED` without falsifying that the earlier trusted command ran successfully.

## 10. Inherited GREEN baseline — PRE-FREEZE BLOCKER

The promotion unit copies **all 13 historical `required_green` command specifications verbatim**.

Before C2 is frozen, the producer MUST execute all 13 at A and record:

- command id;
- exact command / args / cwd / env;
- exit code;
- result.

Classification:

```text
A PASS + C2 PASS -> regression preserved
A PASS + C2 FAIL -> PROMOTION_REGRESSION
A FAIL           -> INHERITED_BASELINE_FAILURE / BLOCKED
BLOCKED_ENVIRONMENT in trusted GREEN -> promotion BLOCKED
```

No inherited command may be silently omitted, edited, or reclassified by the producer.

**Current execution state:** BLOCKED_PENDING_LOCAL_BASELINE because the authorized Mimer machine is offline. C2 MUST NOT be frozen while this remains unresolved.

## 11. Promotion unit

Canonical unit path:

`governance/devgov/units/authority-chain-promotion-01-v1.json`

It contains:

- 1 trusted RED command: authority-source byte identity at M;
- 2 new trusted GREEN commands: authority-source identity + main-only preservation;
- 13 inherited GREEN commands copied verbatim;
- exact allowed paths: 62 authority paths + 3 promotion metadata files;
- explicit forbidden workflow/controller/schema paths.

No helper script under `scripts/audit` exists or is required.

## 12. Producer report requirements

The producer report MUST separately state:

- `evidence_source`;
- `historical_state`;
- full-clone Git topology results;
- inherited baseline results at A;
- exact frozen C2 SHA;
- C1 -> C2 changed paths;
- source and main-preservation digest results;
- local preflight result;
- Dev-Gov orchestrator ID;
- canonical gate ID;
- exact commit status context.

The report MUST NOT collapse Git-topology evidence and trusted execution evidence into one claim.

## 13. Owner checklist after GATE_PASSED

1. Independently verify C1's two parents, ancestry, and both tree diffs in a full clone.
2. Merge the promotion PR using **merge commit** only. Squash and rebase are forbidden.
3. Immediately verify `tree(main_merge_sha) == tree(C2)`.
4. If main moved after M or GitHub produces a different integration tree, inherited gate evidence does not apply: create a new candidate and rerun the gate.
5. Verify exact `DEV-GOV-V0 / trusted-execution = success` for C2.
6. Open a separate document PR adding `docs/architecture/audits/AUTHORITY-CHAIN-PROMOTION-01-PROVEN.md` containing C2, promotion PR, merge SHA, merge tree, orchestrator run ID, canonical gate run ID, and final state.
7. The PROVEN-document PR must itself follow main protection. No direct owner commit may bypass the process.

## Stop conditions

Stop and report BLOCKED if any of the following occurs:

- inherited baseline failure at A;
- trusted command becomes `BLOCKED_ENVIRONMENT`;
- C1 topology differs from the frozen result;
- C1 -> C2 touches anything outside the three metadata files;
- either aggregate digest differs;
- any inherited A-PASS command fails on C2;
- main moves relative to M before merge;
- merge result tree differs from C2.

