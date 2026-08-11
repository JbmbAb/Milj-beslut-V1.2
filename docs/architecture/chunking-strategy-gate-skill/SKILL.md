---
name: chunking-strategy-gate
description: Governs chunking-strategy decisions in the miljöbeslut mps-chunking system (packages/mps-chunking, packages/mps-text-projection). Use whenever asked to add chunking/RAG-ingestion support for a new document source or format (e.g. Naturvårdsverkets allmänna råd, EU-direktiv, a new court registry export, anything not clearly Swedish law/court/permit-evidence text), asked to "optimera chunkning" or "anpassa chunkning efter dokumentstruktur", to route/classify a document for embeddings/RAG, or before writing/modifying ANY code in packages/mps-chunking or packages/mps-text-projection. Also trigger for building a "smarter"/"universal" chunker, tuning chunk size/overlap for one document, or explaining why a document was chunked a certain way. Hard rule enforced — select among existing approved strategies only, never invent/blend/silently modify one; if none semantically fits, stop and produce an Architecture Decision Proposal instead of writing chunker code.
---

# Chunking Strategy Gate (miljöbeslut / mps-chunking)

## The rule

> Chunking SHALL select an existing approved strategy; it SHALL NOT compose, modify, or invent chunking strategies. If no approved strategy semantically fits the document structure, processing SHALL STOP and emit an Architecture Decision Proposal (ADP/ADR) instead.

This is not a style preference — it follows directly from `docs/architecture/ADR-CHUNKING-Subsystem.md`, which explicitly rejects a `UniversalChunker` with mixed modes ("modes mix incompatible invariants"), and from the determinism/identity contracts in `packages/mps-chunking/src/core/` (see `references/strategy-inventory.md` for the details). Chunk identity is a sha256 hash of exact chunk text at a specific `chunk_index`, under a specific `text/vX.Y` version. Silently changing how a document gets split — even "just this once, because it seemed better" — changes chunk identity for every downstream retrieval, breaks manifest replay, and is exactly the failure mode the ADR was written to prevent. So the discipline here isn't bureaucracy for its own sake: it's what keeps the RAG index reproducible.

## Workflow

Work through these steps in order. Do not skip ahead to writing code.

### Step 1 — Inventory the currently approved strategies

Read `references/strategy-inventory.md` in this skill for a summary, but treat it as a map, not the territory — **verify against the live source** before relying on it, since the code may have changed:

- `packages/mps-chunking/src/text/LegalChunker.ts` — `chunkSwedishLaw`, `chunkCourtDecision`, `chunkStandard`
- `packages/mps-chunking/src/text/EvidenceChunker.ts` — `detectSections` / `generateEvidenceChunks`, keyed by `docType` (`decision | mkb | technical_description | control_program`)
- `packages/mps-chunking/src/text/TextStructureChunker.ts` — `routeToCorrectChunker` (filename/source-string routing) and `chunkTextStructure` (the actual entry point, takes an explicit `kind`)
- `packages/mps-text-projection/src/classification/DocumentClassifier.ts` and `ChunkContractResolver.ts` — a content-marker-based classifier that exists but is **not wired into production** (the live backfill script, `scripts/db/rechunk-legal-corpus.ts`, calls `routeToCorrectChunker` directly and bypasses it). Know which path is actually live before proposing where to hook in new routing.

There are exactly four approved `TextChunkKind`s today: `law`, `court`, `evidence`, `standard`. `standard` (naive paragraph split) is itself an approved strategy — but "an approved strategy technically runs without erroring" is not the same as "semantically fits." That distinction is the whole point of Step 2.

### Step 2 — Classify the document by structure, not by filename

For the document(s) in question, look at actual content and ask: does it exhibit the specific structural signals an existing strategy assumes?

