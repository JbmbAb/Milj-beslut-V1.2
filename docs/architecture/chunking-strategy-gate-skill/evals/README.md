# Behavioral regression set — chunking-strategy-gate

These four test cases exist to prove (and keep proving) that this skill actually enforces
the governance rule in `SKILL.md`, not just that it produces plausible-sounding text. If you
edit `SKILL.md`, re-run this set before shipping the change — a rewrite that reads better but
quietly loosens the gate is the failure mode this set is designed to catch.

## The four cases and what each one is a regression test for

| Case | Risk class | With-skill must... |
|---|---|---|
| `eval-court-new-source-fit` | False negative on routing (should classify as fit, but might not) | Recognize `court` fits by content despite an unfamiliar filename, and fix routing only — not chunking logic. |
| `eval-naturvardsverket-brochure-adp` | Silent fallback to `standard` for a genuinely different structure | Refuse to treat "runs without crashing" as "fits," and produce a decision request instead of code. |
| `eval-eu-directive-borderline` | Domain-similarity trap ("it's legal text, so `law`") | Check the actual regex/marker logic, not the document's domain, before calling something a fit. |
| `eval-court-version-discipline` | Quiet mutation of an approved strategy's boundary rules | Refuse to patch `chunkCourtDecision`'s regex directly; require an explicit `text/vX.Y` version-bump decision first. |

These map directly to the three "dangerous edge cases" the skill exists for: inventing/blending
a new strategy without a decision, mutating an existing strategy's output semantics without
versioning discipline, and letting a near-fit quietly slide into an implementation.

## Results on file

- `benchmark-iteration-1-baseline-vs-skill.json` / `.md` — with-skill vs. a baseline run with no
  skill at all, on the original SKILL.md. **100% pass rate with the skill vs. 52% without.**
  The baseline's failures were not cosmetic: on the EU-directive case it handed over a
  ready-to-paste new chunker function and incorrectly claimed no version bump was needed; on the
  version-discipline case it proposed a regex fix without ever mentioning chunk identity or
  `text/v2.3`.
- Iteration 2 (not separately saved as JSON, see this file's history / conversation record)
  added the Step 3 diagnostic rule ("check for a narrow/buggy detector before concluding no fit")
  after the first benchmark showed the skill catching only one of two real bugs in
  `chunkCourtDecision`'s DOMSKÄL detection (missing `/i` flag; missed the `\b`-boundary bug that
  excludes Swedish determined-form endings like `SKÄLEN`/`DOMSKÄLEN`/`BAKGRUNDEN`). Re-run after
  the fix: **100% pass rate on all four cases, and the version-discipline case now surfaces both
  bugs** while still correctly refusing to patch either without a version-bump decision.

## Re-running this set

Each eval's prompt and assertions are in `evals.json`. To re-check a SKILL.md edit:

1. Give the eval prompt to a fresh Claude session with this skill available (and, ideally, a
   second session with the *old* SKILL.md as a baseline, so you can see what changed).
2. Check the response against that eval's assertions in `evals.json` — the governance ones
   (no code written before a decision, version bump required for boundary changes, no
   domain-similarity reasoning) matter more than any single wording choice.
3. If something that used to pass now fails, the edit weakened the gate — even if the new
   SKILL.md text reads more clearly.

See the skill-creator skill (`skills/skill-creator/SKILL.md`) for the full eval-running/grading/
benchmark workflow if you want the aggregated pass-rate numbers rather than a manual check.
