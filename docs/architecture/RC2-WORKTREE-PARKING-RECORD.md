# RC2 — Working-Tree Parking Record

> ```
> Document class:                    PARKING RECORD (RC2 of REPRODUCIBLE-CHECKPOINT-V1)
> Status:                            SNAPSHOT at 62ffcac, 70 working-tree entries
> Purpose:                           make every remaining entry's owner, status, and
>                                     checkpoint-eligibility explicit WITHOUT new recon
> Not in scope:                      cleanup, staging, commits, fixes
> ```

This does not shrink the working tree. It answers, for each of the 70 entries
remaining after Phase A–E: is this known and intentional, or unclassified
drift? Every group below was already established by recon earlier in this
session; this document is the first place that inventory is committed rather
than living only in conversation.

## RC2 answer, by group

```
KNOWN + INTENTIONAL, checkpoint-eligible if parked as-is   59 entries
KNOWN + BROKEN, requires a decision before RC8               5 entries (the harvest:* targets,
                                                                counted once, within Group 9)
UNCLASSIFIED DRIFT surfaced while writing this record         5 entries (Group 4)
GENUINELY ORPHANED                                            1 entry
```

None of the 70 are unclassified in the sense of "nobody has looked at them."
Five (Group 4) are unclassified in a stricter sense: doc-sync gaps that
slipped through Phase A–E's packaging passes and are named here for the
first time. The five `harvest:*` targets are separately flagged as broken
rather than merely unclassified — they are named UNIT 3 surface, just not
committed, and their absence actively breaks a clean checkout.

---

## URGENT — canonical self-containment defect (found while compiling this record)

```
OWNER          UNIT 3 (P2/P3 governance harvest)
STATUS         BROKEN, not merely deferred
MAY EXIST AT CHECKPOINT?   NO — this blocks RC8 by itself if not resolved first
```

Commit `8bc79eb` (`chore(governance): expose canonical harvest commands`, part
of this session's Phase E) added five `package.json` script aliases —
`harvest:sfs`, `harvest:regulatory`, `harvest:municipal`, `harvest:court`,
`harvest:parallel` — pointing at:

```
scripts/import/harvest-sfs-all.ts
scripts/import/harvest-regulatory-all.ts
scripts/import/harvest-municipal-abva-all.ts
scripts/import/harvest-court-decisions-all.ts
scripts/import/run-parallel-harvest.ts
```

None of these five files were ever committed. `git ls-files` confirms all
five are still untracked. On a clean checkout, `npm run harvest:sfs` (and
the other four) fails immediately — the canonical branch references files
that do not exist in it. This is the same defect class as the
`geoPresentationAdapter`/`geoPresentationContract` dangling-import fix
earlier this session, except this time introduced by this session's own
work, and it was missed because verification checked the files existed on
disk, not that they were committed.

**This is not a parking decision.** It needs its own fix — commit the five
script files (verified against the same containment pattern already
established for the rest of UNIT 3), or remove the five aliases — before
RC8 can be attempted. Flagged here rather than fixed silently, per the
instruction that this document records, it does not remediate.

---

## Group 1 — UNIT 2: legal corpus materialization (17 entries)

**Owner:** UNIT 2. **Status:** active coherent unit, not yet packaged.
**May exist at checkpoint:** yes, as explicitly parked pending UNIT 2's own
closure/recon pass (next scheduled work after RC4).

```
packages/mps-legal-corpus/package.json
packages/mps-legal-corpus/src/ChunkIdentity.ts
packages/mps-legal-corpus/src/CorpusImportAttestation.ts
packages/mps-legal-corpus/src/CorpusImportGate.ts
packages/mps-legal-corpus/src/GovernedLegalCorpusMaterializer.ts
packages/mps-legal-corpus/src/IngestionManifest.ts
packages/mps-legal-corpus/src/LegalCorpusMaterializationIdentity.ts
packages/mps-legal-corpus/src/index.ts
packages/mps-legal-corpus/tests/CorpusImportGate.test.ts
packages/mps-legal-corpus/tests/GovernedLegalCorpusMaterializer.test.ts
packages/mps-legal-corpus/tests/PrismaLegalCorpusMaterializationPersistence.test.ts
prisma/migrations/20260817140000_legal_corpus_materialization_v1/migration.sql
server/modules/legal/services/PrismaLegalCorpusMaterializationPersistence.ts
server/security/legalCorpusSigningKey.ts
prisma/schema.prisma            (MIXED-safe: diff verified UNIT-2-only —
                                  LegalCorpusMaterialization +
                                  LegalCorpusIngestionManifestEntry, no
                                  overlap with UNIT 3 or DB-3)
tsconfig.json                   (UNIT-2-only: @miljobeslut/mps-legal-corpus
                                  path mapping, verified earlier this session)
package-lock.json               (276 insertions, reflects the new
                                  mps-legal-corpus workspace package)
```

**Known open question carried into UNIT 2's own recon** (already on record
from earlier in this session, repeated here for completeness): the
materialization core is understood to be coherent; whether the
bridge/admission layer inside it is equally finished has not yet been
separated out. That separation is UNIT 2's own closure pass, not RC2's job.

