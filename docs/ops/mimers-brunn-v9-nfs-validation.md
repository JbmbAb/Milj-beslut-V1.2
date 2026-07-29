# Mimers Brunn v9 — NFS / shared-FS validation

**DoD status:** PARTIAL until a real multi-client mount is exercised and evidence is filed.  
**Script:** `npm run mimers:nfs-proof` (`scripts/mimers/prove-nfs-failover.ts`)  
**Related:** [runbook](./mimers-brunn-v9-runbook.md) · [Definition of Done](../architecture/mimers-brunn-v9-sovereign-definition-of-done.md)

---

## Goal

Prove that CAS + ledger remain consistent when two “nodes” (separate process views) share the same durable tree over a **network filesystem** (NFS or equivalent), including failover-style reopen after the other client wrote.

This is **not** satisfied by:

- Local NTFS/ext4 only
- Docker named volumes without an NFS (or similar) export
- In-memory dual handles in one process

---

## Preconditions

1. Shared directory mounted on the machine that runs Node (hard links must work; Mimers CAS uses `link(temp, dest)`).
2. Same filesystem for `cas/tmp` and `cas/objects` (and ledger `tmp` / segments) under the mount.
3. Prefer Linux client + `durabilityMode=best-effort` or `strict` per support matrix.

```bash
# Example
export MIMERS_NFS_ROOT=/mnt/mimers-nfs
df -T "$MIMERS_NFS_ROOT"    # confirm nfs/nfs4 (or documented shared FS)
```

---

## Procedure

```bash
npm ci
MIMERS_NFS_ROOT=/mnt/mimers-nfs npm run mimers:nfs-proof
```

**Pass criteria**

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

Exit code `2` = `MIMERS_NFS_ROOT` missing (PARTIAL, not a failure of Mimers core).

Optional: also run the matrix cell:

```bash
MIMERS_NFS_ROOT=/mnt/mimers-nfs npm run mimers:durability-matrix
```

---

## Recording PROVEN in DoD

1. Attach `tmp-artifacts/mimers-nfs-failover.json` (and CI/log URL if any).
2. Note mount type (`nfs4`, vendor, options `hard`/`soft`, sync).
3. Update DoD row **NFS/failover** → PROVEN with that evidence link.
4. Do **not** mark PROVEN from a laptop-local path alone.

---

## Suggested lab (ops-owned)

1. Export a small NFS share from a Linux host or appliance.
2. Mount on two clients (or one client with two sequential cold opens — script does cold opens).
3. Run `mimers:nfs-proof` on a client that can hard-link on the mount.
4. Archive evidence JSON + `df -T` / mount options output.
