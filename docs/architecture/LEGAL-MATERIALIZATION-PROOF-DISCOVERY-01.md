# LEGAL-MATERIALIZATION-PROOF-DISCOVERY-01

**Status:** Closed. Recorded so past claims of "always green" are never made about the affected tests.

## Finding

While building `LEGAL-CORPUS-MATERIALIZATION-V1`, two test files were written and placed under `server/**` (`server/text-projection/pdfParseExtractorAdapter.test.ts`, `server/modules/legal/materialization/ChunkAdmission.test.ts`) and reported as passing based on `npx vitest run <path> <other-path>` runs that showed an all-green summary.

That summary was misleading. `vitest.config.ts`'s four projects (`unit`, `component`, `integration`, `compliance`) each declare an explicit `include` glob, and **none of them match `server/**/*.test.ts`** — confirmed no pre-existing file under `server/` was covered by any project either (`server/services/municipalitySubmissionService.test.ts` predates this and is equally uncovered). When a vitest CLI invocation is given multiple paths and at least one matches a project's `include`, vitest activates that project and silently runs only the files that actually match — it does not run the other given paths, and it does not warn that they were dropped. So:

```
npx vitest run server/text-projection/pdfParseExtractorAdapter.test.ts packages/mps-text-projection/
```

reported "23 passed" — which was **entirely `packages/mps-text-projection`'s own 7 files**, not the new adapter test at all. The new test never executed, in isolation or combined, for as long as it lived under `server/`.

## Resolution

Both files relocated to `tests/unit/`, matching the repo's actual convention for testing server-adjacent logic (`tests/unit/server.*.test.ts`, dot-joined path). Two missing vitest aliases (`@miljobeslut/mps-legal-corpus`, `@miljobeslut/mps-chunking`) added to the `unit` project's `resolve.alias` — the same "root-level alias does not reach `projects` entries" behavior already documented inline for the `compliance` project. Re-verified with `--project unit` explicitly: both files now genuinely run and pass, and running that pass surfaced three real test-construction bugs (documented in the `LEGAL-CHUNK-ADMISSION-V1` commit) that the fake-green run had never exercised.

## Why this matters going forward

Any test file placed directly under `server/` (or any path outside the four projects' declared `include` patterns) will not run under `npm run test:unit` or CI, regardless of how a manual `vitest run` invocation reports. Before trusting a new test file's result in this repo: confirm it is discovered by running `npx vitest run --project <name> <path>` explicitly (not a bare `vitest run <path>` with no `--project`), and check the reported file count matches expectation.
