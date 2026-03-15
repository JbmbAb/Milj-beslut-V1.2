# Codex – Instructions for Backfill Pipeline

## Context
This document tells Codex exactly what to do to run the verified case database backfill pipeline. All scripts are in `scripts/backfill/`. The migration has already been applied.

## ⚠️ Critical Rules Before You Start
1. **Never** overwrite a field with `metadataReviewStatus = 'LOCKED'`
2. **Never** run a script that modifies data without first running it with `--dry-run`
3. **Always** check the log output before proceeding to the next step
4. **Stop immediately** if coverage-report exits with code 1 (fail-gate triggered)
5. **Confidence ≠ Verified**: `AUTO` status means computer-extracted only, not human-approved

## Status Meanings (do not confuse these)
| Status | Meaning |
|--------|---------|
| `AUTO` | Computer-extracted. Not manually verified. |
| `NEEDS_REVIEW` | Low confidence – requires human review before use |
| `VERIFIED` | Manually approved by a human reviewer |
| `LOCKED` | Locked by admin – never overwrite automatically |

## Execution Order

### Step 1 – Baseline Report
```bash
npx tsx scripts/backfill/baseline-report.ts
```
Read the output JSON. Note coverage percentages. This is your before-state.

### Step 2 – Migration
Already applied. Do NOT re-run.

### Step 3 – Pass 1 (deterministic metadata from subject/filename)
```bash
# Dry run first
npx tsx scripts/backfill/extract-metadata-pass1.ts --dry-run --limit=50

# If output looks correct, run for real in batches of 200
npx tsx scripts/backfill/extract-metadata-pass1.ts --limit=200
```
Repeat until all documents processed (check baseline-report again).

### Step 4 – Build Case Candidates
```bash
npx tsx scripts/backfill/build-case-candidates.ts --dry-run
npx tsx scripts/backfill/build-case-candidates.ts
```
This groups documents into `CaseCandidate` rows with caseConfidence scores.

### Step 5 – Text/OCR Batch (3 sub-steps: TEXT_EXTRACTED → CHUNKED → EMBEDDED)
```bash
npx tsx scripts/backfill/extract-text-batch.ts --dry-run --limit=5
npx tsx scripts/backfill/extract-text-batch.ts --limit=25
```
Batch size 25 is intentional (OCR is memory-intensive). Re-run until no METADATA_ONLY docs remain.

### Step 6 – Pass 2 (metadata from document text)
```bash
npx tsx scripts/backfill/extract-metadata-pass2.ts --dry-run --limit=50
npx tsx scripts/backfill/extract-metadata-pass2.ts --limit=200
```

### Step 7 – Disagreement Detection
```bash
npx tsx scripts/backfill/resolve-disagreements.ts --dry-run
npx tsx scripts/backfill/resolve-disagreements.ts
```
This queues conflicts for manual review. Does NOT resolve them automatically.
Check the MetadataReviewQueue for OPEN DISAGREEMENT items before proceeding.

### Step 8 – Pass 3 (LLM for remaining missing/low-confidence fields)
> ⚠️ Run only if coverage after Steps 1–7 is insufficient.
```bash
npx tsx scripts/backfill/extract-metadata-pass3-llm.ts --dry-run --limit=5
npx tsx scripts/backfill/extract-metadata-pass3-llm.ts --limit=10
```
LLM batch size is 10. Gemini is primary, OpenAI is fallback. Each call has 15s timeout.

### Step 9 – Materialize Cases
```bash
npx tsx scripts/backfill/materialize-cases.ts --dry-run
npx tsx scripts/backfill/materialize-cases.ts
```
Creates `RequirementCase` rows from candidates with caseConfidence >= 0.45 and no open disagreements.

### Step 10a – QA Sample
```bash
npx tsx scripts/backfill/qa-sample.ts --size=100
```
Review output. Check `qualityDistribution` – note how many are AUTO vs VERIFIED.
**You must manually verify at least 25 cases** before running coverage-report as final gate.

### Step 10b – Coverage Report + Fail Gate
```bash
npx tsx scripts/backfill/coverage-report.ts
```
**If this exits with code 1: STOP**. Do not proceed with requirement extraction.
Fix precision issues first (more LLM passes, or manual corrections via `LOCKED` field updates).

## Batch Sizes Reference
| Pass | Batch Size | Reason |
|------|-----------|--------|
| Metadata pass 1 & 2 | 200 | Fast regex, low memory |
| OCR/Text | 25 | High memory per file |
| LLM pass | 10 | API rate limits + timeout risk |
| Requirement extraction | 20 | LLM + complex processing |

## requirementHash Formula
When extracting requirements (not in scope for this pipeline, handled separately):
```
requirementHash = SHA256(caseId + "|" + normalizedText + "|" + documentId)
```
Use `makeRequirementHash()` from `scripts/backfill/_shared.ts`.

## What NOT to Do
- ❌ Do not run all steps in one command without checking intermediate output
- ❌ Do not skip the dry-run step before any write operation
- ❌ Do not treat `caseConfidence` as a replacement for `caseReviewStatus = 'VERIFIED'`
- ❌ Do not re-run the migration (step 2) – it has already been applied
- ❌ Do not run LLM pass on LOCKED documents (the script prevents this, but don't bypass it)

## Useful Monitoring Queries
```sql
-- Status distribution
SELECT status, COUNT(*) FROM "DocumentRecord" GROUP BY status;

-- Review queue
SELECT "queueType", status, COUNT(*) FROM "MetadataReviewQueue" GROUP BY "queueType", status;

-- Case candidate confidence histogram
SELECT
  ROUND("caseConfidence"::numeric, 1) AS conf_bucket,
  status,
  COUNT(*)
FROM "CaseCandidate"
GROUP BY 1, 2 ORDER BY 1;

-- Evidence rows per field
SELECT "fieldName", "sourceType", COUNT(*) FROM "DocumentMetadataEvidence" GROUP BY 1, 2 ORDER BY 3 DESC;
```
