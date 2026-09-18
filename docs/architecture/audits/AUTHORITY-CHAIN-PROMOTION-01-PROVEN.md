# AUTHORITY-CHAIN-PROMOTION-01 — PROVEN

**Final state:** PROVEN  
**Promotion PR:** #158  
**Promotion candidate C2:** `41eea7eedbeeaf5d21935a1a0cd938bd31b9c56a`  
**Merge commit:** `f841c96d8f033379adef4228bb10f304bcb3435a`  
**Merge tree:** `4886d0f2a45f9f3a3755a18f812a40daa31f0bf0`

## Anchors

- M: `406842dd21e69f779c412fc2ae814616ac840ba8`
- A: `43ea32804cfa288b34051b6874185077a6ec3c50`
- C1: `9f30527df2f058616bd4751dd7994d0184e39763`
- C2: `41eea7eedbeeaf5d21935a1a0cd938bd31b9c56a`

## Trusted execution evidence

- Exact-A inherited baseline run: `35376158791`
- Protected Dev-Gov orchestrator: `35376548502`
- Canonical trusted evidence gate: `35377261004`
- Required commit status on C2:
  - context: `DEV-GOV-V0 / trusted-execution`
  - state: `success`
  - description: `Trusted RED/GREEN verified for exact candidate SHA`

The canonical gate was executed for the exact candidate SHA C2 and completed successfully.

## Promotion topology

C1 was verified as a two-parent merge of M and A.

- `M -> C1`: exact frozen 62-path authority-source delta.
- `A -> C1`: exact three main-only Dev-Gov paths.
- `C1 -> C2`: exact three promotion metadata files.

The promotion was merged using a merge commit only. Squash and rebase were not used.

Merge commit parents:

1. `406842dd21e69f779c412fc2ae814616ac840ba8`
2. `41eea7eedbeeaf5d21935a1a0cd938bd31b9c56a`

## Merge-tree verification

Immediately after merge:

```text
tree(f841c96d8f033379adef4228bb10f304bcb3435a)
==
tree(41eea7eedbeeaf5d21935a1a0cd938bd31b9c56a)
==
4886d0f2a45f9f3a3755a18f812a40daa31f0bf0
```

Therefore GitHub's integration result is byte-identical to the gated C2 candidate tree.

## Proven claim

AUTHORITY-CHAIN-PROMOTION-01 proves only the following:

1. The promoted authority source matches the frozen A source set byte-for-byte under the declared digest contract.
2. The three main-only Dev-Gov files from M were preserved byte-for-byte.
3. The current inherited regression set selected from exact-A baseline evidence passed on exact C2.
4. The protected Dev-Gov controller signed the declared RED/GREEN executions.
5. The canonical gate published `DEV-GOV-V0 / trusted-execution = success` for exact C2.
6. The final main merge tree is exactly equal to the gated C2 tree.

This record does not redefine authority semantics and does not retroactively change the historical state of superseded units.

## Final disposition

`AUTHORITY-CHAIN-PROMOTION-01 = PROVEN`

The authority-chain promotion is closed. Further LU work may rely on the promoted authority boundary as a proven mainline invariant, subject to later changes being governed normally.