- **law**: numbered `§` markers (e.g. `6 §`, `6 a §`) and `X kap.` chapter headers
- **court**: section headers `DOMSLUT|DOMSKÄL|YRKANDEN|BAKGRUND|SKÄL`
- **evidence**: permit-bundle section markers like `VILLKOR`, `BULLERMÄTNING`, `VATTENKONTROLL` (these are specific to environmental-permit documents — a different domain's headings, even if superficially similar in *shape*, are not this signal)
- **standard**: genuinely unstructured prose where paragraph breaks are the only reliable boundary

If a document has real internal structure (headings, numbered recommendations, tables, a table of contents) that doesn't match any of the above, forcing it through `standard` throws that structure away — that counts as **not fitting**, even though the function would run. Judge fit on whether the strategy's boundary logic would preserve the document's actual semantic units, not on whether it would crash.

**Semantic fit means the approved strategy's structural assumptions and boundary rules match the observed document structure. Domain similarity alone SHALL NOT constitute fit.** "This is legal text, and `law` is the legal strategy" is not an argument — an EU directive numbered `Artikel 5(2)` is legal text, but `chunkSwedishLaw`'s boundary rule looks for `\d+\s*[a-z]?\s*§`, which will never match, silently producing one giant unsplit chunk (or nothing useful) rather than an honest failure. Check the actual regex/marker logic against the actual document text before calling something a fit.

Existing filename/source routing (`routeToCorrectChunker`) is a heuristic for *which known category a document belongs to*, not a definition of the categories themselves — a new source with an unfamiliar filename pattern but genuinely law-shaped or court-shaped content still fits an existing strategy; only the routing rule needs a new pattern, not a new chunker. Don't confuse "the filename regex doesn't match" with "no strategy fits."

**The skill MAY propose changes to routing or classifier integration when an approved strategy already fits. It SHALL NOT propose modifications to a strategy's chunk-boundary semantics without invoking the versioning rule (Step 4c).** Routing gaps and chunking-contract gaps are different problems with different required outcomes — keep them separate.

### Step 3 — Diagnose before declaring "no fit"

Before concluding that no approved strategy fits, inspect the closest candidate strategy's actual detector logic for false negatives — not just whether it's aimed at the right *category* of document, but whether its regex/boundary logic is narrower than the structure it's meant to recognize. A missing case-insensitive flag, a `\b` word boundary that happens to exclude Swedish determined-form endings (`SKÄLEN`, `DOMSKÄLEN`, `BAKGRUNDEN` vs. the bare `SKÄL`/`DOMSKÄL`/`BAKGRUND` the regex checks for), or an anchor that assumes a heading never wraps a line are detector defects, not evidence that the document falls outside the strategy's intended scope. A document that "doesn't match" today because of a narrow implementation of the right idea is a different situation from a document that needs an idea the codebase doesn't have yet — only the second one is a real Step 5 case.

If you find a likely detector defect, say so explicitly, with the specific pattern and example text that exposes it. This does **not** grant permission to patch it — a detector fix still changes `text/v2.3` output for every document already chunked by that strategy, so it still has to go through Step 4c (the versioning rule) like any other boundary-rule change. The point of this step is diagnostic sharpness, not a shortcut around the governance rule: it stops you from drafting a whole new strategy proposal for a gap that a two-character regex fix would have closed, and it stops you from missing that fix because you were only checking "does this document belong to a known category" rather than "does the detector actually recognize this instance of that category."

### Step 4 — If a strategy fits: three possible outcomes

#### Step 4a — Strategy fits and routing already reaches it: nothing to do

Say so plainly and stop. Not every question needs a code change.

#### Step 4b — Strategy fits, but routing/classification doesn't catch this source

Propose the minimal addition to routing patterns — not a new chunking function, not new parameters, not a tweak to `MAX_CHUNK_CHARS`/`OVERLAP_CHARS` for this one case. Prefer hooking the new source into the existing content-based classification path (`DocumentClassifier`/`ChunkContractResolver`) over adding another parallel filename-matching branch — a second ad hoc classifier is exactly the kind of drift that makes routing unmaintainable, even if the dormant classifier isn't wired into production yet. If you instead propose extending `routeToCorrectChunker`'s filename/source patterns directly (e.g. because it's the one path actually live in `rechunk-legal-corpus.ts` and wiring the classifier in is out of scope for the task), say so explicitly and explain the tradeoff — don't pick silently.

#### Step 4c — Strategy *almost* fits, but only if its boundary/detection rules change

This is not a routing change — it's a change to what `text/v2.3` actually outputs for documents already being chunked by that strategy. This is also where a Step 3 detector-defect finding lands: even a narrow, obviously-correct-looking fix (like adding `/i` or widening a `\b`-bounded word list) still qualifies. Do not implement it. `text/v2.3` is a frozen contract; its boundary logic cannot be mutated in place, because every already-chunked document's manifest was computed against the current behavior, and changing the regex/markers changes chunk identity for all of them retroactively. Produce a proposal instead (adapt `references/adp-template.md`: frame it as "modify existing strategy" rather than "new strategy," and describe old vs. new boundary behavior, which existing chunks/manifests would be invalidated, and the required version bump, e.g. `text/v2.4`) and wait for an explicit decision before touching the code.

### Step 5 — If nothing fits at all: stop and write an Architecture Decision Proposal

Do not write a new chunker, do not extend an existing one with special-case branches, and do not fall back to `standard` and call it done. Use `references/adp-template.md` to produce a short, concrete proposal covering: what document sample was examined, why each of the four existing strategies falls short (including, per Step 3, confirmation that the mismatch is a genuine scope gap and not a fixable detector defect), a *sketch* of what a new strategy would need to look for structurally, and which invariants (contract = `text`, version bump under `text/vX.Y`, determinism) it would have to satisfy. Present this to the user and wait — this is a decision request, not an implementation ticket you've greenlit yourself. It mirrors the pattern this repo already uses for the same reason (see `docs/architecture/TV-3.3-Document-Chunk-Partition-Decision-Template.md` — a filled decision record is required before any change; until then, the fail-closed default holds).

## If you're editing this skill

`evals/` contains a four-case behavioral regression set (`evals.json` + `README.md`) that proves
this skill actually enforces the rule above — not just that it reads well. Each case targets one
of the dangerous edge cases (inventing a strategy without a decision, mutating an approved
strategy's output without a version bump, near-fit sliding into implementation, domain-similarity
reasoning). If you change the workflow steps or the rule wording, re-run these four before
shipping the change — a rewrite that reads more cleanly but quietly loosens the gate is exactly
the failure mode this set exists to catch. See `evals/README.md` for how to re-run and what
"pass" means for each case.

## Non-goals

- Do not create a `UniversalChunker` or any dispatcher that dynamically blends/mixes chunking logic within one pipeline run.
- Do not modify `chunkSwedishLaw`, `chunkCourtDecision`, `chunkStandard`, or `EvidenceChunker`'s boundary/detection logic — even a "small" regex widening, even one found via the Step 3 diagnostic check — without going through Step 4c and getting an explicit version-bump decision first.
- Do not touch `archive/v1.0` (`ArchiveByteChunker.ts`) as part of a text-structure chunking task — it's a separate contract with separate invariants (fixed byte ranges, no decode).
- Do not implement a proposed new strategy from Step 5, or a proposed boundary-rule change from Step 4c, without an explicit go-ahead from the user on the proposal.
- Do not treat domain similarity ("this is legal text") as sufficient justification for routing to a strategy — check the actual structural signal.
- Do not treat "no existing strategy matches" as settled without first checking, per Step 3, whether that's actually a narrow/buggy detector rather than a genuine scope gap.
