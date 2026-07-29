# Mimers Brunn v9 — NFS / shared-FS validation

**DoD status:** PROVEN (NFSv4 lab via `npm run mimers:nfs-lab`, evidence `tmp-artifacts/mimers-nfs-failover.json`).  
**Script:** `npm run mimers:nfs-proof` (`scripts/mimers/prove-nfs-failover.ts`)  
**Lab:** `scripts/mimers/nfs-lab/docker-compose.yml` · `npm run mimers:nfs-lab`  
**Related:** [runbook](./mimers-brunn-v9-runbook.md) · [Definition of Done](../architecture/mimers-brunn-v9-sovereign-definition-of-done.md)

---

## Goal

Prove that CAS + ledger remain consistent when two “nodes” (separate process views) share the same durable tree over a **network filesystem** (NFS or equivalent), including failover-style reopen after the other client wrote.

This is **not** satisfied by:

- Local NTFS/ext4 only (except as a logic smoke test)
- Docker named volumes without an NFS (or similar) export
- In-memory dual handles in one process

---

## Lab (reproducer)

```bash
npm run mimers:nfs-lab
# equivalent:
# docker compose -f scripts/mimers/nfs-lab/docker-compose.yml up -d nfs
# docker compose -f scripts/mimers/nfs-lab/docker-compose.yml run --rm proof
```

Recorded proof: platform `linux` + mount `nfs4` (`vers=4.2`), `ok: true`, `eventsAfterB: 9`, `nodeAReloadMatch: true`, `recoverStatus: CLEAN`, `externalVerifyOk: true`.

---

## Preconditions (manual / production share)

1. Shared directory mounted on the machine that runs Node (hard links must work; Mimers CAS uses `link(temp, dest)`).
2. Same filesystem for `cas/tmp` and `cas/objects` (and ledger `tmp` / segments) under the mount.
3. Prefer Linux client + `durabilityMode=best-effort` or `strict` per support matrix.

```bash
export MIMERS_NFS_ROOT=/mnt/mimers-nfs
df -T "$MIMERS_NFS_ROOT"    # confirm nfs/nfs4
npm run mimers:nfs-proof
```

Exit code `2` = `MIMERS_NFS_ROOT` missing (not a core failure).

---

## Pass criteria

| Check | Expect |
| --- | --- |
| Exit code | `0` |
| `ok` | `true` |
| `skipped` | `false` |
| `eventsAfterB` | `9` (6 from A + 3 from B) |
| `nodeAReloadMatch` | `true` |
| `externalVerifyOk` | `true` |
| `recoverStatus` | `CLEAN` |
| Evidence file | `tmp-artifacts/mimers-nfs-failover.json` |
