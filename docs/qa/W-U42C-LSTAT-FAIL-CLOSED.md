# W-U42C — lstat fail-closed blocker evidence

**Status:** W-U42C WORKING — LSTAT FAIL-CLOSED BLOCKER FIXED; VÄNTAR CODEX REVERIFY.

## Scope

At candidate `1943e5697300d757d319c2ea1fc48ce8d2fb1ce7`, `listDeliveredFiles()` caught every `lstatSync()` error and continued. An injected `EACCES` for an enumerated `server/` directory therefore omitted its delivered file while producing a successful digest. The `exists()` helper also converted non-absence metadata failures into a `null` composition manifest.

The correction propagates listing errors and only treats `ENOENT` as absence when checking whether the optional composition manifest exists. File reads and digest-time `lstat` calls already propagated their errors and remain unchanged. Measurement scope, exclusions, node_modules byte measurement, and symlink target representation are unchanged.

## RED → GREEN

- **RED test commit:** `e7380c40018e363dd15e16c357ab00102ba3ae0b` — deterministic `EACCES` regression for an enumerated delivered entry.
- **Reproduction at candidate HEAD:** a temporary tree contained `server/must-be-measured.ts` and `src/included.ts`; injected `EACCES` at `lstat(server)` returned success with `file_count: 1` and listed only `src/included.ts`. The server file was omitted from the digest.
- **GREEN implementation commit:** `535a05a9212f2a18ecc780cc9561ba3c5c9c965d` — fail-closed listing and metadata checks, plus regressions for delivered-root and composition-path failures.
- `node --check scripts/release/buildIdentityDigest.mjs` — **passed**.
- `git diff --check` — **passed**.
- `.\node_modules\.bin\vitest.cmd run --config vitest.config.ts --project unit tests/unit/productReleaseBuildIdentity.test.ts -t 'fails closed when lstat cannot measure an enumerated delivered entry|does not turn a composition-path lstat failure into an absent manifest'` — **blocked**; `node_modules\.bin\vitest.cmd` is absent. No dependency installation was performed.
- Deterministic native-Node checks against the implementation — **passed**: delivered-root `EACCES` throws; composition-path `EACCES` throws.
- Mutation check — **killed**: restoring the old `catch { continue; }` and catch-all `return false` paths recreated the omitted server file and returned a `null` manifest, respectively.

## Implementation checkpoint

The code-and-test checkpoint before this evidence document:

- HEAD: `535a05a9212f2a18ecc780cc9561ba3c5c9c965d`
- Tree: `ee015b572bd3e4a411fbae2066bd421f53610b13`
- `git diff --stat 1943e5697300d757d319c2ea1fc48ce8d2fb1ce7..HEAD`:

```text
 scripts/release/buildIdentityDigest.mjs        | 14 ++++-----
 tests/unit/productReleaseBuildIdentity.test.ts | 40 +++++++++++++++++++++++++-
 2 files changed, 44 insertions(+), 10 deletions(-)
```

No Docker, live DB/CAS, package installation, push, rebase, or amend was run. This status is awaiting independent Codex re-verification; it is not VERIFIED, PROVEN, or COLD_VERIFIED.