**Blocked by UNIT 2:**

```
tests/unit/P2Auth03COpenSourceSweepEnforcement.test.ts
```

Top-level `import { CorpusImportGate } from '.../mps-legal-corpus/src/CorpusImportGate'`
— cannot compile until UNIT 2 lands. This is UNIT 1/3's enforcement suite,
held out specifically for this reason (established during Phase B). Not a
UNIT 2 file itself; tracked here because its unblock condition is UNIT 2.

---

## Group 2 — UNIT 4: Cesium/geo presentation layer (14 entries)

**Owner:** UNIT 4, ownership scope frozen in `REPRODUCIBLE-CHECKPOINT-V1.md`
§4 (presentation only — may not own schema/governance/evidence authority).
**Status:** owner-for-packaging still not established (distinct from the
ownership-*scope* freeze, which constrains what any future owner may claim).
**May exist at checkpoint:** yes, explicitly parked. Hands off — no commit,
no revert — until a packaging owner is assigned.

```
components/CesiumMapView.tsx
components/app/lu/LuWorkspace.tsx
components/cesium/EvidenceDetailsPanel.tsx
components/cesium/fixtures/l0L1Scene.ts
components/cesium/types.ts
docs/architecture/ADR-POSTGIS-ADMIT-V1.md
docs/architecture/admit-v1/ADMIT-V1-SET.md
docs/architecture/admit-v1/LAYER-ID-CONTRACTS-V1.md
docs/architecture/CESIUM-KARTFRONT-IMPLEMENTERINGSPLAN-2026-08-10.md
src/domain/geo.ts
src/ui/api-client/geo.client.ts
tests/components/luWorkspace.test.tsx
tests/unit/cesiumL0L1Fixture.test.ts
tests/unit/src.ui.api-client.geo.client.test.ts
```

---

## Group 3 — UNIT 9: Juridisk RAG planning layer (5 entries)

**Owner:** conceptually UNIT 1/2/3's planning layer (agent-addressed
instructions on legal RAG harvesting/chunking), but placed in repo root
instead of `docs/architecture/`. **Status:** PARK — content is legitimate,
location is wrong. **May exist at checkpoint:** yes, parked; root placement
should be corrected in a later docs pass, not blocking.

```
DIAGNOSTIK_RAG_JURIDIK_STATUS.md
JURIDISK_DOMAIN_KLASSIFICERING.md
LOKE_INSTRUKTION_JURIDISK_HARVESTING.md
REVISION_JURIDISK_CHUNKING_OCH_IMPORT.md
TOR_INSTRUKTION_JURIDISK_RAG_IMPLEMENTATION.md
```

---

## Group 4 — UNCLASSIFIED DRIFT surfaced while compiling this record

Four items were never explicitly assigned a disposition during Phase A–E.
None are dangerous; all are small; naming them here closes the gap.

**4a. Two recon/decision-packet docs omitted from Commit `2edfe4b` (15b)**

```
docs/architecture/F4A-IMPACT-MAP-2026-08-12.md
docs/architecture/F4B-DOCUMENT-FACT-MODEL-CHECK-2026-08-12.md
```

Same self-declared "read-only, no code written" family as the twelve docs
already committed in 15b (F0A–F0D, GAP-REPORT, LEGACY-CLASSIFICATION, etc.).
These two were simply missed when that batch was compiled. Belong with
that group; safe to add in a small follow-up commit.

