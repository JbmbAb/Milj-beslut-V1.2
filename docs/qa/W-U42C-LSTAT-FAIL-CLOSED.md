# W-U42C — lstat fail-closed and missing-root contract evidence

**Status:** W-U42C WORKING — LSTAT FAIL-CLOSED + MISSING-ROOT CONTRACT FIXED; VÄNTAR CODEX REVERIFY.

## Scope

At candidate `1943e5697300d757d319c2ea1fc48ce8d2fb1ce7`, `listDeliveredFiles()` caught every `lstatSync()` error and continued. An injected `EACCES` for an enumerated `server/` directory therefore omitted its delivered file while producing a successful digest. The earlier correction made listing and metadata failures propagate, but also changed the established contract for a configured top-level root that genuinely does not exist: `listDeliveredFiles(root, ['__absent__'])` began throwing `ENOENT` rather than returning `[]`.

The correction catches only `ENOENT` from the initial `lstatSync()` of each configured root and skips that absent root. All other configured-root errors propagate. Errors while visiting an existing root, reading files, digesting entries, or reading symlinks still propagate; `exists()` still maps only `ENOENT` to `false` and propagates all other observation errors. No measurement scope or digest semantics changed.

## Regression and validation

- **Missing-root regression:** `tests/unit/productReleaseBuildIdentity.test.ts` asserts that a genuinely absent configured root returns `[]` and that mixing it with an existing root preserves the existing root's files.
- **Existing fail-closed regressions:** the enumerated-entry `EACCES` and composition-path observation-error tests remain in place.
- `node --check scripts/release/buildIdentityDigest.mjs` — **passed**.
- `git diff --check` — **passed**.
- `..\node_modules\.bin\vitest.cmd run --config vitest.config.ts --project unit tests/unit/productReleaseBuildIdentity.test.ts -t "ignores a genuinely absent configured top-level root|fails closed when lstat cannot measure an enumerated delivered entry|does not turn a composition-path lstat failure into an absent manifest"` — **blocked**: Vitest v4.1.10 started from the existing `D:\lu-rt\node_modules` dependency path, but the suite could not load because `@miljobeslut/mimers-brunn-core` is not resolvable from this worktree. No dependencies were installed.
- **Native Node adversarial harness** (PowerShell here-string piped to `node --input-type=module`) — **passed**: missing root returned `[]`; mixed roots retained the existing file; enumerated-root `EACCES` propagated; missing composition path returned `null`; composition-path `EIO` propagated.
- **Mutation/adversarial checks** — **both killed**: catch-all lstat swallowing failed the enumerated `EACCES` expectation; changing the missing-root `ENOENT` handling to throw failed the absent-root expectation.

## Docker evidence boundary

Docker A–G/F12 was **NOT rerun** for this correction. Existing Docker evidence remains bound to `1943e5697300d757d319c2ea1fc48ce8d2fb1ce7` and is not transferred to the current or corrected HEAD.

## Revision checkpoint

- Starting HEAD: `f7451fe3bca6c72d643ee07ad6d4bc91429218bc`
- Starting tree: `11bc3d003561a3122c0da9cfcec2594ea574a86e`
- Corrected tree: recorded with the completed writer change; final HEAD is reported after commit.
- Work status remains **WORKING**; this is not VERIFIED, PROVEN, or COLD_VERIFIED.
