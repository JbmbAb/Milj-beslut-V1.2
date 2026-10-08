# U51 entrypoint composition model -- design (D)

**Status: DESIGN, written by the coordinator, NOT independently reviewed.** It decides nothing and changes no file outside this document. Any
classification below is a proposal for the owner. Nothing here is VERIFIED, PROVEN or READY.

Anchor: `f196d278886a42f0b98af22aeb66b524885b1743` (no-google closure `b549c4be` plus the U51 proof unit). Release line inspected read-only:
`rt/u42c` @ `ee35bb14a304b7b721df47b25cddccd36359fde5` (authoritative `product-release-v3`, W-U42C), `rt/integration-u51` @ `732b3eef…` (NON_CANONICAL).
Contract: `2d937d6336d73ab11d428af7d56afc6fdb38d0ee` section 5.3 (entrypoint set "derived from the release composition ... web plus each worker").

## 1. The problem, with the facts

The composition manifest hashes only `Dockerfile`, `.dockerignore` and `deploy/onprem/**`. Today those files describe the production processes in
four different, non-identical ways:

| Source (bound by the composition hash) | Processes it names |
| --- | --- |
| `Dockerfile` `CMD` lines | `web` (`npm start`), `gdpr-maintenance`, `search-indexer`, `domstol-rss` |
| `Dockerfile` comments (not commands) | four LU workers (`lu-project-context-bootstrap`, `lu-execution-identity-v3`, `lu-viewer-capability`, `lu-geometry-supersession`) |
| `deploy/onprem/image-smoke/smoke.mjs` `ENTRYPOINTS` | `server/index.ts` plus the same four LU workers |
| `deploy/onprem/docker-compose.lu.yml` (`rt/integration-u51` only) `command:` | `web` plus the four LU workers through `npm run worker:lu-*`; no gdpr, search or domstol |

The contract's rule "the distinct command/CMD entrypoints of the files bound by the composition hash" would therefore silently drop the four LU workers
(comments are not commands) and could not tell whether gdpr, search and domstol belong to the on-prem stack. A subset is exactly what the contract forbids.

Two more facts shape the design. Of the files in `server/workers/`, the self-starting ones are `domstol-rss`, `gdpr-maintenance`, the four `lu-*`,
`search-indexer`, **`municipality-polling-worker.ts` and `run-all.ts`**. The last two are declared in no `Dockerfile` and no `package.json` script
(`run-all.ts` documents a `worker:all` script that does not exist). Also, `server/index.ts` starts the registry workers in-process when
`START_WORKERS_IN_PROCESS` allows it (default off in production), so those run inside the `web` process.

## 2. Proposal: one machine-readable, composition-bound enumeration

Add one file under a composition-bound path, for example `deploy/onprem/entrypoints.json` (schema id `u51-entrypoints-1`). It is covered by
`composition_manifest_sha256` automatically, so the release identity binds it without a contract change.

```
entries[]   sorted by id, closed keys:  { id, role: "web" | "worker", argv[], entry_file }
not_production[]  sorted by entry_file: { entry_file, reason }
```

- `argv` is the exact command the process is started with (`["npm","start"]`, `["npx","tsx","server/workers/gdpr-maintenance-worker.ts"]` ...).
  `entry_file` is the repository file that argv ultimately runs (for `npm run X` the file named by the `package.json` script).
- `not_production` is the explicit negative list: a self-starting file that is deliberately not a production process, with a written reason.

## 3. Derivation and consistency rule for the proof

The entrypoint set is exactly `entries[]`. The adapter derives it from the subject tree and then cross-checks; **any mismatch is NOT_EXECUTED, never a
partial set and never a PASS**:

1. every `CMD` in the `Dockerfile` and every `command:` in a bound compose file resolves (through `package.json` scripts where needed) to an `entry_file`
   that is in `entries[]`;
2. every `entries[]` item is launched by at least one bound source (no entry that nothing starts);
3. every self-starting file under `server/workers/` (and `server/index.ts`) is in `entries[]` or in `not_production[]`;
4. no file is in both lists; the file exists in the subject tree.

`entrypoint_set.derived_sha256 = SHA256(JCS(entries sorted by id, each { id, argv, entry_file }))`; `claimed_sha256` is the hash of what the boot probe
actually probed. The in-process registry workers are covered by probing `web`; the model states that explicitly in `role` documentation, not by extra entries.

## 4. Where it lands

A new file under `deploy/onprem/` changes the composition hash and the release identity, so it belongs in the release reconciliation unit (D), on top of
`rt/u42c`, not in U51-CORE-01 and not in the dynamic-import unit. D also needs the owner's go for the merge of `b549c4be` and `rt/u42c` (a dry-run shows one
textual conflict, `tests/unit/protectedRelationGateInventory.test.ts`; semantic conflicts are not checked).

## 5. Owner questions this design cannot answer

1. `run-all.ts` and `municipality-polling-worker.ts`: production processes (add to `entries[]`, declare a launcher) or not (list in `not_production[]`)?
2. Do `gdpr-maintenance`, `search-indexer` and `domstol-rss` run in the on-prem stack? The LU compose omits them and the `Dockerfile` stages exist.
3. Which compose or Fly files are part of "the production composition"? `docker-compose.prod.yml`, `docker-compose.staging.yml` and `Dockerfile.fly` are
   not bound by the composition hash today.
4. Should the in-process registry workers stay a property of `web`, or become separate processes in production?

## 6. What this does not claim

It does not say the current composition is complete or wrong, does not add the file, does not touch the contract or any owner-decision record, and does not
make the generation boot probe runnable. It is the missing input of that probe.