**4b. `docs/ops/legal-clean-run-v3.md` — one-line consequence of Commit `8c269fc` never included in UNIT 1**

```diff
-6. `download-domstol-rss.ts`
+6. Domstolshämtning körs endast genom den governade P2/PUH-runtimen;
+   `download-domstol-rss.ts` är superseded och fail-closed.
```

Documents exactly the guard Commit 8 (`8c269fc`) added to
`domstolRssDownloadService`. Should have shipped in Group 1 of Phase B;
was missed. Belongs to UNIT 1.

**4c. `docs/architecture/architecture-authority-map.jsonc` — stale paths from an already-committed rename**

19 lines changed, all mechanical: replaces `packages/mps-lu/src/loke/QuarantinePromoter.ts`
→ `packages/mps-lu/src/ingestion/QuarantinePromoter.ts` and
`LokeIngestion.test.ts` → `RawSourceIngestion.test.ts` throughout. The rename
itself landed in already-committed `95587ef`
("refactor(naming): replace Loke runtime names with functional terms");
this file is catching up to it. Not owned by any UNIT in this session's
scope — a documentation-sync fix, safe, mechanical, low priority.

**4d. `docs/architecture/MIMER-EVOLUTION-DIRECTION-2026-08-15.md`**

New document, dated 2026-08-15, "Mimer — Evolution Direction and Working
Method." Not reviewed for authority conflicts with any of this session's
frozen decisions. Genuinely unclassified — flagged, not placed.

---

## Group 5 — GENUINELY ORPHANED (1 entry)

```
tests/fixtures/National_Archive/VISS/2024/Karlstad/Case_123/original/beslut_grundvatten.txt
```

No reference to this path exists anywhere in committed code, docs, or the
remaining working tree (checked earlier this session). Unlike
`tests/fixtures/EndToEnd/VerticalProof/original/beslut.txt` (Group 6, below
— referenced by committed HM1 evidence docs), this fixture has no known
consumer. Not deleted here — RC2 records, it does not discard — but it
should not be assumed load-bearing.

---

## Group 6 — Generated/external data, preserve-not-package (3 entries)

```
tests/fixtures/EndToEnd/VerticalProof/original/beslut.txt
GEO_Master_Archive/Documents/Sources/Riksdagen/SFS/1998_808/sfs-1998-808.text
GEO_Master_Archive/Documents/Sources/Riksdagen/SFS/2013_251/sfs-2013-251.text
```

`VerticalProof` fixture: referenced by committed HM1 evidence documents;
preserve, package alongside `Case_Fusion` (already committed, `64be3db`) in
a future fixtures pass. `GEO_Master_Archive/**`: downloaded source data,
zero tracked files in that directory, not gitignored — should eventually be
gitignored rather than committed. Neither blocks checkpoint.

---

## Group 7 — Small standalone items, no established owner (6 entries)

None of these were assigned to a UNIT during Phase A–E recon. Naming them
here is the first time they are on record as "seen, not yet owned" rather
than silently absent from every unit's file list.

```
.cursor/stitch-mcp-proxy.mjs      Stitch MCP tooling config
stitch.json                        Stitch MCP tooling config (paired with above)
package.json                       remaining diff after Commit 16 — cesium
                                    dependency + copy-cesium-assets postinstall
                                    hunk (UNIT 4), harvest:governed +
                                    admit:validate-layers (parked/UNIT 4,
                                    excluded per Phase E recon — unchanged)
packages/mps-data-governance/package.json   still carries the dangling
                                    "loke:harvest": "tsx scripts/loke-harvest.ts"
                                    line (target file does not exist anywhere) —
                                    flagged in Phase E recon, never fixed,
                                    must not be committed as-is
scripts/db/sync-property-unit-from-env.ts   modified, no governance/schema
                                    references found on inspection, owner unclear
server/loadEnvFirst.ts             modified, PRESERVE_RUNTIME_ENV reordering,
                                    owner unclear (infra/tooling, not UNIT 1/3)
```

## Group 7b — Archive-first / ALLOW_LIVE_SEED cluster (3 entries)

**Owner:** unclear — same mechanism family as `scripts/import/seed-core-legal-sfs.ts`
(Commit `fb5cad5`, 10b) but never confirmed to share its guard. **Status:**
noted during Phase B recon as "adjacent theme, not yet classified," then
never actually assigned a group — a second oversight caught only while
writing this record.

