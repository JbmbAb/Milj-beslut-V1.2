# LEGAL-RETRIEVAL-TRACE-REPAIR-01 — PROVEN

**Status:** PROVEN (strict, narrow repair — see scope). Fixes the `KNOWN_BROKEN`/`NOT_PROVEN`
defect found in `LEGAL-RETRIEVAL-QUARANTINE-RECON-01`: `packages/mps-retrieval-trace` shipped two
dead files importing a module that has never existed anywhere in the repo
(`../../mps-retrieval-governance/src/ArtifactReader`), silently masked because vitest's esbuild
transform elides an unused type-only import at emit time — the package's "15/15 green" test run
was not proof of compile-health. No retrieval semantics changed in this unit.

## What was actually broken

Deeper than the recon's initial finding: the broken `../../mps-retrieval-governance/src/
ArtifactReader` import appeared in **four** places, not two:

| File | Status before | Real consumer? |
|---|---|---|
| `RetrievalExecutionTraceArtifact.ts` | dead, unexported | none (only `TraceAuthority.test.ts`'s own unused import) |
| `RetrievalTraceBuilder.ts` | dead, unexported | none |
| `RetrievalTraceIdentity.ts` | **broken import, but real logic** | `RetrievalTraceDeterminism.test.ts` genuinely calls `calculateRetrievalTraceIdentity()` |
| `RetrievalTraceDeterminism.test.ts` | broken import | itself, directly |

`RetrievalTraceIdentity.ts` was not dead code — it computes a real, tested SHA256 hash of
`query_hash`/`policy_version`/`artifact_snapshot_ref`/`selected_artifact_refs` (with sorted-refs
determinism already proven). Deleting it outright, as a naive "remove the two broken files" read
of the recon might suggest, would have deleted working, tested logic. It needed its import fixed,
not removed.

**A sibling package, `mps-query-budget`, has the exact same broken import** (`QueryBudgetGuard.ts`
and two of its tests). Left untouched — out of scope for this unit, per instruction to keep the
two tracks separate.

## What was done

1. **Deleted** `RetrievalExecutionTraceArtifact.ts` and `RetrievalTraceBuilder.ts` — confirmed
   genuinely dead (not exported by `index.ts`, no real consumer anywhere in this package).
2. **Removed** the now-dangling unused import in `TraceAuthority.test.ts` (it imported the type
   but never used it — the test itself is typed `any` throughout).
3. **Added** `src/ArtifactReference.ts` — a minimal local type (`{ id: string; artifact_class:
   string }`) matching the exact shape every existing real consumer (test fixtures in this
   package and in `mps-query-budget`) already assumed. Not a new design — the shape was already
   fixed by existing usage; this just gives it a real home instead of a nonexistent cross-package
   file.
4. **Fixed** `RetrievalTraceIdentity.ts` and `RetrievalTraceDeterminism.test.ts` to import from
   the new local file.
5. **Added** `packages/mps-retrieval-trace/tsconfig.json` (extends root) and a `typecheck` npm
   script, so this package's own compile-health can be checked in isolation rather than only via
   the already-noisy, 88-error root `npm run typecheck`.
6. **Added** `tests/PackageTypecheck.test.ts` — the required regression: (a) asserts the
   package's own `tsc --noEmit` passes cleanly right now, and (b) an independent mechanism proof
   that `tsc` (not `vitest`) genuinely catches a broken relative import of this exact shape (a
   synthetic broken file in a throwaway temp directory, cleaned up after the assertion) — proving
   the guard actually works, not just that this one instance is currently fixed.

## Proof

```
npx tsc --noEmit -p packages/mps-retrieval-trace/tsconfig.json   -> clean, zero errors
npx vitest run packages/mps-retrieval-trace/                     -> 4 files, 7 tests, all pass
npx vitest run packages/mps-retrieval-governance/ packages/mps-query-budget/
                                                                   -> unaffected, still 6 files/13 tests passing
```

## Reclassification

`mps-retrieval-trace` moves from **`NOT_PROVEN`** to **`REUSABLE_WITH_MIGRATION`** — not
`PROVEN` outright, because two things this session's vocabulary of "PROVEN" requires are still
missing and explicitly out of scope for this narrow repair:

- Zero production consumers still exist (unchanged by this unit — no wiring was added).
- No embedding-model-identity concept exists in this package (confirmed in the recon, unaffected
  here) — that is `LEGAL-RETRIEVAL-IDENTITY-CONTRACT-01`'s job, not this one's.

## What this does not claim

- `mps-query-budget`'s identical broken import is untouched, tracked as its own separate,
  unopened item.
- No retrieval policy, trace, or identity semantics were changed — this is exclusively an import-
  resolution and compile-health repair.
- Root `npm run typecheck` still reports ~88 pre-existing errors unrelated to this unit — not
  addressed here.