```
scripts/import-office-docs.ts
scripts/import-raw-pdfs.ts
scripts/import/importLibrarianQa.ts
```

Each gates a Prisma write behind `ALLOW_LIVE_SEED === 'true'`, falling back
to an archive-first save otherwise — the same pattern `seed-core-legal-sfs.ts`
carries as dead code behind its P2-AUTH-02 guard. Unlike that file, none of
these three has a confirmed unconditional guard proven by an enforcement
test. Before packaging: verify whether they need the same P2-AUTH quarantine
treatment or are legitimately different (e.g. already safe by construction).
Not yet investigated to that depth — flagged, not resolved.

## Group 8 — Wrong unit entirely (1 entry)

```
scripts/benchmark/legal-golden-set.ts
```

Established in Phase B recon: a RAG retrieval/entailment evaluation harness
with no `P2-AUTH` guard and no relation to legacy source acquisition. Was
grouped into UNIT 1 by name association during initial recon, corrected
during Phase B, never reclassified into a real unit. Still homeless.

## Group 9 — UNIT 3 tests never explicitly staged (2 entries)

```
packages/mps-data-governance/tests/P2SR01UnsignedPuhDraft.test.ts
packages/mps-data-governance/tests/P2SRLegacyIsNotAuthority.test.ts
```

Established during original UNIT 3 recon as depending only on already-
committed `SourceRegistry.ts` — same class as the three drafts committed in
Commit 12 (`5747b93`: `P2Auth03D1UnsignedLegalSources`,
`P2Auth03E3BSguWellGuidanceDraft`, `P2Auth03E4BPlanbestammelserDraft`).
These two were part of the same recon batch but never actually staged in
any Phase A–E commit — an oversight, not a deliberate exclusion. Belong
with UNIT 3.

**Scripts still uncommitted, owner UNIT 3, part of the URGENT finding above:**

```
scripts/import/harvest-sfs-all.ts
scripts/import/harvest-regulatory-all.ts
scripts/import/harvest-municipal-abva-all.ts
scripts/import/harvest-court-decisions-all.ts
scripts/import/run-parallel-harvest.ts
scripts/import/classify-inventory-phase1.ts
scripts/import/generate-inventory-summary.js
scripts/import/inventory-archive-documents.ts
scripts/import/provenance-freeze-phase1.ts
scripts/import/run-document-ingestion-engine.ts
source-registry/dataset-inventory.md
source-registry/drafts/README.md
```

(The first five are the dangling `harvest:*` targets already called out
above. The remaining seven were part of the original UNIT 3 inventory,
never yet packaged — no proof this session that they are anything other
than ordinary UNIT 3 surface, but not verified clean either. Distinct from
the URGENT finding: these are not referenced by any committed `package.json`
alias, so their absence does not break a clean checkout the way the five
harvest scripts do.)

---

## RC2 disposition summary

```
group 1   UNIT 2 (incl. 1 test blocked on it)     18   PARK — own closure pass next
group 2   UNIT 4                                  14   PARK — owner decision pending
group 3   UNIT 9                                   5   PARK — content fine, location wrong
group 4   drift, now named                         5   PARK — small follow-up commits later
group 5   orphaned                                 1   PARK — do not assume load-bearing
group 6   generated/external, preserve             3   PARK — future fixtures pass
group 7   no owner                                 6   PARK — needs owner assignment
group 7b  archive-first/ALLOW_LIVE_SEED cluster    3   PARK — needs guard-mechanism check
group 8   wrong unit                               1   PARK — needs real classification
group 9   UNIT 3, missed (incl. the 5 URGENT      14   PARK for the other 9; the 5
          harvest:* targets)                            harvest:* files are BROKEN,
                                                          not merely parked — see URGENT
                                                   --
TOTAL                                             70
UNCLASSIFIED REMAINING                             0
```

RC2 is closed: every one of the 70 entries has an owner, a status, and an
explicit answer to "may this exist at checkpoint." The URGENT finding above
is the one item that changes RC8's timeline — it must be resolved (fix or
revert) before a clean-checkout proof can succeed, independent of RC4 or
UNIT 2/RC6.
