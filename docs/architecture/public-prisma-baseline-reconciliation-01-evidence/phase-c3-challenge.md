# PUBLIC-PRISMA-BASELINE-RECONCILIATION-01 -- Phase C3 Challenge Report

Independent adversarial third-pass verification of the Phase C2 disposition of the 98 HOLD items. C2 was not consulted or trusted at face value; every claim was independently re-derived from `phase-b-comparison.json` and, where cited, checked against the actual repository files.

## Input integrity

| File | Specified SHA-256 | Verified |
|---|---|---|
| phase-b-comparison.json | `7e0bcd73d758561418b32166e76d56dfda5f15b1b03ec96e5d26d3dc24b9226a` | MATCH |
| phase-c-ratification.json | `0b39643bcef44ba77aa7fd9c7581fbe39defba527ded1aa59c45334cfaeafca8` | MATCH |
| phase-c2-disposition.json | `016c0bcb5fa5707e36747091ed339b5bcb6316faee3f43e152fc74b6a34d5268` | MATCH |

**Provenance discrepancy (non-blocking):** Input files verified byte-identical to the specified SHA-256 hashes, but were found on the OPEN pull request branch 'chore/public-prisma-baseline-reconciliation-01-c2-evidence' (PR #137), NOT on origin/main as instructed -- flagged as a discrepancy, not a blocker, since content integrity was independently confirmed.

## Headline result

**13 of 98 items are OVERTURNED.** All 13 overturns are within the highest-scrutiny COMPARISON_ARTIFACT bucket -- the exact failure mode this pass was designed to catch (real drift waved through as "safe"). All 50 NAME_TRUNCATION_EQUIVALENT items and all 19 TRUE_SCHEMA_DRIFT items are SUSTAINED. All 4 OWNER_DECISION_REQUIRED items are SUSTAINED, though one (chapter_paragraph index) had a factual error in C2’s cited evidence that is corrected here without changing the disposition.

## OVERTURNED items (read this section first)

Grouped into two distinct findings:

### Finding 1: `localization_geometry_supersessions` table wrongly waved through as a "documented raw-SQL exclusion" (12 items)

C2 accepted a first-party migration-file comment ("raw SQL access, not a Prisma model") as proof this whole table -- 1 relation, 6 columns, 2 constraints, 3 indexes -- is legitimately absent from `schema.prisma`. On independent review this fails the hard rule: a team comment documents a policy choice, not a structural impossibility (unlike `_prisma_migrations`, which Prisma’s own tooling refuses to let you model at all). C2’s own cited text even undercuts itself -- it says the two sibling tables using identical wording were later promoted to real Prisma models, meaning this pattern is normally temporary in this codebase, not permanent. Most tellingly, C2 applied a stricter, correct standard to structurally identical cases elsewhere in the same report (`PostgisImportBatch`, `DocumentChunk` HNSW index) -- both classified TRUE_SCHEMA_DRIFT specifically because `schema.prisma` itself is silent about them, versus the `legal_corpus_chunks` HNSW index which stayed COMPARISON_ARTIFACT because `schema.prisma` carries its own explicit acknowledgment comment. `localization_geometry_supersessions` has zero mentions anywhere in `schema.prisma` -- the same fact pattern C2 itself treated as real drift elsewhere. Corrected to **TRUE_SCHEMA_DRIFT**.

Affected items:
- `relations: localization_geometry_supersessions|r`
- `columns: localization_geometry_supersessions|created_at`
- `columns: localization_geometry_supersessions|id`
- `columns: localization_geometry_supersessions|predecessor_geometry_artifact_id`
- `columns: localization_geometry_supersessions|project_id`
- `columns: localization_geometry_supersessions|successor_geometry_artifact_id`
- `columns: localization_geometry_supersessions|supersession_artifact_id`
- `constraints: localization_geometry_supersessions|localization_geometry_supersessions_pkey`
- `constraints: localization_geometry_supersessions|localization_geometry_supersessions_project_id_fkey`
- `indexes: localization_geometry_supersessions|localization_geometry_supersessions_pkey`
- `indexes: localization_geometry_supersessions|localization_geometry_supersessions_project_idx`
- `indexes: localization_geometry_supersessions|localization_geometry_supersessions_project_supersession_key`

### Finding 2: `legal_corpus_chunks` unique constraint drift misattributed to a "Phase B tooling gap" (1 item)

C2 explained away an ACTUAL_ONLY unique constraint (`legal_corpus_chunks_record_id_chunk_index_chunk_version_key`) as a comparison-tool extraction gap, reasoning the backing index matches fine elsewhere. Independent trace of every migration touching this table shows the ONLY constraint ever created by migration history uses a completely different name (`legal_corpus_chunks_record_chunk_idx`, still visible as a HISTORY_ONLY finding). Across the entire 1947-object comparison there are exactly two type=u constraint findings total -- the old name (HISTORY_ONLY) and the new name (ACTUAL_ONLY) -- with zero MATCH-classified unique constraints anywhere in the schema, because Prisma’s migration engine in this repo never emits `ADD CONSTRAINT UNIQUE` (verified: 15 occurrences of `CREATE UNIQUE INDEX`, 0 of `ADD CONSTRAINT ... UNIQUE`). This proves an undocumented, out-of-band rename/recreate happened directly against production with no corresponding migration file -- real, untracked drift, not a methodology artifact. Corrected to **TRUE_SCHEMA_DRIFT**.

Affected item:
- `constraints: legal_corpus_chunks|legal_corpus_chunks_record_id_chunk_index_chunk_version_key`

## Methodology observations (patterns, not individual item errors)

1. **Inconsistent application of the "documented absence" bar.** C2 correctly distinguished "schema.prisma itself acknowledges this gap" from "only a migration/script elsewhere documents it" for the two HNSW-index cases, but did not apply that same distinction to `localization_geometry_supersessions`, which has no schema.prisma acknowledgment at all. This is the single largest source of the overturns.

2. **An unverified narrative sentence in the NAME_TRUNCATION_EQUIVALENT evidence.** The very first NAME_TRUNCATION_EQUIVALENT item’s evidence text contains a hedge fragment ("wait-verified-by-script") that reads like leftover scratch reasoning. Independently recomputing the naive-slice(0,63) hypothesis for that pair showed it does NOT reproduce the observed ACTUAL name (61 chars, not a plain 63-char left-truncation) -- C2’s truncation-mechanism narrative is not fully verified/correct even though the disposition itself (both sides define the same object) holds up under direct field-by-field comparison. This does not change any disposition, but the truncation-arithmetic prose should not be trusted at face value.

3. **The NAME_TRUNCATION_EQUIVALENT label covers two different root causes.** Roughly a third of the 50 items are not Postgres 63-byte NAMEDATALEN truncations of one over-long name at all, but pairs of a deliberately short hand-picked name (from an original migration) versus Prisma’s un-mapped default long name. The equivalence conclusion still holds (verified field-by-field for all 50), but the category name overstates a single mechanism where two exist.

4. **Otherwise, the 50 NAME_TRUNCATION_EQUIVALENT and 19 TRUE_SCHEMA_DRIFT dispositions are solid.** Every file/migration citation checked against the actual repository (grep and direct reads) was accurate, and the automated field-by-field re-derivation from `phase-b-comparison.json` found zero definitional mismatches masked by name normalization across all 50 NAME_TRUNCATION_EQUIVALENT items.

## Full item-by-item ledger

| # | object_identity | c2_disposition | verdict | corrected_disposition | confidence |
|---|---|---|---|---|---|
| 1 | `relations: _prisma_migrations|r` | COMPARISON_ARTIFACT | **SUSTAINED** | - | high |
| 2 | `relations: localization_geometry_supersessions|r` | COMPARISON_ARTIFACT | **OVERTURNED** | TRUE_SCHEMA_DRIFT | high |
| 3 | `columns: PostgisImportBatch|imported_at` | OWNER_DECISION_REQUIRED | **SUSTAINED** | - | medium |
| 4 | `columns: PostgisImportBatch|started_at` | OWNER_DECISION_REQUIRED | **SUSTAINED** | - | medium |
| 5 | `columns: Project|property_source_dataset` | TRUE_SCHEMA_DRIFT | **SUSTAINED** | - | high |
| 6 | `columns: Project|property_source_key` | TRUE_SCHEMA_DRIFT | **SUSTAINED** | - | high |
| 7 | `columns: _prisma_migrations|applied_steps_count` | COMPARISON_ARTIFACT | **SUSTAINED** | - | high |
| 8 | `columns: _prisma_migrations|checksum` | COMPARISON_ARTIFACT | **SUSTAINED** | - | high |
| 9 | `columns: _prisma_migrations|finished_at` | COMPARISON_ARTIFACT | **SUSTAINED** | - | high |
| 10 | `columns: _prisma_migrations|id` | COMPARISON_ARTIFACT | **SUSTAINED** | - | high |
| 11 | `columns: _prisma_migrations|logs` | COMPARISON_ARTIFACT | **SUSTAINED** | - | high |
| 12 | `columns: _prisma_migrations|migration_name` | COMPARISON_ARTIFACT | **SUSTAINED** | - | high |
| 13 | `columns: _prisma_migrations|rolled_back_at` | COMPARISON_ARTIFACT | **SUSTAINED** | - | high |
| 14 | `columns: _prisma_migrations|started_at` | COMPARISON_ARTIFACT | **SUSTAINED** | - | high |
| 15 | `columns: legal_corpus_chunk_embeddings|embeddingVector` | TRUE_SCHEMA_DRIFT | **SUSTAINED** | - | high |
| 16 | `columns: legal_corpus_chunk_embeddings|embedding_vector` | TRUE_SCHEMA_DRIFT | **SUSTAINED** | - | high |
| 17 | `columns: legal_corpus_chunks|created_at` | OWNER_DECISION_REQUIRED | **SUSTAINED** | - | medium |
| 18 | `columns: legal_corpus_chunks|embedding_vector` | TRUE_SCHEMA_DRIFT | **SUSTAINED** | - | high |
| 19 | `columns: localization_geometry_supersessions|created_at` | COMPARISON_ARTIFACT | **OVERTURNED** | TRUE_SCHEMA_DRIFT | high |
| 20 | `columns: localization_geometry_supersessions|id` | COMPARISON_ARTIFACT | **OVERTURNED** | TRUE_SCHEMA_DRIFT | high |
| 21 | `columns: localization_geometry_supersessions|predecessor_geometry_artifact_id` | COMPARISON_ARTIFACT | **OVERTURNED** | TRUE_SCHEMA_DRIFT | high |
| 22 | `columns: localization_geometry_supersessions|project_id` | COMPARISON_ARTIFACT | **OVERTURNED** | TRUE_SCHEMA_DRIFT | high |
| 23 | `columns: localization_geometry_supersessions|successor_geometry_artifact_id` | COMPARISON_ARTIFACT | **OVERTURNED** | TRUE_SCHEMA_DRIFT | high |
| 24 | `columns: localization_geometry_supersessions|supersession_artifact_id` | COMPARISON_ARTIFACT | **OVERTURNED** | TRUE_SCHEMA_DRIFT | high |
| 25 | `constraints: _prisma_migrations|_prisma_migrations_pkey` | COMPARISON_ARTIFACT | **SUSTAINED** | - | high |
| 26 | `constraints: localization_geometry_supersession_requests|localization_geometry_supersession_requests_requested_by_fkey` | NAME_TRUNCATION_EQUIVALENT | **SUSTAINED** | - | high |
| 27 | `constraints: localization_geometry_supersession_requests|localization_geometry_supersession_requests_requested_by_u_fkey` | NAME_TRUNCATION_EQUIVALENT | **SUSTAINED** | - | high |
| 28 | `constraints: localization_identity_provisioning_requests|localization_identity_provisioning_requests_requested_by_user_i` | NAME_TRUNCATION_EQUIVALENT | **SUSTAINED** | - | high |
| 29 | `constraints: localization_identity_provisioning_requests|localization_identity_provisioning_requests_requested_by_u_fkey` | NAME_TRUNCATION_EQUIVALENT | **SUSTAINED** | - | high |
| 30 | `constraints: viewer_capability_provisioning_requests|viewer_capability_provisioning_requests_requested_by_user_id_fk` | NAME_TRUNCATION_EQUIVALENT | **SUSTAINED** | - | high |
| 31 | `constraints: viewer_capability_provisioning_requests|viewer_capability_provisioning_requests_requested_by_user__fkey` | NAME_TRUNCATION_EQUIVALENT | **SUSTAINED** | - | high |
| 32 | `constraints: legal_corpus_chunk_embeddings|legal_corpus_chunk_embeddings_materialization_id_fragment__fkey` | NAME_TRUNCATION_EQUIVALENT | **SUSTAINED** | - | high |
| 33 | `constraints: legal_corpus_chunk_embeddings|legal_corpus_chunk_embeddings_materialization_id_fragment_id_fk` | NAME_TRUNCATION_EQUIVALENT | **SUSTAINED** | - | high |
| 34 | `constraints: legal_corpus_chunks|legal_corpus_chunks_record_id_chunk_index_chunk_version_key` | COMPARISON_ARTIFACT | **OVERTURNED** | TRUE_SCHEMA_DRIFT | high |
| 35 | `constraints: localization_geometry_supersessions|localization_geometry_supersessions_pkey` | COMPARISON_ARTIFACT | **OVERTURNED** | TRUE_SCHEMA_DRIFT | high |
| 36 | `constraints: localization_geometry_supersessions|localization_geometry_supersessions_project_id_fkey` | COMPARISON_ARTIFACT | **OVERTURNED** | TRUE_SCHEMA_DRIFT | high |
| 37 | `indexes: DocumentChunk|documentchunk_embedding_hnsw_idx` | TRUE_SCHEMA_DRIFT | **SUSTAINED** | - | high |
| 38 | `indexes: PostgisImportBatch|uq_postgis_import_batch` | TRUE_SCHEMA_DRIFT | **SUSTAINED** | - | high |
| 39 | `indexes: attachments|idx_attachments_document` | TRUE_SCHEMA_DRIFT | **SUSTAINED** | - | high |
| 40 | `indexes: attachments|idx_attachments_parsed` | TRUE_SCHEMA_DRIFT | **SUSTAINED** | - | high |
| 41 | `indexes: _prisma_migrations|_prisma_migrations_pkey` | COMPARISON_ARTIFACT | **SUSTAINED** | - | high |
| 42 | `indexes: legal_corpus_chunks|idx_legal_chunks_embedding_hnsw` | COMPARISON_ARTIFACT | **SUSTAINED** | - | high |
| 43 | `indexes: legal_corpus_chunks|legal_corpus_chunks_chapter_paragraph_idx` | OWNER_DECISION_REQUIRED | **SUSTAINED** | - | medium |
| 44 | `indexes: legal_corpus_materializations|legal_corpus_materializations_identity_key` | NAME_TRUNCATION_EQUIVALENT | **SUSTAINED** | - | high |
| 45 | `indexes: legal_corpus_materializations|legal_corpus_materializations_logical_source_id_registry_ar_key` | NAME_TRUNCATION_EQUIVALENT | **SUSTAINED** | - | high |
| 46 | `indexes: legal_corpus_materialized_chunks|legal_corpus_materialized_chunks_materialization_id_fragmen_key` | NAME_TRUNCATION_EQUIVALENT | **SUSTAINED** | - | high |
| 47 | `indexes: legal_corpus_materialized_chunks|legal_corpus_materialized_chunks_materialization_id_fragment_i` | NAME_TRUNCATION_EQUIVALENT | **SUSTAINED** | - | high |
| 48 | `indexes: legal_corpus_materialized_chunks|legal_corpus_materialized_chunks_materialization_id_sequenc_idx` | NAME_TRUNCATION_EQUIVALENT | **SUSTAINED** | - | high |
| 49 | `indexes: legal_corpus_materialized_chunks|legal_corpus_materialized_chunks_materialization_id_sequence_i` | NAME_TRUNCATION_EQUIVALENT | **SUSTAINED** | - | high |
| 50 | `indexes: localization_geometry_projections|localization_geometry_projections_project_id_geometry_artif_key` | NAME_TRUNCATION_EQUIVALENT | **SUSTAINED** | - | high |
| 51 | `indexes: localization_geometry_projections|localization_geometry_projections_project_id_geometry_artifact_` | NAME_TRUNCATION_EQUIVALENT | **SUSTAINED** | - | high |
| 52 | `indexes: localization_geometry_supersession_requests|localization_geometry_supersession_requests_project_id_pred_idx` | NAME_TRUNCATION_EQUIVALENT | **SUSTAINED** | - | high |
| 53 | `indexes: localization_geometry_supersession_requests|localization_geometry_supersession_requests_subject_idx` | NAME_TRUNCATION_EQUIVALENT | **SUSTAINED** | - | high |
| 54 | `indexes: localization_geometry_supersession_requests|localization_geometry_supersession_requests_status_created__idx` | NAME_TRUNCATION_EQUIVALENT | **SUSTAINED** | - | high |
| 55 | `indexes: localization_geometry_supersession_requests|localization_geometry_supersession_requests_status_created_idx` | NAME_TRUNCATION_EQUIVALENT | **SUSTAINED** | - | high |
| 56 | `indexes: localization_identity_provisioning_requests|localization_identity_provisioning_requests_project_id_geom_idx` | NAME_TRUNCATION_EQUIVALENT | **SUSTAINED** | - | high |
| 57 | `indexes: localization_identity_provisioning_requests|localization_identity_provisioning_requests_project_id_geometry` | NAME_TRUNCATION_EQUIVALENT | **SUSTAINED** | - | high |
| 58 | `indexes: localization_identity_provisioning_requests|localization_identity_provisioning_requests_status_created__idx` | NAME_TRUNCATION_EQUIVALENT | **SUSTAINED** | - | high |
| 59 | `indexes: localization_identity_provisioning_requests|localization_identity_provisioning_requests_status_created_at_i` | NAME_TRUNCATION_EQUIVALENT | **SUSTAINED** | - | high |
| 60 | `indexes: project_assessment_projections|project_assessment_projections_binding_idx` | NAME_TRUNCATION_EQUIVALENT | **SUSTAINED** | - | high |
| 61 | `indexes: project_assessment_projections|project_assessment_projections_project_id_binding_artifact__idx` | NAME_TRUNCATION_EQUIVALENT | **SUSTAINED** | - | high |
| 62 | `indexes: project_assessment_projections|project_assessment_projections_created_idx` | NAME_TRUNCATION_EQUIVALENT | **SUSTAINED** | - | high |
| 63 | `indexes: project_assessment_projections|project_assessment_projections_project_id_created_at_idx` | NAME_TRUNCATION_EQUIVALENT | **SUSTAINED** | - | high |
| 64 | `indexes: project_assessment_projections|project_assessment_projections_project_assessment_key` | NAME_TRUNCATION_EQUIVALENT | **SUSTAINED** | - | high |
| 65 | `indexes: project_assessment_projections|project_assessment_projections_project_id_assessment_artifa_key` | NAME_TRUNCATION_EQUIVALENT | **SUSTAINED** | - | high |
| 66 | `indexes: project_assessment_projections|project_assessment_projections_project_id_localization_geom_idx` | NAME_TRUNCATION_EQUIVALENT | **SUSTAINED** | - | high |
| 67 | `indexes: project_assessment_projections|project_assessment_projections_project_id_localization_geometry` | NAME_TRUNCATION_EQUIVALENT | **SUSTAINED** | - | high |
| 68 | `indexes: project_context_binding_supersessions|project_context_binding_supersessions_artifact_key` | NAME_TRUNCATION_EQUIVALENT | **SUSTAINED** | - | high |
| 69 | `indexes: project_context_binding_supersessions|project_context_binding_supersessions_supersession_artifact_key` | NAME_TRUNCATION_EQUIVALENT | **SUSTAINED** | - | high |
| 70 | `indexes: project_context_binding_supersessions|project_context_binding_supersessions_predecessor_idx` | NAME_TRUNCATION_EQUIVALENT | **SUSTAINED** | - | high |
| 71 | `indexes: project_context_binding_supersessions|project_context_binding_supersessions_project_id_superseded_idx` | NAME_TRUNCATION_EQUIVALENT | **SUSTAINED** | - | high |
| 72 | `indexes: project_context_binding_supersessions|project_context_binding_supersessions_project_id_idx` | NAME_TRUNCATION_EQUIVALENT | **SUSTAINED** | - | high |
| 73 | `indexes: project_context_binding_supersessions|project_context_binding_supersessions_project_idx` | NAME_TRUNCATION_EQUIVALENT | **SUSTAINED** | - | high |
| 74 | `indexes: project_context_binding_supersessions|project_context_binding_supersessions_project_id_successor__idx` | NAME_TRUNCATION_EQUIVALENT | **SUSTAINED** | - | high |
| 75 | `indexes: project_context_binding_supersessions|project_context_binding_supersessions_successor_idx` | NAME_TRUNCATION_EQUIVALENT | **SUSTAINED** | - | high |
| 76 | `indexes: project_context_bindings|project_context_bindings_project_context_idx` | NAME_TRUNCATION_EQUIVALENT | **SUSTAINED** | - | high |
| 77 | `indexes: project_context_bindings|project_context_bindings_project_id_project_context_artifac_idx` | NAME_TRUNCATION_EQUIVALENT | **SUSTAINED** | - | high |
| 78 | `indexes: project_context_bindings|project_context_bindings_project_context_key` | NAME_TRUNCATION_EQUIVALENT | **SUSTAINED** | - | high |
| 79 | `indexes: project_context_bindings|project_context_bindings_project_id_project_context_artifac_key` | NAME_TRUNCATION_EQUIVALENT | **SUSTAINED** | - | high |
| 80 | `indexes: project_context_bootstrap_requests|project_context_bootstrap_requests_project_id_idx` | NAME_TRUNCATION_EQUIVALENT | **SUSTAINED** | - | high |
| 81 | `indexes: project_context_bootstrap_requests|project_context_bootstrap_requests_project_idx` | NAME_TRUNCATION_EQUIVALENT | **SUSTAINED** | - | high |
| 82 | `indexes: project_context_bootstrap_requests|project_context_bootstrap_requests_status_created_at_idx` | NAME_TRUNCATION_EQUIVALENT | **SUSTAINED** | - | high |
| 83 | `indexes: project_context_bootstrap_requests|project_context_bootstrap_requests_status_created_idx` | NAME_TRUNCATION_EQUIVALENT | **SUSTAINED** | - | high |
| 84 | `indexes: viewer_capability_provisioning_requests|viewer_capability_provisioning_requests_project_id_context__idx` | NAME_TRUNCATION_EQUIVALENT | **SUSTAINED** | - | high |
| 85 | `indexes: viewer_capability_provisioning_requests|viewer_capability_provisioning_requests_project_id_ctx_rel_vid_` | NAME_TRUNCATION_EQUIVALENT | **SUSTAINED** | - | high |
| 86 | `indexes: localization_geometry_supersessions|localization_geometry_supersessions_pkey` | COMPARISON_ARTIFACT | **OVERTURNED** | TRUE_SCHEMA_DRIFT | high |
| 87 | `indexes: localization_geometry_supersessions|localization_geometry_supersessions_project_idx` | COMPARISON_ARTIFACT | **OVERTURNED** | TRUE_SCHEMA_DRIFT | high |
| 88 | `indexes: localization_geometry_supersessions|localization_geometry_supersessions_project_supersession_key` | COMPARISON_ARTIFACT | **OVERTURNED** | TRUE_SCHEMA_DRIFT | high |
| 89 | `enums: ConfidenceLevel|HIGH` | TRUE_SCHEMA_DRIFT | **SUSTAINED** | - | high |
| 90 | `enums: ConfidenceLevel|LOW` | TRUE_SCHEMA_DRIFT | **SUSTAINED** | - | high |
| 91 | `enums: DocumentProcessingStatus|CHUNKED` | TRUE_SCHEMA_DRIFT | **SUSTAINED** | - | high |
| 92 | `enums: DocumentProcessingStatus|EMBEDDED` | TRUE_SCHEMA_DRIFT | **SUSTAINED** | - | high |
| 93 | `enums: DocumentProcessingStatus|FAILED` | TRUE_SCHEMA_DRIFT | **SUSTAINED** | - | high |
| 94 | `enums: RequirementVerificationStatus|NEEDS_REVIEW` | TRUE_SCHEMA_DRIFT | **SUSTAINED** | - | high |
| 95 | `enums: RequirementVerificationStatus|REJECTED` | TRUE_SCHEMA_DRIFT | **SUSTAINED** | - | high |
| 96 | `enums: RequirementVerificationStatus|REVIEWED` | TRUE_SCHEMA_DRIFT | **SUSTAINED** | - | high |
| 97 | `enums: RequirementVerificationStatus|VERIFIED` | TRUE_SCHEMA_DRIFT | **SUSTAINED** | - | high |
| 98 | `extensions: vector` | TRUE_SCHEMA_DRIFT | **SUSTAINED** | - | high |

## Detailed challenge evidence per item

### 1. `relations: _prisma_migrations|r`

- **C2 disposition:** COMPARISON_ARTIFACT
- **Verdict:** SUSTAINED
- **Confidence:** high
- **Challenge evidence:** SUSTAINED. _prisma_migrations is Prisma's own internal migration-ledger table -- a well-documented, universal fact of Prisma's tooling (every Prisma project has this table, and `schema.prisma`/`db pull` never represents it) independent of this team's choices, unlike a team-authored design comment. Independently confirmed via phase-b-comparison.json: actual_fingerprint === historical_fingerprint (34caa2ee94d07898196cfebcd9d4d794d254d6feb6a9624089fa2ec8739d7f76), declared is null throughout, for this exact object.

### 2. `relations: localization_geometry_supersessions|r`

- **C2 disposition:** COMPARISON_ARTIFACT
- **Verdict:** OVERTURNED -> TRUE_SCHEMA_DRIFT
- **Confidence:** high
- **Challenge evidence:** OVERTURNED. Independently read prisma/migrations/20260823160000_add_localization_geometry_supersession/migration.sql in full: the cited header comment is real and verbatim, but it documents a POLICY CHOICE ("raw SQL access, not a Prisma model"), not a structural/mechanical impossibility -- nothing in Prisma prevents adding a `model LocalizationGeometrySupersession { ... } @@map("localization_geometry_supersessions")` block; this is categorically different from _prisma_migrations, which Prisma's own tooling refuses to let you model at all (a genuine mechanical fact, verified separately). C2's own evidence text undercuts its 'permanent by design' framing: the same comment says the two sibling tables using identical language (project_assessment_projections, localization_geometry_projections) were LATER PROMOTED to real Prisma models -- establishing this team's own precedent that this pattern is normally temporary, pending promotion, not a permanent exclusion. Most decisively: C2 itself draws a distinguishing line elsewhere in this same report -- compare indexes:legal_corpus_chunks|idx_legal_chunks_embedding_hnsw (COMPARISON_ARTIFACT, because schema.prisma ITSELF carries an explicit inline comment acknowledging the raw-SQL nature) against indexes:PostgisImportBatch|uq_postgis_import_batch and indexes:DocumentChunk|documentchunk_embedding_hnsw_idx (both TRUE_SCHEMA_DRIFT, specifically because schema.prisma is silent/unaware even though a migration or script elsewhere documents the object). Grepped schema.prisma directly: it contains ZERO reference to "localization_geometry_supersessions" anywhere (no model, no comment, no @@map) -- schema.prisma is totally silent, exactly the fact pattern C2 itself classified as TRUE_SCHEMA_DRIFT in the PostgisImportBatch/DocumentChunk cases. Applying C2's own standard consistently: this is undocumented-from-schema.prisma's-perspective drift on a whole public-schema table (6 columns, PK, FK, 3 indexes) that Prisma is supposed to own per this program's own frozen governance rule (public schema owned by Prisma via baseline reconciliation), not a safe comparison artifact.

### 3. `columns: PostgisImportBatch|imported_at`

- **C2 disposition:** OWNER_DECISION_REQUIRED
- **Verdict:** SUSTAINED
- **Confidence:** medium
- **Challenge evidence:** SUSTAINED. grep -n "model PostgisImportBatch" prisma/schema.prisma shows `imported_at DateTime @default(now()) @map("imported_at")`; grep -rl "PostgisImportBatch" prisma/migrations/ returns zero files (no migration exists for this table at all). Independently confirmed the underlying mechanical facts (verified via grep across prisma/migrations: this repo's hand-written raw-SQL migrations use literal `DEFAULT NOW()`, while Prisma's own schema-engine-generated migrations consistently emit `DEFAULT CURRENT_TIMESTAMP` for `@default(now())` -- 91 occurrences of the latter vs. 4 of the raw literal form, all in hand-written files). This proves the now()/CURRENT_TIMESTAMP difference is a functionally-inert textual synonym, not semantic drift -- but which literal text becomes canonical in a regenerated baseline, and whether this table should be brought under Prisma migration governance at all, remain genuine policy choices for the system owner, not something resolvable from repo evidence alone. Not resolved into a different category.

### 4. `columns: PostgisImportBatch|started_at`

- **C2 disposition:** OWNER_DECISION_REQUIRED
- **Verdict:** SUSTAINED
- **Confidence:** medium
- **Challenge evidence:** SUSTAINED. Same schema.prisma model block and same migration-file absence as PostgisImportBatch|imported_at. Independently confirmed the underlying mechanical facts (verified via grep across prisma/migrations: this repo's hand-written raw-SQL migrations use literal `DEFAULT NOW()`, while Prisma's own schema-engine-generated migrations consistently emit `DEFAULT CURRENT_TIMESTAMP` for `@default(now())` -- 91 occurrences of the latter vs. 4 of the raw literal form, all in hand-written files). This proves the now()/CURRENT_TIMESTAMP difference is a functionally-inert textual synonym, not semantic drift -- but which literal text becomes canonical in a regenerated baseline, and whether this table should be brought under Prisma migration governance at all, remain genuine policy choices for the system owner, not something resolvable from repo evidence alone. Not resolved into a different category.

### 5. `columns: Project|property_source_dataset`

- **C2 disposition:** TRUE_SCHEMA_DRIFT
- **Verdict:** SUSTAINED
- **Confidence:** high
- **Challenge evidence:** SUSTAINED. Read prisma/schema.prisma model Project block (lines 139-170): no propertySourceDataset/property_source_dataset field. Grep for "property_source_dataset" across server/ and scripts/: no matches. Independently re-verified this citation directly against the repository (file read / grep) rather than trusting C2's summary; the cited file/line/migration content matches exactly as described, and the raw actual/declared/historical fingerprints and field values in phase-b-comparison.json corroborate the stated fact pattern.

### 6. `columns: Project|property_source_key`

- **C2 disposition:** TRUE_SCHEMA_DRIFT
- **Verdict:** SUSTAINED
- **Confidence:** high
- **Challenge evidence:** SUSTAINED. Same as property_source_dataset: absent from schema.prisma model Project and from all grepped server/scripts source. Independently re-verified this citation directly against the repository (file read / grep) rather than trusting C2's summary; the cited file/line/migration content matches exactly as described, and the raw actual/declared/historical fingerprints and field values in phase-b-comparison.json corroborate the stated fact pattern.

### 7. `columns: _prisma_migrations|applied_steps_count`

- **C2 disposition:** COMPARISON_ARTIFACT
- **Verdict:** SUSTAINED
- **Confidence:** high
- **Challenge evidence:** SUSTAINED. _prisma_migrations is Prisma's own internal migration-ledger table -- a well-documented, universal fact of Prisma's tooling (every Prisma project has this table, and `schema.prisma`/`db pull` never represents it) independent of this team's choices, unlike a team-authored design comment. Independently confirmed via phase-b-comparison.json: actual_fingerprint === historical_fingerprint (24db1ec5562f775caf9bc1b2be055be6a66bb29a986e7677148735953b4c9cce), declared is null throughout, for this exact object.

### 8. `columns: _prisma_migrations|checksum`

- **C2 disposition:** COMPARISON_ARTIFACT
- **Verdict:** SUSTAINED
- **Confidence:** high
- **Challenge evidence:** SUSTAINED. _prisma_migrations is Prisma's own internal migration-ledger table -- a well-documented, universal fact of Prisma's tooling (every Prisma project has this table, and `schema.prisma`/`db pull` never represents it) independent of this team's choices, unlike a team-authored design comment. Independently confirmed via phase-b-comparison.json: actual_fingerprint === historical_fingerprint (49f8b5ba45df2fa188a7c1eb1371343353876bc0ad02ae08ac2b372a89d2bca6), declared is null throughout, for this exact object.

### 9. `columns: _prisma_migrations|finished_at`

- **C2 disposition:** COMPARISON_ARTIFACT
- **Verdict:** SUSTAINED
- **Confidence:** high
- **Challenge evidence:** SUSTAINED. _prisma_migrations is Prisma's own internal migration-ledger table -- a well-documented, universal fact of Prisma's tooling (every Prisma project has this table, and `schema.prisma`/`db pull` never represents it) independent of this team's choices, unlike a team-authored design comment. Independently confirmed via phase-b-comparison.json: actual_fingerprint === historical_fingerprint (6cbd2e4ba88b9f8ad0282a23f7dbd4b04ba920afdae1cc2079bafe920f0b5266), declared is null throughout, for this exact object.

### 10. `columns: _prisma_migrations|id`

- **C2 disposition:** COMPARISON_ARTIFACT
- **Verdict:** SUSTAINED
- **Confidence:** high
- **Challenge evidence:** SUSTAINED. _prisma_migrations is Prisma's own internal migration-ledger table -- a well-documented, universal fact of Prisma's tooling (every Prisma project has this table, and `schema.prisma`/`db pull` never represents it) independent of this team's choices, unlike a team-authored design comment. Independently confirmed via phase-b-comparison.json: actual_fingerprint === historical_fingerprint (40fba9973dfbfa553ad915a7d4724b2195916f23d4ed10ce530e06d5c627e39f), declared is null throughout, for this exact object.

### 11. `columns: _prisma_migrations|logs`

- **C2 disposition:** COMPARISON_ARTIFACT
- **Verdict:** SUSTAINED
- **Confidence:** high
- **Challenge evidence:** SUSTAINED. _prisma_migrations is Prisma's own internal migration-ledger table -- a well-documented, universal fact of Prisma's tooling (every Prisma project has this table, and `schema.prisma`/`db pull` never represents it) independent of this team's choices, unlike a team-authored design comment. Independently confirmed via phase-b-comparison.json: actual_fingerprint === historical_fingerprint (b117a3957ab844ee4cbe54cf33ff26c53a7b251dcd25fd36457faeea6be82cb0), declared is null throughout, for this exact object.

### 12. `columns: _prisma_migrations|migration_name`

- **C2 disposition:** COMPARISON_ARTIFACT
- **Verdict:** SUSTAINED
- **Confidence:** high
- **Challenge evidence:** SUSTAINED. _prisma_migrations is Prisma's own internal migration-ledger table -- a well-documented, universal fact of Prisma's tooling (every Prisma project has this table, and `schema.prisma`/`db pull` never represents it) independent of this team's choices, unlike a team-authored design comment. Independently confirmed via phase-b-comparison.json: actual_fingerprint === historical_fingerprint (9c8cfa9fce57f19aff06ff0f3a3f86af89735e10d4a9be03ad28751be8057501), declared is null throughout, for this exact object.

### 13. `columns: _prisma_migrations|rolled_back_at`

- **C2 disposition:** COMPARISON_ARTIFACT
- **Verdict:** SUSTAINED
- **Confidence:** high
- **Challenge evidence:** SUSTAINED. _prisma_migrations is Prisma's own internal migration-ledger table -- a well-documented, universal fact of Prisma's tooling (every Prisma project has this table, and `schema.prisma`/`db pull` never represents it) independent of this team's choices, unlike a team-authored design comment. Independently confirmed via phase-b-comparison.json: actual_fingerprint === historical_fingerprint (9f5b6887f7d34c78d51973e4c5b67684468aeb45e97b557e0d08a0a9ba8b0532), declared is null throughout, for this exact object.

### 14. `columns: _prisma_migrations|started_at`

- **C2 disposition:** COMPARISON_ARTIFACT
- **Verdict:** SUSTAINED
- **Confidence:** high
- **Challenge evidence:** SUSTAINED. _prisma_migrations is Prisma's own internal migration-ledger table -- a well-documented, universal fact of Prisma's tooling (every Prisma project has this table, and `schema.prisma`/`db pull` never represents it) independent of this team's choices, unlike a team-authored design comment. Independently confirmed via phase-b-comparison.json: actual_fingerprint === historical_fingerprint (eb05c2d566c34091c87d3a06fda91ddc837f37dc9c3bb7d3f811809d1f1f516a), declared is null throughout, for this exact object.

### 15. `columns: legal_corpus_chunk_embeddings|embeddingVector`

- **C2 disposition:** TRUE_SCHEMA_DRIFT
- **Verdict:** SUSTAINED
- **Confidence:** high
- **Challenge evidence:** SUSTAINED. prisma/schema.prisma lines 1370-1393 (model LegalCorpusChunkEmbedding): `embeddingVector Unsupported("vector(3072)")?` -- no @map. Compare with the correctly-mapped sibling field 30 lines later (LegalCorpusChunk.embeddingVector at line 1406: `Unsupported("vector")? @map("embedding_vector")`), showing the intended pattern that was omitted here. Independently re-verified this citation directly against the repository (file read / grep) rather than trusting C2's summary; the cited file/line/migration content matches exactly as described, and the raw actual/declared/historical fingerprints and field values in phase-b-comparison.json corroborate the stated fact pattern.

### 16. `columns: legal_corpus_chunk_embeddings|embedding_vector`

- **C2 disposition:** TRUE_SCHEMA_DRIFT
- **Verdict:** SUSTAINED
- **Confidence:** high
- **Challenge evidence:** SUSTAINED. Same schema.prisma evidence as legal_corpus_chunk_embeddings|embeddingVector. Independently re-verified this citation directly against the repository (file read / grep) rather than trusting C2's summary; the cited file/line/migration content matches exactly as described, and the raw actual/declared/historical fingerprints and field values in phase-b-comparison.json corroborate the stated fact pattern.

### 17. `columns: legal_corpus_chunks|created_at`

- **C2 disposition:** OWNER_DECISION_REQUIRED
- **Verdict:** SUSTAINED
- **Confidence:** medium
- **Challenge evidence:** SUSTAINED. prisma/schema.prisma model LegalCorpusChunk (line ~1407): `createdAt DateTime @default(now()) @map("created_at")`. legal_corpus_chunks has real migration files (20260721180000_legal_corpus_chunks, 20260820120000_governed_legal_chunk_schema_v1) confirming this table IS governed, unlike PostgisImportBatch. Independently confirmed the underlying mechanical facts (verified via grep across prisma/migrations: this repo's hand-written raw-SQL migrations use literal `DEFAULT NOW()`, while Prisma's own schema-engine-generated migrations consistently emit `DEFAULT CURRENT_TIMESTAMP` for `@default(now())` -- 91 occurrences of the latter vs. 4 of the raw literal form, all in hand-written files). This proves the now()/CURRENT_TIMESTAMP difference is a functionally-inert textual synonym, not semantic drift -- but which literal text becomes canonical in a regenerated baseline, and whether this table should be brought under Prisma migration governance at all, remain genuine policy choices for the system owner, not something resolvable from repo evidence alone. Not resolved into a different category.

### 18. `columns: legal_corpus_chunks|embedding_vector`

- **C2 disposition:** TRUE_SCHEMA_DRIFT
- **Verdict:** SUSTAINED
- **Confidence:** high
- **Challenge evidence:** SUSTAINED. prisma/schema.prisma line 1406 read directly: `Unsupported("vector")?` (no dimension) vs ACTUAL/HISTORICAL "vector(768)". Independently re-verified this citation directly against the repository (file read / grep) rather than trusting C2's summary; the cited file/line/migration content matches exactly as described, and the raw actual/declared/historical fingerprints and field values in phase-b-comparison.json corroborate the stated fact pattern.

### 19. `columns: localization_geometry_supersessions|created_at`

- **C2 disposition:** COMPARISON_ARTIFACT
- **Verdict:** OVERTURNED -> TRUE_SCHEMA_DRIFT
- **Confidence:** high
- **Challenge evidence:** OVERTURNED. Independently read prisma/migrations/20260823160000_add_localization_geometry_supersession/migration.sql in full: the cited header comment is real and verbatim, but it documents a POLICY CHOICE ("raw SQL access, not a Prisma model"), not a structural/mechanical impossibility -- nothing in Prisma prevents adding a `model LocalizationGeometrySupersession { ... } @@map("localization_geometry_supersessions")` block; this is categorically different from _prisma_migrations, which Prisma's own tooling refuses to let you model at all (a genuine mechanical fact, verified separately). C2's own evidence text undercuts its 'permanent by design' framing: the same comment says the two sibling tables using identical language (project_assessment_projections, localization_geometry_projections) were LATER PROMOTED to real Prisma models -- establishing this team's own precedent that this pattern is normally temporary, pending promotion, not a permanent exclusion. Most decisively: C2 itself draws a distinguishing line elsewhere in this same report -- compare indexes:legal_corpus_chunks|idx_legal_chunks_embedding_hnsw (COMPARISON_ARTIFACT, because schema.prisma ITSELF carries an explicit inline comment acknowledging the raw-SQL nature) against indexes:PostgisImportBatch|uq_postgis_import_batch and indexes:DocumentChunk|documentchunk_embedding_hnsw_idx (both TRUE_SCHEMA_DRIFT, specifically because schema.prisma is silent/unaware even though a migration or script elsewhere documents the object). Grepped schema.prisma directly: it contains ZERO reference to "localization_geometry_supersessions" anywhere (no model, no comment, no @@map) -- schema.prisma is totally silent, exactly the fact pattern C2 itself classified as TRUE_SCHEMA_DRIFT in the PostgisImportBatch/DocumentChunk cases. Applying C2's own standard consistently: this is undocumented-from-schema.prisma's-perspective drift on a whole public-schema table (6 columns, PK, FK, 3 indexes) that Prisma is supposed to own per this program's own frozen governance rule (public schema owned by Prisma via baseline reconciliation), not a safe comparison artifact.

### 20. `columns: localization_geometry_supersessions|id`

- **C2 disposition:** COMPARISON_ARTIFACT
- **Verdict:** OVERTURNED -> TRUE_SCHEMA_DRIFT
- **Confidence:** high
- **Challenge evidence:** OVERTURNED. Independently read prisma/migrations/20260823160000_add_localization_geometry_supersession/migration.sql in full: the cited header comment is real and verbatim, but it documents a POLICY CHOICE ("raw SQL access, not a Prisma model"), not a structural/mechanical impossibility -- nothing in Prisma prevents adding a `model LocalizationGeometrySupersession { ... } @@map("localization_geometry_supersessions")` block; this is categorically different from _prisma_migrations, which Prisma's own tooling refuses to let you model at all (a genuine mechanical fact, verified separately). C2's own evidence text undercuts its 'permanent by design' framing: the same comment says the two sibling tables using identical language (project_assessment_projections, localization_geometry_projections) were LATER PROMOTED to real Prisma models -- establishing this team's own precedent that this pattern is normally temporary, pending promotion, not a permanent exclusion. Most decisively: C2 itself draws a distinguishing line elsewhere in this same report -- compare indexes:legal_corpus_chunks|idx_legal_chunks_embedding_hnsw (COMPARISON_ARTIFACT, because schema.prisma ITSELF carries an explicit inline comment acknowledging the raw-SQL nature) against indexes:PostgisImportBatch|uq_postgis_import_batch and indexes:DocumentChunk|documentchunk_embedding_hnsw_idx (both TRUE_SCHEMA_DRIFT, specifically because schema.prisma is silent/unaware even though a migration or script elsewhere documents the object). Grepped schema.prisma directly: it contains ZERO reference to "localization_geometry_supersessions" anywhere (no model, no comment, no @@map) -- schema.prisma is totally silent, exactly the fact pattern C2 itself classified as TRUE_SCHEMA_DRIFT in the PostgisImportBatch/DocumentChunk cases. Applying C2's own standard consistently: this is undocumented-from-schema.prisma's-perspective drift on a whole public-schema table (6 columns, PK, FK, 3 indexes) that Prisma is supposed to own per this program's own frozen governance rule (public schema owned by Prisma via baseline reconciliation), not a safe comparison artifact.

### 21. `columns: localization_geometry_supersessions|predecessor_geometry_artifact_id`

- **C2 disposition:** COMPARISON_ARTIFACT
- **Verdict:** OVERTURNED -> TRUE_SCHEMA_DRIFT
- **Confidence:** high
- **Challenge evidence:** OVERTURNED. Independently read prisma/migrations/20260823160000_add_localization_geometry_supersession/migration.sql in full: the cited header comment is real and verbatim, but it documents a POLICY CHOICE ("raw SQL access, not a Prisma model"), not a structural/mechanical impossibility -- nothing in Prisma prevents adding a `model LocalizationGeometrySupersession { ... } @@map("localization_geometry_supersessions")` block; this is categorically different from _prisma_migrations, which Prisma's own tooling refuses to let you model at all (a genuine mechanical fact, verified separately). C2's own evidence text undercuts its 'permanent by design' framing: the same comment says the two sibling tables using identical language (project_assessment_projections, localization_geometry_projections) were LATER PROMOTED to real Prisma models -- establishing this team's own precedent that this pattern is normally temporary, pending promotion, not a permanent exclusion. Most decisively: C2 itself draws a distinguishing line elsewhere in this same report -- compare indexes:legal_corpus_chunks|idx_legal_chunks_embedding_hnsw (COMPARISON_ARTIFACT, because schema.prisma ITSELF carries an explicit inline comment acknowledging the raw-SQL nature) against indexes:PostgisImportBatch|uq_postgis_import_batch and indexes:DocumentChunk|documentchunk_embedding_hnsw_idx (both TRUE_SCHEMA_DRIFT, specifically because schema.prisma is silent/unaware even though a migration or script elsewhere documents the object). Grepped schema.prisma directly: it contains ZERO reference to "localization_geometry_supersessions" anywhere (no model, no comment, no @@map) -- schema.prisma is totally silent, exactly the fact pattern C2 itself classified as TRUE_SCHEMA_DRIFT in the PostgisImportBatch/DocumentChunk cases. Applying C2's own standard consistently: this is undocumented-from-schema.prisma's-perspective drift on a whole public-schema table (6 columns, PK, FK, 3 indexes) that Prisma is supposed to own per this program's own frozen governance rule (public schema owned by Prisma via baseline reconciliation), not a safe comparison artifact.

### 22. `columns: localization_geometry_supersessions|project_id`

- **C2 disposition:** COMPARISON_ARTIFACT
- **Verdict:** OVERTURNED -> TRUE_SCHEMA_DRIFT
- **Confidence:** high
- **Challenge evidence:** OVERTURNED. Independently read prisma/migrations/20260823160000_add_localization_geometry_supersession/migration.sql in full: the cited header comment is real and verbatim, but it documents a POLICY CHOICE ("raw SQL access, not a Prisma model"), not a structural/mechanical impossibility -- nothing in Prisma prevents adding a `model LocalizationGeometrySupersession { ... } @@map("localization_geometry_supersessions")` block; this is categorically different from _prisma_migrations, which Prisma's own tooling refuses to let you model at all (a genuine mechanical fact, verified separately). C2's own evidence text undercuts its 'permanent by design' framing: the same comment says the two sibling tables using identical language (project_assessment_projections, localization_geometry_projections) were LATER PROMOTED to real Prisma models -- establishing this team's own precedent that this pattern is normally temporary, pending promotion, not a permanent exclusion. Most decisively: C2 itself draws a distinguishing line elsewhere in this same report -- compare indexes:legal_corpus_chunks|idx_legal_chunks_embedding_hnsw (COMPARISON_ARTIFACT, because schema.prisma ITSELF carries an explicit inline comment acknowledging the raw-SQL nature) against indexes:PostgisImportBatch|uq_postgis_import_batch and indexes:DocumentChunk|documentchunk_embedding_hnsw_idx (both TRUE_SCHEMA_DRIFT, specifically because schema.prisma is silent/unaware even though a migration or script elsewhere documents the object). Grepped schema.prisma directly: it contains ZERO reference to "localization_geometry_supersessions" anywhere (no model, no comment, no @@map) -- schema.prisma is totally silent, exactly the fact pattern C2 itself classified as TRUE_SCHEMA_DRIFT in the PostgisImportBatch/DocumentChunk cases. Applying C2's own standard consistently: this is undocumented-from-schema.prisma's-perspective drift on a whole public-schema table (6 columns, PK, FK, 3 indexes) that Prisma is supposed to own per this program's own frozen governance rule (public schema owned by Prisma via baseline reconciliation), not a safe comparison artifact.

### 23. `columns: localization_geometry_supersessions|successor_geometry_artifact_id`

- **C2 disposition:** COMPARISON_ARTIFACT
- **Verdict:** OVERTURNED -> TRUE_SCHEMA_DRIFT
- **Confidence:** high
- **Challenge evidence:** OVERTURNED. Independently read prisma/migrations/20260823160000_add_localization_geometry_supersession/migration.sql in full: the cited header comment is real and verbatim, but it documents a POLICY CHOICE ("raw SQL access, not a Prisma model"), not a structural/mechanical impossibility -- nothing in Prisma prevents adding a `model LocalizationGeometrySupersession { ... } @@map("localization_geometry_supersessions")` block; this is categorically different from _prisma_migrations, which Prisma's own tooling refuses to let you model at all (a genuine mechanical fact, verified separately). C2's own evidence text undercuts its 'permanent by design' framing: the same comment says the two sibling tables using identical language (project_assessment_projections, localization_geometry_projections) were LATER PROMOTED to real Prisma models -- establishing this team's own precedent that this pattern is normally temporary, pending promotion, not a permanent exclusion. Most decisively: C2 itself draws a distinguishing line elsewhere in this same report -- compare indexes:legal_corpus_chunks|idx_legal_chunks_embedding_hnsw (COMPARISON_ARTIFACT, because schema.prisma ITSELF carries an explicit inline comment acknowledging the raw-SQL nature) against indexes:PostgisImportBatch|uq_postgis_import_batch and indexes:DocumentChunk|documentchunk_embedding_hnsw_idx (both TRUE_SCHEMA_DRIFT, specifically because schema.prisma is silent/unaware even though a migration or script elsewhere documents the object). Grepped schema.prisma directly: it contains ZERO reference to "localization_geometry_supersessions" anywhere (no model, no comment, no @@map) -- schema.prisma is totally silent, exactly the fact pattern C2 itself classified as TRUE_SCHEMA_DRIFT in the PostgisImportBatch/DocumentChunk cases. Applying C2's own standard consistently: this is undocumented-from-schema.prisma's-perspective drift on a whole public-schema table (6 columns, PK, FK, 3 indexes) that Prisma is supposed to own per this program's own frozen governance rule (public schema owned by Prisma via baseline reconciliation), not a safe comparison artifact.

### 24. `columns: localization_geometry_supersessions|supersession_artifact_id`

- **C2 disposition:** COMPARISON_ARTIFACT
- **Verdict:** OVERTURNED -> TRUE_SCHEMA_DRIFT
- **Confidence:** high
- **Challenge evidence:** OVERTURNED. Independently read prisma/migrations/20260823160000_add_localization_geometry_supersession/migration.sql in full: the cited header comment is real and verbatim, but it documents a POLICY CHOICE ("raw SQL access, not a Prisma model"), not a structural/mechanical impossibility -- nothing in Prisma prevents adding a `model LocalizationGeometrySupersession { ... } @@map("localization_geometry_supersessions")` block; this is categorically different from _prisma_migrations, which Prisma's own tooling refuses to let you model at all (a genuine mechanical fact, verified separately). C2's own evidence text undercuts its 'permanent by design' framing: the same comment says the two sibling tables using identical language (project_assessment_projections, localization_geometry_projections) were LATER PROMOTED to real Prisma models -- establishing this team's own precedent that this pattern is normally temporary, pending promotion, not a permanent exclusion. Most decisively: C2 itself draws a distinguishing line elsewhere in this same report -- compare indexes:legal_corpus_chunks|idx_legal_chunks_embedding_hnsw (COMPARISON_ARTIFACT, because schema.prisma ITSELF carries an explicit inline comment acknowledging the raw-SQL nature) against indexes:PostgisImportBatch|uq_postgis_import_batch and indexes:DocumentChunk|documentchunk_embedding_hnsw_idx (both TRUE_SCHEMA_DRIFT, specifically because schema.prisma is silent/unaware even though a migration or script elsewhere documents the object). Grepped schema.prisma directly: it contains ZERO reference to "localization_geometry_supersessions" anywhere (no model, no comment, no @@map) -- schema.prisma is totally silent, exactly the fact pattern C2 itself classified as TRUE_SCHEMA_DRIFT in the PostgisImportBatch/DocumentChunk cases. Applying C2's own standard consistently: this is undocumented-from-schema.prisma's-perspective drift on a whole public-schema table (6 columns, PK, FK, 3 indexes) that Prisma is supposed to own per this program's own frozen governance rule (public schema owned by Prisma via baseline reconciliation), not a safe comparison artifact.

### 25. `constraints: _prisma_migrations|_prisma_migrations_pkey`

- **C2 disposition:** COMPARISON_ARTIFACT
- **Verdict:** SUSTAINED
- **Confidence:** high
- **Challenge evidence:** SUSTAINED. _prisma_migrations is Prisma's own internal migration-ledger table -- a well-documented, universal fact of Prisma's tooling (every Prisma project has this table, and `schema.prisma`/`db pull` never represents it) independent of this team's choices, unlike a team-authored design comment. Independently confirmed via phase-b-comparison.json: actual_fingerprint === historical_fingerprint (d082ea98462a1bfa6e670ee4e85830aeb83a8bff14f5ac20e5b178753f8da46c), declared is null throughout, for this exact object.

### 26. `constraints: localization_geometry_supersession_requests|localization_geometry_supersession_requests_requested_by_fkey`

- **C2 disposition:** NAME_TRUNCATION_EQUIVALENT
- **Verdict:** SUSTAINED
- **Confidence:** high
- **Challenge evidence:** SUSTAINED. Independently re-derived the raw actual/declared/historical objects from phase-b-comparison.json for this key and its paired truncated-name counterpart (identified via C2's own cross-reference), normalized out the object's own name token from the DDL/definition text, and compared every remaining field (relation, is_unique, is_primary, predicate, column list / FK reference / ON UPDATE-ON DELETE actions as applicable) programmatically. All fields matched byte-for-byte between the two truncated spellings; the object graph confirms this is a single physical object represented under two different auto-generated names arising from Postgres's 63-byte NAMEDATALEN identifier limit (in several cases, from a hand-picked short name in an original migration vs. Prisma's un-mapped default long name -- a related but distinct root cause than pure truncation-of-one-name, noted as a methodology imprecision but not a substantive error since the definitional-equivalence proof holds regardless of naming mechanism). classification=DECLARED_DRIFT.

### 27. `constraints: localization_geometry_supersession_requests|localization_geometry_supersession_requests_requested_by_u_fkey`

- **C2 disposition:** NAME_TRUNCATION_EQUIVALENT
- **Verdict:** SUSTAINED
- **Confidence:** high
- **Challenge evidence:** SUSTAINED. Independently re-derived the raw actual/declared/historical objects from phase-b-comparison.json for this key and its paired truncated-name counterpart (identified via C2's own cross-reference), normalized out the object's own name token from the DDL/definition text, and compared every remaining field (relation, is_unique, is_primary, predicate, column list / FK reference / ON UPDATE-ON DELETE actions as applicable) programmatically. All fields matched byte-for-byte between the two truncated spellings; the object graph confirms this is a single physical object represented under two different auto-generated names arising from Postgres's 63-byte NAMEDATALEN identifier limit (in several cases, from a hand-picked short name in an original migration vs. Prisma's un-mapped default long name -- a related but distinct root cause than pure truncation-of-one-name, noted as a methodology imprecision but not a substantive error since the definitional-equivalence proof holds regardless of naming mechanism). classification=DECLARED_ONLY.

### 28. `constraints: localization_identity_provisioning_requests|localization_identity_provisioning_requests_requested_by_user_i`

- **C2 disposition:** NAME_TRUNCATION_EQUIVALENT
- **Verdict:** SUSTAINED
- **Confidence:** high
- **Challenge evidence:** SUSTAINED. Independently re-derived the raw actual/declared/historical objects from phase-b-comparison.json for this key and its paired truncated-name counterpart (identified via C2's own cross-reference), normalized out the object's own name token from the DDL/definition text, and compared every remaining field (relation, is_unique, is_primary, predicate, column list / FK reference / ON UPDATE-ON DELETE actions as applicable) programmatically. All fields matched byte-for-byte between the two truncated spellings; the object graph confirms this is a single physical object represented under two different auto-generated names arising from Postgres's 63-byte NAMEDATALEN identifier limit (in several cases, from a hand-picked short name in an original migration vs. Prisma's un-mapped default long name -- a related but distinct root cause than pure truncation-of-one-name, noted as a methodology imprecision but not a substantive error since the definitional-equivalence proof holds regardless of naming mechanism). classification=DECLARED_DRIFT.

### 29. `constraints: localization_identity_provisioning_requests|localization_identity_provisioning_requests_requested_by_u_fkey`

- **C2 disposition:** NAME_TRUNCATION_EQUIVALENT
- **Verdict:** SUSTAINED
- **Confidence:** high
- **Challenge evidence:** SUSTAINED. Independently re-derived the raw actual/declared/historical objects from phase-b-comparison.json for this key and its paired truncated-name counterpart (identified via C2's own cross-reference), normalized out the object's own name token from the DDL/definition text, and compared every remaining field (relation, is_unique, is_primary, predicate, column list / FK reference / ON UPDATE-ON DELETE actions as applicable) programmatically. All fields matched byte-for-byte between the two truncated spellings; the object graph confirms this is a single physical object represented under two different auto-generated names arising from Postgres's 63-byte NAMEDATALEN identifier limit (in several cases, from a hand-picked short name in an original migration vs. Prisma's un-mapped default long name -- a related but distinct root cause than pure truncation-of-one-name, noted as a methodology imprecision but not a substantive error since the definitional-equivalence proof holds regardless of naming mechanism). classification=DECLARED_ONLY.

### 30. `constraints: viewer_capability_provisioning_requests|viewer_capability_provisioning_requests_requested_by_user_id_fk`

- **C2 disposition:** NAME_TRUNCATION_EQUIVALENT
- **Verdict:** SUSTAINED
- **Confidence:** high
- **Challenge evidence:** SUSTAINED. Independently re-derived the raw actual/declared/historical objects from phase-b-comparison.json for this key and its paired truncated-name counterpart (identified via C2's own cross-reference), normalized out the object's own name token from the DDL/definition text, and compared every remaining field (relation, is_unique, is_primary, predicate, column list / FK reference / ON UPDATE-ON DELETE actions as applicable) programmatically. All fields matched byte-for-byte between the two truncated spellings; the object graph confirms this is a single physical object represented under two different auto-generated names arising from Postgres's 63-byte NAMEDATALEN identifier limit (in several cases, from a hand-picked short name in an original migration vs. Prisma's un-mapped default long name -- a related but distinct root cause than pure truncation-of-one-name, noted as a methodology imprecision but not a substantive error since the definitional-equivalence proof holds regardless of naming mechanism). classification=DECLARED_DRIFT.

### 31. `constraints: viewer_capability_provisioning_requests|viewer_capability_provisioning_requests_requested_by_user__fkey`

- **C2 disposition:** NAME_TRUNCATION_EQUIVALENT
- **Verdict:** SUSTAINED
- **Confidence:** high
- **Challenge evidence:** SUSTAINED. Independently re-derived the raw actual/declared/historical objects from phase-b-comparison.json for this key and its paired truncated-name counterpart (identified via C2's own cross-reference), normalized out the object's own name token from the DDL/definition text, and compared every remaining field (relation, is_unique, is_primary, predicate, column list / FK reference / ON UPDATE-ON DELETE actions as applicable) programmatically. All fields matched byte-for-byte between the two truncated spellings; the object graph confirms this is a single physical object represented under two different auto-generated names arising from Postgres's 63-byte NAMEDATALEN identifier limit (in several cases, from a hand-picked short name in an original migration vs. Prisma's un-mapped default long name -- a related but distinct root cause than pure truncation-of-one-name, noted as a methodology imprecision but not a substantive error since the definitional-equivalence proof holds regardless of naming mechanism). classification=DECLARED_ONLY.

### 32. `constraints: legal_corpus_chunk_embeddings|legal_corpus_chunk_embeddings_materialization_id_fragment__fkey`

- **C2 disposition:** NAME_TRUNCATION_EQUIVALENT
- **Verdict:** SUSTAINED
- **Confidence:** high
- **Challenge evidence:** SUSTAINED. Independently re-derived the raw actual/declared/historical objects from phase-b-comparison.json for this key and its paired truncated-name counterpart (identified via C2's own cross-reference), normalized out the object's own name token from the DDL/definition text, and compared every remaining field (relation, is_unique, is_primary, predicate, column list / FK reference / ON UPDATE-ON DELETE actions as applicable) programmatically. All fields matched byte-for-byte between the two truncated spellings; the object graph confirms this is a single physical object represented under two different auto-generated names arising from Postgres's 63-byte NAMEDATALEN identifier limit (in several cases, from a hand-picked short name in an original migration vs. Prisma's un-mapped default long name -- a related but distinct root cause than pure truncation-of-one-name, noted as a methodology imprecision but not a substantive error since the definitional-equivalence proof holds regardless of naming mechanism). classification=DECLARED_ONLY.

### 33. `constraints: legal_corpus_chunk_embeddings|legal_corpus_chunk_embeddings_materialization_id_fragment_id_fk`

- **C2 disposition:** NAME_TRUNCATION_EQUIVALENT
- **Verdict:** SUSTAINED
- **Confidence:** high
- **Challenge evidence:** SUSTAINED. Independently re-derived the raw actual/declared/historical objects from phase-b-comparison.json for this key and its paired truncated-name counterpart (identified via C2's own cross-reference), normalized out the object's own name token from the DDL/definition text, and compared every remaining field (relation, is_unique, is_primary, predicate, column list / FK reference / ON UPDATE-ON DELETE actions as applicable) programmatically. All fields matched byte-for-byte between the two truncated spellings; the object graph confirms this is a single physical object represented under two different auto-generated names arising from Postgres's 63-byte NAMEDATALEN identifier limit (in several cases, from a hand-picked short name in an original migration vs. Prisma's un-mapped default long name -- a related but distinct root cause than pure truncation-of-one-name, noted as a methodology imprecision but not a substantive error since the definitional-equivalence proof holds regardless of naming mechanism). classification=DECLARED_DRIFT.

### 34. `constraints: legal_corpus_chunks|legal_corpus_chunks_record_id_chunk_index_chunk_version_key`

- **C2 disposition:** COMPARISON_ARTIFACT
- **Verdict:** OVERTURNED -> TRUE_SCHEMA_DRIFT
- **Confidence:** high
- **Challenge evidence:** OVERTURNED. Traced the constraint's provenance through every migration touching legal_corpus_chunks (grep -rn across prisma/migrations/): the ONLY migration that ever creates a unique constraint on (record_id, chunk_index, chunk_version) is 20260721180000_legal_corpus_chunks/migration.sql line 20, which names it `legal_corpus_chunks_record_chunk_idx` via inline `CONSTRAINT ... UNIQUE` -- a DIFFERENT name than the one in this HOLD item. Cross-checked phase-b-comparison.json's full constraints section (not just the 98 held items): there are only 2 constraint findings of type='u' (unique) in the ENTIRE 1947-object comparison -- one HISTORY_ONLY named exactly `legal_corpus_chunks_record_chunk_idx` (the original migration's name, no longer in production) and one ACTUAL_ONLY named `legal_corpus_chunks_record_id_chunk_index_chunk_version_key` (today's production name, matching Prisma's default @@unique naming convention with no explicit map in schema.prisma line 1412). This proves an undocumented rename/recreate happened directly against production at some point with NO corresponding migration file -- not a 'Phase B constraint-extraction gap' as C2 claimed. Separately verified C2's own extraction-gap theory is itself unsupported: grepped all migration files for 'ADD CONSTRAINT' + 'UNIQUE' (0 occurrences) vs 'CREATE UNIQUE INDEX' (15 occurrences) -- Prisma's migration engine in this repo NEVER emits a true unique CONSTRAINT for @@unique, only a bare INDEX; this is a genuine, real, structural asymmetry (an untracked out-of-band DDL change to production, not an extraction bug), so it is real drift, just not the drift C2 attributed it to.

### 35. `constraints: localization_geometry_supersessions|localization_geometry_supersessions_pkey`

- **C2 disposition:** COMPARISON_ARTIFACT
- **Verdict:** OVERTURNED -> TRUE_SCHEMA_DRIFT
- **Confidence:** high
- **Challenge evidence:** OVERTURNED. Independently read prisma/migrations/20260823160000_add_localization_geometry_supersession/migration.sql in full: the cited header comment is real and verbatim, but it documents a POLICY CHOICE ("raw SQL access, not a Prisma model"), not a structural/mechanical impossibility -- nothing in Prisma prevents adding a `model LocalizationGeometrySupersession { ... } @@map("localization_geometry_supersessions")` block; this is categorically different from _prisma_migrations, which Prisma's own tooling refuses to let you model at all (a genuine mechanical fact, verified separately). C2's own evidence text undercuts its 'permanent by design' framing: the same comment says the two sibling tables using identical language (project_assessment_projections, localization_geometry_projections) were LATER PROMOTED to real Prisma models -- establishing this team's own precedent that this pattern is normally temporary, pending promotion, not a permanent exclusion. Most decisively: C2 itself draws a distinguishing line elsewhere in this same report -- compare indexes:legal_corpus_chunks|idx_legal_chunks_embedding_hnsw (COMPARISON_ARTIFACT, because schema.prisma ITSELF carries an explicit inline comment acknowledging the raw-SQL nature) against indexes:PostgisImportBatch|uq_postgis_import_batch and indexes:DocumentChunk|documentchunk_embedding_hnsw_idx (both TRUE_SCHEMA_DRIFT, specifically because schema.prisma is silent/unaware even though a migration or script elsewhere documents the object). Grepped schema.prisma directly: it contains ZERO reference to "localization_geometry_supersessions" anywhere (no model, no comment, no @@map) -- schema.prisma is totally silent, exactly the fact pattern C2 itself classified as TRUE_SCHEMA_DRIFT in the PostgisImportBatch/DocumentChunk cases. Applying C2's own standard consistently: this is undocumented-from-schema.prisma's-perspective drift on a whole public-schema table (6 columns, PK, FK, 3 indexes) that Prisma is supposed to own per this program's own frozen governance rule (public schema owned by Prisma via baseline reconciliation), not a safe comparison artifact.

### 36. `constraints: localization_geometry_supersessions|localization_geometry_supersessions_project_id_fkey`

- **C2 disposition:** COMPARISON_ARTIFACT
- **Verdict:** OVERTURNED -> TRUE_SCHEMA_DRIFT
- **Confidence:** high
- **Challenge evidence:** OVERTURNED. Independently read prisma/migrations/20260823160000_add_localization_geometry_supersession/migration.sql in full: the cited header comment is real and verbatim, but it documents a POLICY CHOICE ("raw SQL access, not a Prisma model"), not a structural/mechanical impossibility -- nothing in Prisma prevents adding a `model LocalizationGeometrySupersession { ... } @@map("localization_geometry_supersessions")` block; this is categorically different from _prisma_migrations, which Prisma's own tooling refuses to let you model at all (a genuine mechanical fact, verified separately). C2's own evidence text undercuts its 'permanent by design' framing: the same comment says the two sibling tables using identical language (project_assessment_projections, localization_geometry_projections) were LATER PROMOTED to real Prisma models -- establishing this team's own precedent that this pattern is normally temporary, pending promotion, not a permanent exclusion. Most decisively: C2 itself draws a distinguishing line elsewhere in this same report -- compare indexes:legal_corpus_chunks|idx_legal_chunks_embedding_hnsw (COMPARISON_ARTIFACT, because schema.prisma ITSELF carries an explicit inline comment acknowledging the raw-SQL nature) against indexes:PostgisImportBatch|uq_postgis_import_batch and indexes:DocumentChunk|documentchunk_embedding_hnsw_idx (both TRUE_SCHEMA_DRIFT, specifically because schema.prisma is silent/unaware even though a migration or script elsewhere documents the object). Grepped schema.prisma directly: it contains ZERO reference to "localization_geometry_supersessions" anywhere (no model, no comment, no @@map) -- schema.prisma is totally silent, exactly the fact pattern C2 itself classified as TRUE_SCHEMA_DRIFT in the PostgisImportBatch/DocumentChunk cases. Applying C2's own standard consistently: this is undocumented-from-schema.prisma's-perspective drift on a whole public-schema table (6 columns, PK, FK, 3 indexes) that Prisma is supposed to own per this program's own frozen governance rule (public schema owned by Prisma via baseline reconciliation), not a safe comparison artifact.

### 37. `indexes: DocumentChunk|documentchunk_embedding_hnsw_idx`

- **C2 disposition:** TRUE_SCHEMA_DRIFT
- **Verdict:** SUSTAINED
- **Confidence:** high
- **Challenge evidence:** SUSTAINED. prisma/schema.prisma model DocumentChunk (lines 646-664): no hnsw index declared. grep -rli "hnsw" prisma/migrations/ finds only 20260627_hnsw_legal_chunks.sql and the legal_corpus_chunks migration -- nothing for DocumentChunk. Independently re-verified this citation directly against the repository (file read / grep) rather than trusting C2's summary; the cited file/line/migration content matches exactly as described, and the raw actual/declared/historical fingerprints and field values in phase-b-comparison.json corroborate the stated fact pattern.

### 38. `indexes: PostgisImportBatch|uq_postgis_import_batch`

- **C2 disposition:** TRUE_SCHEMA_DRIFT
- **Verdict:** SUSTAINED
- **Confidence:** high
- **Challenge evidence:** SUSTAINED. scripts/db/add_partial_index.sql (full file): "CREATE UNIQUE INDEX IF NOT EXISTS uq_postgis_import_batch ON \"public\".\"PostgisImportBatch\" (content_bundle_sha256, target_schema, target_table) WHERE status = 'SUCCESS';" with a Swedish comment explaining the intent (prevent re-importing the same bundle to the same target while allowing parallel failed/planned attempts). This exactly matches ACTUAL's definition. Independently re-verified this citation directly against the repository (file read / grep) rather than trusting C2's summary; the cited file/line/migration content matches exactly as described, and the raw actual/declared/historical fingerprints and field values in phase-b-comparison.json corroborate the stated fact pattern.

### 39. `indexes: attachments|idx_attachments_document`

- **C2 disposition:** TRUE_SCHEMA_DRIFT
- **Verdict:** SUSTAINED
- **Confidence:** high
- **Challenge evidence:** SUSTAINED. comp.json indexes for table "attachments" show FOUR rows: attachments_document_id_idx (MATCH, ratified), attachments_parsed_idx (MATCH, ratified), attachments_pkey (MATCH, ratified), AND this held idx_attachments_document (DECLARED_DRIFT). prisma/migrations/20260512055145_init/migration.sql line 1397: `CREATE INDEX "idx_attachments_document" ON "public"."attachments"("document_id");` -- the original, now-superseded index. schema.prisma model OutlookAttachment (@@map("attachments")) declares `@@index([documentId])`, which Prisma's standard naming convention renders as "attachments_document_id_idx", the OTHER (matching, ratified) index. Independently re-verified this citation directly against the repository (file read / grep) rather than trusting C2's summary; the cited file/line/migration content matches exactly as described, and the raw actual/declared/historical fingerprints and field values in phase-b-comparison.json corroborate the stated fact pattern.

### 40. `indexes: attachments|idx_attachments_parsed`

- **C2 disposition:** TRUE_SCHEMA_DRIFT
- **Verdict:** SUSTAINED
- **Confidence:** high
- **Challenge evidence:** SUSTAINED. prisma/migrations/20260512055145_init/migration.sql line 1400: `CREATE INDEX "idx_attachments_parsed" ON "public"."attachments"("parsed");`. Confirmed against comp.json's ratified attachments_parsed_idx MATCH row. Independently re-verified this citation directly against the repository (file read / grep) rather than trusting C2's summary; the cited file/line/migration content matches exactly as described, and the raw actual/declared/historical fingerprints and field values in phase-b-comparison.json corroborate the stated fact pattern.

### 41. `indexes: _prisma_migrations|_prisma_migrations_pkey`

- **C2 disposition:** COMPARISON_ARTIFACT
- **Verdict:** SUSTAINED
- **Confidence:** high
- **Challenge evidence:** SUSTAINED. _prisma_migrations is Prisma's own internal migration-ledger table -- a well-documented, universal fact of Prisma's tooling (every Prisma project has this table, and `schema.prisma`/`db pull` never represents it) independent of this team's choices, unlike a team-authored design comment. Independently confirmed via phase-b-comparison.json: actual_fingerprint === historical_fingerprint (16c0de471f3d7a337bc302c45de8112edea8ca030d998fa7c821ab662e248727), declared is null throughout, for this exact object.

### 42. `indexes: legal_corpus_chunks|idx_legal_chunks_embedding_hnsw`

- **C2 disposition:** COMPARISON_ARTIFACT
- **Verdict:** SUSTAINED
- **Confidence:** high
- **Challenge evidence:** SUSTAINED. Independently read prisma/migrations/20260627_hnsw_legal_chunks.sql in full: it creates exactly this index (name, hnsw access method, vector_cosine_ops, m=16/ef_construction=64, WHERE embedding_vector IS NOT NULL) with a dated, detailed Swedish comment explaining the rationale. Also confirmed the cited schema.prisma comment at lines 1382-1383 ("Unsupported by the Prisma client -- written/read via raw SQL...") is real and sits directly on the sibling LegalCorpusChunkEmbedding.embeddingVector field, corroborating that this is a documented, IN-SCHEMA-ACKNOWLEDGED raw-SQL pattern -- structurally different from a bare team comment buried only in a migration file (see the overturned localization_geometry_supersessions items, which lack any such schema.prisma-side acknowledgment).

### 43. `indexes: legal_corpus_chunks|legal_corpus_chunks_chapter_paragraph_idx`

- **C2 disposition:** OWNER_DECISION_REQUIRED
- **Verdict:** SUSTAINED
- **Confidence:** medium
- **Challenge evidence:** SUSTAINED, WITH A CORRECTION TO C2'S EVIDENCE. C2 claimed: "the one migration that does create a same-named-but-different index ('idx_legal_chunks_chapter_paragraph', no predicate, ...) is a different, apparently-retired object." This is factually WRONG: I read prisma/migrations/20260721180000_legal_corpus_chunks/migration.sql lines 26-28 directly and it DOES carry the identical predicate `WHERE chapter IS NOT NULL AND paragraph IS NOT NULL`; cross-checked the raw HISTORY_ONLY finding for that old name in phase-b-comparison.json and its historical.predicate field is byte-identical to ACTUAL's predicate on the item in question. So the provenance C2 said was unfindable IS findable: the current partial index is simply a renamed continuation of the original, deliberately-created (Swedish-commented, dated) partial index -- the rename likely occurred when someone added `@@index([chapter, paragraph])` to schema.prisma and renamed production's index to match Prisma's default name while an ALTER INDEX RENAME (which does not touch the WHERE clause) preserved the old predicate. However, this correction resolves only the PROVENANCE question, not the INTENT question C2's disposition actually rests on: whether the surviving partial predicate is a still-wanted, permanent performance feature that schema.prisma should be updated/documented to preserve (schema.prisma cannot express a WHERE-partial index in @@index at all, confirmed by the total absence of any such syntax anywhere in the 1400+ line schema.prisma file), or an accidental leftover nobody intended to keep. That is a genuine judgment call outside what repo evidence can settle, so OWNER_DECISION_REQUIRED is still the correct disposition -- just for a narrower, corrected reason than C2 stated.

### 44. `indexes: legal_corpus_materializations|legal_corpus_materializations_identity_key`

- **C2 disposition:** NAME_TRUNCATION_EQUIVALENT
- **Verdict:** SUSTAINED
- **Confidence:** high
- **Challenge evidence:** SUSTAINED. Independently re-derived the raw actual/declared/historical objects from phase-b-comparison.json for this key and its paired truncated-name counterpart (identified via C2's own cross-reference), normalized out the object's own name token from the DDL/definition text, and compared every remaining field (relation, is_unique, is_primary, predicate, column list / FK reference / ON UPDATE-ON DELETE actions as applicable) programmatically. All fields matched byte-for-byte between the two truncated spellings; the object graph confirms this is a single physical object represented under two different auto-generated names arising from Postgres's 63-byte NAMEDATALEN identifier limit (in several cases, from a hand-picked short name in an original migration vs. Prisma's un-mapped default long name -- a related but distinct root cause than pure truncation-of-one-name, noted as a methodology imprecision but not a substantive error since the definitional-equivalence proof holds regardless of naming mechanism). classification=DECLARED_DRIFT.

### 45. `indexes: legal_corpus_materializations|legal_corpus_materializations_logical_source_id_registry_ar_key`

- **C2 disposition:** NAME_TRUNCATION_EQUIVALENT
- **Verdict:** SUSTAINED
- **Confidence:** high
- **Challenge evidence:** SUSTAINED. Independently re-derived the raw actual/declared/historical objects from phase-b-comparison.json for this key and its paired truncated-name counterpart (identified via C2's own cross-reference), normalized out the object's own name token from the DDL/definition text, and compared every remaining field (relation, is_unique, is_primary, predicate, column list / FK reference / ON UPDATE-ON DELETE actions as applicable) programmatically. All fields matched byte-for-byte between the two truncated spellings; the object graph confirms this is a single physical object represented under two different auto-generated names arising from Postgres's 63-byte NAMEDATALEN identifier limit (in several cases, from a hand-picked short name in an original migration vs. Prisma's un-mapped default long name -- a related but distinct root cause than pure truncation-of-one-name, noted as a methodology imprecision but not a substantive error since the definitional-equivalence proof holds regardless of naming mechanism). classification=DECLARED_ONLY.

### 46. `indexes: legal_corpus_materialized_chunks|legal_corpus_materialized_chunks_materialization_id_fragmen_key`

- **C2 disposition:** NAME_TRUNCATION_EQUIVALENT
- **Verdict:** SUSTAINED
- **Confidence:** high
- **Challenge evidence:** SUSTAINED. Independently re-derived the raw actual/declared/historical objects from phase-b-comparison.json for this key and its paired truncated-name counterpart (identified via C2's own cross-reference), normalized out the object's own name token from the DDL/definition text, and compared every remaining field (relation, is_unique, is_primary, predicate, column list / FK reference / ON UPDATE-ON DELETE actions as applicable) programmatically. All fields matched byte-for-byte between the two truncated spellings; the object graph confirms this is a single physical object represented under two different auto-generated names arising from Postgres's 63-byte NAMEDATALEN identifier limit (in several cases, from a hand-picked short name in an original migration vs. Prisma's un-mapped default long name -- a related but distinct root cause than pure truncation-of-one-name, noted as a methodology imprecision but not a substantive error since the definitional-equivalence proof holds regardless of naming mechanism). classification=DECLARED_ONLY.

### 47. `indexes: legal_corpus_materialized_chunks|legal_corpus_materialized_chunks_materialization_id_fragment_i`

- **C2 disposition:** NAME_TRUNCATION_EQUIVALENT
- **Verdict:** SUSTAINED
- **Confidence:** high
- **Challenge evidence:** SUSTAINED. Independently re-derived the raw actual/declared/historical objects from phase-b-comparison.json for this key and its paired truncated-name counterpart (identified via C2's own cross-reference), normalized out the object's own name token from the DDL/definition text, and compared every remaining field (relation, is_unique, is_primary, predicate, column list / FK reference / ON UPDATE-ON DELETE actions as applicable) programmatically. All fields matched byte-for-byte between the two truncated spellings; the object graph confirms this is a single physical object represented under two different auto-generated names arising from Postgres's 63-byte NAMEDATALEN identifier limit (in several cases, from a hand-picked short name in an original migration vs. Prisma's un-mapped default long name -- a related but distinct root cause than pure truncation-of-one-name, noted as a methodology imprecision but not a substantive error since the definitional-equivalence proof holds regardless of naming mechanism). classification=DECLARED_DRIFT.

### 48. `indexes: legal_corpus_materialized_chunks|legal_corpus_materialized_chunks_materialization_id_sequenc_idx`

- **C2 disposition:** NAME_TRUNCATION_EQUIVALENT
- **Verdict:** SUSTAINED
- **Confidence:** high
- **Challenge evidence:** SUSTAINED. Independently re-derived the raw actual/declared/historical objects from phase-b-comparison.json for this key and its paired truncated-name counterpart (identified via C2's own cross-reference), normalized out the object's own name token from the DDL/definition text, and compared every remaining field (relation, is_unique, is_primary, predicate, column list / FK reference / ON UPDATE-ON DELETE actions as applicable) programmatically. All fields matched byte-for-byte between the two truncated spellings; the object graph confirms this is a single physical object represented under two different auto-generated names arising from Postgres's 63-byte NAMEDATALEN identifier limit (in several cases, from a hand-picked short name in an original migration vs. Prisma's un-mapped default long name -- a related but distinct root cause than pure truncation-of-one-name, noted as a methodology imprecision but not a substantive error since the definitional-equivalence proof holds regardless of naming mechanism). classification=DECLARED_ONLY.

### 49. `indexes: legal_corpus_materialized_chunks|legal_corpus_materialized_chunks_materialization_id_sequence_i`

- **C2 disposition:** NAME_TRUNCATION_EQUIVALENT
- **Verdict:** SUSTAINED
- **Confidence:** high
- **Challenge evidence:** SUSTAINED. Independently re-derived the raw actual/declared/historical objects from phase-b-comparison.json for this key and its paired truncated-name counterpart (identified via C2's own cross-reference), normalized out the object's own name token from the DDL/definition text, and compared every remaining field (relation, is_unique, is_primary, predicate, column list / FK reference / ON UPDATE-ON DELETE actions as applicable) programmatically. All fields matched byte-for-byte between the two truncated spellings; the object graph confirms this is a single physical object represented under two different auto-generated names arising from Postgres's 63-byte NAMEDATALEN identifier limit (in several cases, from a hand-picked short name in an original migration vs. Prisma's un-mapped default long name -- a related but distinct root cause than pure truncation-of-one-name, noted as a methodology imprecision but not a substantive error since the definitional-equivalence proof holds regardless of naming mechanism). classification=DECLARED_DRIFT.

### 50. `indexes: localization_geometry_projections|localization_geometry_projections_project_id_geometry_artif_key`

- **C2 disposition:** NAME_TRUNCATION_EQUIVALENT
- **Verdict:** SUSTAINED
- **Confidence:** high
- **Challenge evidence:** SUSTAINED. Independently re-derived the raw actual/declared/historical objects from phase-b-comparison.json for this key and its paired truncated-name counterpart (identified via C2's own cross-reference), normalized out the object's own name token from the DDL/definition text, and compared every remaining field (relation, is_unique, is_primary, predicate, column list / FK reference / ON UPDATE-ON DELETE actions as applicable) programmatically. All fields matched byte-for-byte between the two truncated spellings; the object graph confirms this is a single physical object represented under two different auto-generated names arising from Postgres's 63-byte NAMEDATALEN identifier limit (in several cases, from a hand-picked short name in an original migration vs. Prisma's un-mapped default long name -- a related but distinct root cause than pure truncation-of-one-name, noted as a methodology imprecision but not a substantive error since the definitional-equivalence proof holds regardless of naming mechanism). classification=DECLARED_ONLY.

### 51. `indexes: localization_geometry_projections|localization_geometry_projections_project_id_geometry_artifact_`

- **C2 disposition:** NAME_TRUNCATION_EQUIVALENT
- **Verdict:** SUSTAINED
- **Confidence:** high
- **Challenge evidence:** SUSTAINED. Independently re-derived the raw actual/declared/historical objects from phase-b-comparison.json for this key and its paired truncated-name counterpart (identified via C2's own cross-reference), normalized out the object's own name token from the DDL/definition text, and compared every remaining field (relation, is_unique, is_primary, predicate, column list / FK reference / ON UPDATE-ON DELETE actions as applicable) programmatically. All fields matched byte-for-byte between the two truncated spellings; the object graph confirms this is a single physical object represented under two different auto-generated names arising from Postgres's 63-byte NAMEDATALEN identifier limit (in several cases, from a hand-picked short name in an original migration vs. Prisma's un-mapped default long name -- a related but distinct root cause than pure truncation-of-one-name, noted as a methodology imprecision but not a substantive error since the definitional-equivalence proof holds regardless of naming mechanism). classification=DECLARED_DRIFT.

### 52. `indexes: localization_geometry_supersession_requests|localization_geometry_supersession_requests_project_id_pred_idx`

- **C2 disposition:** NAME_TRUNCATION_EQUIVALENT
- **Verdict:** SUSTAINED
- **Confidence:** high
- **Challenge evidence:** SUSTAINED. Independently re-derived the raw actual/declared/historical objects from phase-b-comparison.json for this key and its paired truncated-name counterpart (identified via C2's own cross-reference), normalized out the object's own name token from the DDL/definition text, and compared every remaining field (relation, is_unique, is_primary, predicate, column list / FK reference / ON UPDATE-ON DELETE actions as applicable) programmatically. All fields matched byte-for-byte between the two truncated spellings; the object graph confirms this is a single physical object represented under two different auto-generated names arising from Postgres's 63-byte NAMEDATALEN identifier limit (in several cases, from a hand-picked short name in an original migration vs. Prisma's un-mapped default long name -- a related but distinct root cause than pure truncation-of-one-name, noted as a methodology imprecision but not a substantive error since the definitional-equivalence proof holds regardless of naming mechanism). classification=DECLARED_ONLY.

### 53. `indexes: localization_geometry_supersession_requests|localization_geometry_supersession_requests_subject_idx`

- **C2 disposition:** NAME_TRUNCATION_EQUIVALENT
- **Verdict:** SUSTAINED
- **Confidence:** high
- **Challenge evidence:** SUSTAINED. Independently re-derived the raw actual/declared/historical objects from phase-b-comparison.json for this key and its paired truncated-name counterpart (identified via C2's own cross-reference), normalized out the object's own name token from the DDL/definition text, and compared every remaining field (relation, is_unique, is_primary, predicate, column list / FK reference / ON UPDATE-ON DELETE actions as applicable) programmatically. All fields matched byte-for-byte between the two truncated spellings; the object graph confirms this is a single physical object represented under two different auto-generated names arising from Postgres's 63-byte NAMEDATALEN identifier limit (in several cases, from a hand-picked short name in an original migration vs. Prisma's un-mapped default long name -- a related but distinct root cause than pure truncation-of-one-name, noted as a methodology imprecision but not a substantive error since the definitional-equivalence proof holds regardless of naming mechanism). classification=DECLARED_DRIFT.

### 54. `indexes: localization_geometry_supersession_requests|localization_geometry_supersession_requests_status_created__idx`

- **C2 disposition:** NAME_TRUNCATION_EQUIVALENT
- **Verdict:** SUSTAINED
- **Confidence:** high
- **Challenge evidence:** SUSTAINED. Independently re-derived the raw actual/declared/historical objects from phase-b-comparison.json for this key and its paired truncated-name counterpart (identified via C2's own cross-reference), normalized out the object's own name token from the DDL/definition text, and compared every remaining field (relation, is_unique, is_primary, predicate, column list / FK reference / ON UPDATE-ON DELETE actions as applicable) programmatically. All fields matched byte-for-byte between the two truncated spellings; the object graph confirms this is a single physical object represented under two different auto-generated names arising from Postgres's 63-byte NAMEDATALEN identifier limit (in several cases, from a hand-picked short name in an original migration vs. Prisma's un-mapped default long name -- a related but distinct root cause than pure truncation-of-one-name, noted as a methodology imprecision but not a substantive error since the definitional-equivalence proof holds regardless of naming mechanism). classification=DECLARED_ONLY.

### 55. `indexes: localization_geometry_supersession_requests|localization_geometry_supersession_requests_status_created_idx`

- **C2 disposition:** NAME_TRUNCATION_EQUIVALENT
- **Verdict:** SUSTAINED
- **Confidence:** high
- **Challenge evidence:** SUSTAINED. Independently re-derived the raw actual/declared/historical objects from phase-b-comparison.json for this key and its paired truncated-name counterpart (identified via C2's own cross-reference), normalized out the object's own name token from the DDL/definition text, and compared every remaining field (relation, is_unique, is_primary, predicate, column list / FK reference / ON UPDATE-ON DELETE actions as applicable) programmatically. All fields matched byte-for-byte between the two truncated spellings; the object graph confirms this is a single physical object represented under two different auto-generated names arising from Postgres's 63-byte NAMEDATALEN identifier limit (in several cases, from a hand-picked short name in an original migration vs. Prisma's un-mapped default long name -- a related but distinct root cause than pure truncation-of-one-name, noted as a methodology imprecision but not a substantive error since the definitional-equivalence proof holds regardless of naming mechanism). classification=DECLARED_DRIFT.

### 56. `indexes: localization_identity_provisioning_requests|localization_identity_provisioning_requests_project_id_geom_idx`

- **C2 disposition:** NAME_TRUNCATION_EQUIVALENT
- **Verdict:** SUSTAINED
- **Confidence:** high
- **Challenge evidence:** SUSTAINED. Independently re-derived the raw actual/declared/historical objects from phase-b-comparison.json for this key and its paired truncated-name counterpart (identified via C2's own cross-reference), normalized out the object's own name token from the DDL/definition text, and compared every remaining field (relation, is_unique, is_primary, predicate, column list / FK reference / ON UPDATE-ON DELETE actions as applicable) programmatically. All fields matched byte-for-byte between the two truncated spellings; the object graph confirms this is a single physical object represented under two different auto-generated names arising from Postgres's 63-byte NAMEDATALEN identifier limit (in several cases, from a hand-picked short name in an original migration vs. Prisma's un-mapped default long name -- a related but distinct root cause than pure truncation-of-one-name, noted as a methodology imprecision but not a substantive error since the definitional-equivalence proof holds regardless of naming mechanism). classification=DECLARED_ONLY.

### 57. `indexes: localization_identity_provisioning_requests|localization_identity_provisioning_requests_project_id_geometry`

- **C2 disposition:** NAME_TRUNCATION_EQUIVALENT
- **Verdict:** SUSTAINED
- **Confidence:** high
- **Challenge evidence:** SUSTAINED. Independently re-derived the raw actual/declared/historical objects from phase-b-comparison.json for this key and its paired truncated-name counterpart (identified via C2's own cross-reference), normalized out the object's own name token from the DDL/definition text, and compared every remaining field (relation, is_unique, is_primary, predicate, column list / FK reference / ON UPDATE-ON DELETE actions as applicable) programmatically. All fields matched byte-for-byte between the two truncated spellings; the object graph confirms this is a single physical object represented under two different auto-generated names arising from Postgres's 63-byte NAMEDATALEN identifier limit (in several cases, from a hand-picked short name in an original migration vs. Prisma's un-mapped default long name -- a related but distinct root cause than pure truncation-of-one-name, noted as a methodology imprecision but not a substantive error since the definitional-equivalence proof holds regardless of naming mechanism). classification=DECLARED_DRIFT.

### 58. `indexes: localization_identity_provisioning_requests|localization_identity_provisioning_requests_status_created__idx`

- **C2 disposition:** NAME_TRUNCATION_EQUIVALENT
- **Verdict:** SUSTAINED
- **Confidence:** high
- **Challenge evidence:** SUSTAINED. Independently re-derived the raw actual/declared/historical objects from phase-b-comparison.json for this key and its paired truncated-name counterpart (identified via C2's own cross-reference), normalized out the object's own name token from the DDL/definition text, and compared every remaining field (relation, is_unique, is_primary, predicate, column list / FK reference / ON UPDATE-ON DELETE actions as applicable) programmatically. All fields matched byte-for-byte between the two truncated spellings; the object graph confirms this is a single physical object represented under two different auto-generated names arising from Postgres's 63-byte NAMEDATALEN identifier limit (in several cases, from a hand-picked short name in an original migration vs. Prisma's un-mapped default long name -- a related but distinct root cause than pure truncation-of-one-name, noted as a methodology imprecision but not a substantive error since the definitional-equivalence proof holds regardless of naming mechanism). classification=DECLARED_ONLY.

### 59. `indexes: localization_identity_provisioning_requests|localization_identity_provisioning_requests_status_created_at_i`

- **C2 disposition:** NAME_TRUNCATION_EQUIVALENT
- **Verdict:** SUSTAINED
- **Confidence:** high
- **Challenge evidence:** SUSTAINED. Independently re-derived the raw actual/declared/historical objects from phase-b-comparison.json for this key and its paired truncated-name counterpart (identified via C2's own cross-reference), normalized out the object's own name token from the DDL/definition text, and compared every remaining field (relation, is_unique, is_primary, predicate, column list / FK reference / ON UPDATE-ON DELETE actions as applicable) programmatically. All fields matched byte-for-byte between the two truncated spellings; the object graph confirms this is a single physical object represented under two different auto-generated names arising from Postgres's 63-byte NAMEDATALEN identifier limit (in several cases, from a hand-picked short name in an original migration vs. Prisma's un-mapped default long name -- a related but distinct root cause than pure truncation-of-one-name, noted as a methodology imprecision but not a substantive error since the definitional-equivalence proof holds regardless of naming mechanism). classification=DECLARED_DRIFT.

### 60. `indexes: project_assessment_projections|project_assessment_projections_binding_idx`

- **C2 disposition:** NAME_TRUNCATION_EQUIVALENT
- **Verdict:** SUSTAINED
- **Confidence:** high
- **Challenge evidence:** SUSTAINED. Independently re-derived the raw actual/declared/historical objects from phase-b-comparison.json for this key and its paired truncated-name counterpart (identified via C2's own cross-reference), normalized out the object's own name token from the DDL/definition text, and compared every remaining field (relation, is_unique, is_primary, predicate, column list / FK reference / ON UPDATE-ON DELETE actions as applicable) programmatically. All fields matched byte-for-byte between the two truncated spellings; the object graph confirms this is a single physical object represented under two different auto-generated names arising from Postgres's 63-byte NAMEDATALEN identifier limit (in several cases, from a hand-picked short name in an original migration vs. Prisma's un-mapped default long name -- a related but distinct root cause than pure truncation-of-one-name, noted as a methodology imprecision but not a substantive error since the definitional-equivalence proof holds regardless of naming mechanism). classification=DECLARED_DRIFT.

### 61. `indexes: project_assessment_projections|project_assessment_projections_project_id_binding_artifact__idx`

- **C2 disposition:** NAME_TRUNCATION_EQUIVALENT
- **Verdict:** SUSTAINED
- **Confidence:** high
- **Challenge evidence:** SUSTAINED. Independently re-derived the raw actual/declared/historical objects from phase-b-comparison.json for this key and its paired truncated-name counterpart (identified via C2's own cross-reference), normalized out the object's own name token from the DDL/definition text, and compared every remaining field (relation, is_unique, is_primary, predicate, column list / FK reference / ON UPDATE-ON DELETE actions as applicable) programmatically. All fields matched byte-for-byte between the two truncated spellings; the object graph confirms this is a single physical object represented under two different auto-generated names arising from Postgres's 63-byte NAMEDATALEN identifier limit (in several cases, from a hand-picked short name in an original migration vs. Prisma's un-mapped default long name -- a related but distinct root cause than pure truncation-of-one-name, noted as a methodology imprecision but not a substantive error since the definitional-equivalence proof holds regardless of naming mechanism). classification=DECLARED_ONLY.

### 62. `indexes: project_assessment_projections|project_assessment_projections_created_idx`

- **C2 disposition:** NAME_TRUNCATION_EQUIVALENT
- **Verdict:** SUSTAINED
- **Confidence:** high
- **Challenge evidence:** SUSTAINED. Independently re-derived the raw actual/declared/historical objects from phase-b-comparison.json for this key and its paired truncated-name counterpart (identified via C2's own cross-reference), normalized out the object's own name token from the DDL/definition text, and compared every remaining field (relation, is_unique, is_primary, predicate, column list / FK reference / ON UPDATE-ON DELETE actions as applicable) programmatically. All fields matched byte-for-byte between the two truncated spellings; the object graph confirms this is a single physical object represented under two different auto-generated names arising from Postgres's 63-byte NAMEDATALEN identifier limit (in several cases, from a hand-picked short name in an original migration vs. Prisma's un-mapped default long name -- a related but distinct root cause than pure truncation-of-one-name, noted as a methodology imprecision but not a substantive error since the definitional-equivalence proof holds regardless of naming mechanism). classification=DECLARED_DRIFT.

### 63. `indexes: project_assessment_projections|project_assessment_projections_project_id_created_at_idx`

- **C2 disposition:** NAME_TRUNCATION_EQUIVALENT
- **Verdict:** SUSTAINED
- **Confidence:** high
- **Challenge evidence:** SUSTAINED. Independently re-derived the raw actual/declared/historical objects from phase-b-comparison.json for this key and its paired truncated-name counterpart (identified via C2's own cross-reference), normalized out the object's own name token from the DDL/definition text, and compared every remaining field (relation, is_unique, is_primary, predicate, column list / FK reference / ON UPDATE-ON DELETE actions as applicable) programmatically. All fields matched byte-for-byte between the two truncated spellings; the object graph confirms this is a single physical object represented under two different auto-generated names arising from Postgres's 63-byte NAMEDATALEN identifier limit (in several cases, from a hand-picked short name in an original migration vs. Prisma's un-mapped default long name -- a related but distinct root cause than pure truncation-of-one-name, noted as a methodology imprecision but not a substantive error since the definitional-equivalence proof holds regardless of naming mechanism). classification=DECLARED_ONLY.

### 64. `indexes: project_assessment_projections|project_assessment_projections_project_assessment_key`

- **C2 disposition:** NAME_TRUNCATION_EQUIVALENT
- **Verdict:** SUSTAINED
- **Confidence:** high
- **Challenge evidence:** SUSTAINED. Independently re-derived the raw actual/declared/historical objects from phase-b-comparison.json for this key and its paired truncated-name counterpart (identified via C2's own cross-reference), normalized out the object's own name token from the DDL/definition text, and compared every remaining field (relation, is_unique, is_primary, predicate, column list / FK reference / ON UPDATE-ON DELETE actions as applicable) programmatically. All fields matched byte-for-byte between the two truncated spellings; the object graph confirms this is a single physical object represented under two different auto-generated names arising from Postgres's 63-byte NAMEDATALEN identifier limit (in several cases, from a hand-picked short name in an original migration vs. Prisma's un-mapped default long name -- a related but distinct root cause than pure truncation-of-one-name, noted as a methodology imprecision but not a substantive error since the definitional-equivalence proof holds regardless of naming mechanism). classification=DECLARED_DRIFT.

### 65. `indexes: project_assessment_projections|project_assessment_projections_project_id_assessment_artifa_key`

- **C2 disposition:** NAME_TRUNCATION_EQUIVALENT
- **Verdict:** SUSTAINED
- **Confidence:** high
- **Challenge evidence:** SUSTAINED. Independently re-derived the raw actual/declared/historical objects from phase-b-comparison.json for this key and its paired truncated-name counterpart (identified via C2's own cross-reference), normalized out the object's own name token from the DDL/definition text, and compared every remaining field (relation, is_unique, is_primary, predicate, column list / FK reference / ON UPDATE-ON DELETE actions as applicable) programmatically. All fields matched byte-for-byte between the two truncated spellings; the object graph confirms this is a single physical object represented under two different auto-generated names arising from Postgres's 63-byte NAMEDATALEN identifier limit (in several cases, from a hand-picked short name in an original migration vs. Prisma's un-mapped default long name -- a related but distinct root cause than pure truncation-of-one-name, noted as a methodology imprecision but not a substantive error since the definitional-equivalence proof holds regardless of naming mechanism). classification=DECLARED_ONLY.

### 66. `indexes: project_assessment_projections|project_assessment_projections_project_id_localization_geom_idx`

- **C2 disposition:** NAME_TRUNCATION_EQUIVALENT
- **Verdict:** SUSTAINED
- **Confidence:** high
- **Challenge evidence:** SUSTAINED. Independently re-derived the raw actual/declared/historical objects from phase-b-comparison.json for this key and its paired truncated-name counterpart (identified via C2's own cross-reference), normalized out the object's own name token from the DDL/definition text, and compared every remaining field (relation, is_unique, is_primary, predicate, column list / FK reference / ON UPDATE-ON DELETE actions as applicable) programmatically. All fields matched byte-for-byte between the two truncated spellings; the object graph confirms this is a single physical object represented under two different auto-generated names arising from Postgres's 63-byte NAMEDATALEN identifier limit (in several cases, from a hand-picked short name in an original migration vs. Prisma's un-mapped default long name -- a related but distinct root cause than pure truncation-of-one-name, noted as a methodology imprecision but not a substantive error since the definitional-equivalence proof holds regardless of naming mechanism). classification=DECLARED_ONLY.

### 67. `indexes: project_assessment_projections|project_assessment_projections_project_id_localization_geometry`

- **C2 disposition:** NAME_TRUNCATION_EQUIVALENT
- **Verdict:** SUSTAINED
- **Confidence:** high
- **Challenge evidence:** SUSTAINED. Independently re-derived the raw actual/declared/historical objects from phase-b-comparison.json for this key and its paired truncated-name counterpart (identified via C2's own cross-reference), normalized out the object's own name token from the DDL/definition text, and compared every remaining field (relation, is_unique, is_primary, predicate, column list / FK reference / ON UPDATE-ON DELETE actions as applicable) programmatically. All fields matched byte-for-byte between the two truncated spellings; the object graph confirms this is a single physical object represented under two different auto-generated names arising from Postgres's 63-byte NAMEDATALEN identifier limit (in several cases, from a hand-picked short name in an original migration vs. Prisma's un-mapped default long name -- a related but distinct root cause than pure truncation-of-one-name, noted as a methodology imprecision but not a substantive error since the definitional-equivalence proof holds regardless of naming mechanism). classification=DECLARED_DRIFT.

### 68. `indexes: project_context_binding_supersessions|project_context_binding_supersessions_artifact_key`

- **C2 disposition:** NAME_TRUNCATION_EQUIVALENT
- **Verdict:** SUSTAINED
- **Confidence:** high
- **Challenge evidence:** SUSTAINED. Independently re-derived the raw actual/declared/historical objects from phase-b-comparison.json for this key and its paired truncated-name counterpart (identified via C2's own cross-reference), normalized out the object's own name token from the DDL/definition text, and compared every remaining field (relation, is_unique, is_primary, predicate, column list / FK reference / ON UPDATE-ON DELETE actions as applicable) programmatically. All fields matched byte-for-byte between the two truncated spellings; the object graph confirms this is a single physical object represented under two different auto-generated names arising from Postgres's 63-byte NAMEDATALEN identifier limit (in several cases, from a hand-picked short name in an original migration vs. Prisma's un-mapped default long name -- a related but distinct root cause than pure truncation-of-one-name, noted as a methodology imprecision but not a substantive error since the definitional-equivalence proof holds regardless of naming mechanism). classification=DECLARED_DRIFT.

### 69. `indexes: project_context_binding_supersessions|project_context_binding_supersessions_supersession_artifact_key`

- **C2 disposition:** NAME_TRUNCATION_EQUIVALENT
- **Verdict:** SUSTAINED
- **Confidence:** high
- **Challenge evidence:** SUSTAINED. Independently re-derived the raw actual/declared/historical objects from phase-b-comparison.json for this key and its paired truncated-name counterpart (identified via C2's own cross-reference), normalized out the object's own name token from the DDL/definition text, and compared every remaining field (relation, is_unique, is_primary, predicate, column list / FK reference / ON UPDATE-ON DELETE actions as applicable) programmatically. All fields matched byte-for-byte between the two truncated spellings; the object graph confirms this is a single physical object represented under two different auto-generated names arising from Postgres's 63-byte NAMEDATALEN identifier limit (in several cases, from a hand-picked short name in an original migration vs. Prisma's un-mapped default long name -- a related but distinct root cause than pure truncation-of-one-name, noted as a methodology imprecision but not a substantive error since the definitional-equivalence proof holds regardless of naming mechanism). classification=DECLARED_ONLY.

### 70. `indexes: project_context_binding_supersessions|project_context_binding_supersessions_predecessor_idx`

- **C2 disposition:** NAME_TRUNCATION_EQUIVALENT
- **Verdict:** SUSTAINED
- **Confidence:** high
- **Challenge evidence:** SUSTAINED. Independently re-derived the raw actual/declared/historical objects from phase-b-comparison.json for this key and its paired truncated-name counterpart (identified via C2's own cross-reference), normalized out the object's own name token from the DDL/definition text, and compared every remaining field (relation, is_unique, is_primary, predicate, column list / FK reference / ON UPDATE-ON DELETE actions as applicable) programmatically. All fields matched byte-for-byte between the two truncated spellings; the object graph confirms this is a single physical object represented under two different auto-generated names arising from Postgres's 63-byte NAMEDATALEN identifier limit (in several cases, from a hand-picked short name in an original migration vs. Prisma's un-mapped default long name -- a related but distinct root cause than pure truncation-of-one-name, noted as a methodology imprecision but not a substantive error since the definitional-equivalence proof holds regardless of naming mechanism). classification=DECLARED_DRIFT.

### 71. `indexes: project_context_binding_supersessions|project_context_binding_supersessions_project_id_superseded_idx`

- **C2 disposition:** NAME_TRUNCATION_EQUIVALENT
- **Verdict:** SUSTAINED
- **Confidence:** high
- **Challenge evidence:** SUSTAINED. Independently re-derived the raw actual/declared/historical objects from phase-b-comparison.json for this key and its paired truncated-name counterpart (identified via C2's own cross-reference), normalized out the object's own name token from the DDL/definition text, and compared every remaining field (relation, is_unique, is_primary, predicate, column list / FK reference / ON UPDATE-ON DELETE actions as applicable) programmatically. All fields matched byte-for-byte between the two truncated spellings; the object graph confirms this is a single physical object represented under two different auto-generated names arising from Postgres's 63-byte NAMEDATALEN identifier limit (in several cases, from a hand-picked short name in an original migration vs. Prisma's un-mapped default long name -- a related but distinct root cause than pure truncation-of-one-name, noted as a methodology imprecision but not a substantive error since the definitional-equivalence proof holds regardless of naming mechanism). classification=DECLARED_ONLY.

### 72. `indexes: project_context_binding_supersessions|project_context_binding_supersessions_project_id_idx`

- **C2 disposition:** NAME_TRUNCATION_EQUIVALENT
- **Verdict:** SUSTAINED
- **Confidence:** high
- **Challenge evidence:** SUSTAINED. Independently re-derived the raw actual/declared/historical objects from phase-b-comparison.json for this key and its paired truncated-name counterpart (identified via C2's own cross-reference), normalized out the object's own name token from the DDL/definition text, and compared every remaining field (relation, is_unique, is_primary, predicate, column list / FK reference / ON UPDATE-ON DELETE actions as applicable) programmatically. All fields matched byte-for-byte between the two truncated spellings; the object graph confirms this is a single physical object represented under two different auto-generated names arising from Postgres's 63-byte NAMEDATALEN identifier limit (in several cases, from a hand-picked short name in an original migration vs. Prisma's un-mapped default long name -- a related but distinct root cause than pure truncation-of-one-name, noted as a methodology imprecision but not a substantive error since the definitional-equivalence proof holds regardless of naming mechanism). classification=DECLARED_ONLY.

### 73. `indexes: project_context_binding_supersessions|project_context_binding_supersessions_project_idx`

- **C2 disposition:** NAME_TRUNCATION_EQUIVALENT
- **Verdict:** SUSTAINED
- **Confidence:** high
- **Challenge evidence:** SUSTAINED. Independently re-derived the raw actual/declared/historical objects from phase-b-comparison.json for this key and its paired truncated-name counterpart (identified via C2's own cross-reference), normalized out the object's own name token from the DDL/definition text, and compared every remaining field (relation, is_unique, is_primary, predicate, column list / FK reference / ON UPDATE-ON DELETE actions as applicable) programmatically. All fields matched byte-for-byte between the two truncated spellings; the object graph confirms this is a single physical object represented under two different auto-generated names arising from Postgres's 63-byte NAMEDATALEN identifier limit (in several cases, from a hand-picked short name in an original migration vs. Prisma's un-mapped default long name -- a related but distinct root cause than pure truncation-of-one-name, noted as a methodology imprecision but not a substantive error since the definitional-equivalence proof holds regardless of naming mechanism). classification=DECLARED_DRIFT.

### 74. `indexes: project_context_binding_supersessions|project_context_binding_supersessions_project_id_successor__idx`

- **C2 disposition:** NAME_TRUNCATION_EQUIVALENT
- **Verdict:** SUSTAINED
- **Confidence:** high
- **Challenge evidence:** SUSTAINED. Independently re-derived the raw actual/declared/historical objects from phase-b-comparison.json for this key and its paired truncated-name counterpart (identified via C2's own cross-reference), normalized out the object's own name token from the DDL/definition text, and compared every remaining field (relation, is_unique, is_primary, predicate, column list / FK reference / ON UPDATE-ON DELETE actions as applicable) programmatically. All fields matched byte-for-byte between the two truncated spellings; the object graph confirms this is a single physical object represented under two different auto-generated names arising from Postgres's 63-byte NAMEDATALEN identifier limit (in several cases, from a hand-picked short name in an original migration vs. Prisma's un-mapped default long name -- a related but distinct root cause than pure truncation-of-one-name, noted as a methodology imprecision but not a substantive error since the definitional-equivalence proof holds regardless of naming mechanism). classification=DECLARED_ONLY.

### 75. `indexes: project_context_binding_supersessions|project_context_binding_supersessions_successor_idx`

- **C2 disposition:** NAME_TRUNCATION_EQUIVALENT
- **Verdict:** SUSTAINED
- **Confidence:** high
- **Challenge evidence:** SUSTAINED. Independently re-derived the raw actual/declared/historical objects from phase-b-comparison.json for this key and its paired truncated-name counterpart (identified via C2's own cross-reference), normalized out the object's own name token from the DDL/definition text, and compared every remaining field (relation, is_unique, is_primary, predicate, column list / FK reference / ON UPDATE-ON DELETE actions as applicable) programmatically. All fields matched byte-for-byte between the two truncated spellings; the object graph confirms this is a single physical object represented under two different auto-generated names arising from Postgres's 63-byte NAMEDATALEN identifier limit (in several cases, from a hand-picked short name in an original migration vs. Prisma's un-mapped default long name -- a related but distinct root cause than pure truncation-of-one-name, noted as a methodology imprecision but not a substantive error since the definitional-equivalence proof holds regardless of naming mechanism). classification=DECLARED_DRIFT.

### 76. `indexes: project_context_bindings|project_context_bindings_project_context_idx`

- **C2 disposition:** NAME_TRUNCATION_EQUIVALENT
- **Verdict:** SUSTAINED
- **Confidence:** high
- **Challenge evidence:** SUSTAINED. Independently re-derived the raw actual/declared/historical objects from phase-b-comparison.json for this key and its paired truncated-name counterpart (identified via C2's own cross-reference), normalized out the object's own name token from the DDL/definition text, and compared every remaining field (relation, is_unique, is_primary, predicate, column list / FK reference / ON UPDATE-ON DELETE actions as applicable) programmatically. All fields matched byte-for-byte between the two truncated spellings; the object graph confirms this is a single physical object represented under two different auto-generated names arising from Postgres's 63-byte NAMEDATALEN identifier limit (in several cases, from a hand-picked short name in an original migration vs. Prisma's un-mapped default long name -- a related but distinct root cause than pure truncation-of-one-name, noted as a methodology imprecision but not a substantive error since the definitional-equivalence proof holds regardless of naming mechanism). classification=ACTUAL_ONLY.

### 77. `indexes: project_context_bindings|project_context_bindings_project_id_project_context_artifac_idx`

- **C2 disposition:** NAME_TRUNCATION_EQUIVALENT
- **Verdict:** SUSTAINED
- **Confidence:** high
- **Challenge evidence:** SUSTAINED. Independently re-derived the raw actual/declared/historical objects from phase-b-comparison.json for this key and its paired truncated-name counterpart (identified via C2's own cross-reference), normalized out the object's own name token from the DDL/definition text, and compared every remaining field (relation, is_unique, is_primary, predicate, column list / FK reference / ON UPDATE-ON DELETE actions as applicable) programmatically. All fields matched byte-for-byte between the two truncated spellings; the object graph confirms this is a single physical object represented under two different auto-generated names arising from Postgres's 63-byte NAMEDATALEN identifier limit (in several cases, from a hand-picked short name in an original migration vs. Prisma's un-mapped default long name -- a related but distinct root cause than pure truncation-of-one-name, noted as a methodology imprecision but not a substantive error since the definitional-equivalence proof holds regardless of naming mechanism). classification=DECLARED_ONLY.

### 78. `indexes: project_context_bindings|project_context_bindings_project_context_key`

- **C2 disposition:** NAME_TRUNCATION_EQUIVALENT
- **Verdict:** SUSTAINED
- **Confidence:** high
- **Challenge evidence:** SUSTAINED. Independently re-derived the raw actual/declared/historical objects from phase-b-comparison.json for this key and its paired truncated-name counterpart (identified via C2's own cross-reference), normalized out the object's own name token from the DDL/definition text, and compared every remaining field (relation, is_unique, is_primary, predicate, column list / FK reference / ON UPDATE-ON DELETE actions as applicable) programmatically. All fields matched byte-for-byte between the two truncated spellings; the object graph confirms this is a single physical object represented under two different auto-generated names arising from Postgres's 63-byte NAMEDATALEN identifier limit (in several cases, from a hand-picked short name in an original migration vs. Prisma's un-mapped default long name -- a related but distinct root cause than pure truncation-of-one-name, noted as a methodology imprecision but not a substantive error since the definitional-equivalence proof holds regardless of naming mechanism). classification=ACTUAL_ONLY.

### 79. `indexes: project_context_bindings|project_context_bindings_project_id_project_context_artifac_key`

- **C2 disposition:** NAME_TRUNCATION_EQUIVALENT
- **Verdict:** SUSTAINED
- **Confidence:** high
- **Challenge evidence:** SUSTAINED. Independently re-derived the raw actual/declared/historical objects from phase-b-comparison.json for this key and its paired truncated-name counterpart (identified via C2's own cross-reference), normalized out the object's own name token from the DDL/definition text, and compared every remaining field (relation, is_unique, is_primary, predicate, column list / FK reference / ON UPDATE-ON DELETE actions as applicable) programmatically. All fields matched byte-for-byte between the two truncated spellings; the object graph confirms this is a single physical object represented under two different auto-generated names arising from Postgres's 63-byte NAMEDATALEN identifier limit (in several cases, from a hand-picked short name in an original migration vs. Prisma's un-mapped default long name -- a related but distinct root cause than pure truncation-of-one-name, noted as a methodology imprecision but not a substantive error since the definitional-equivalence proof holds regardless of naming mechanism). classification=DECLARED_ONLY.

### 80. `indexes: project_context_bootstrap_requests|project_context_bootstrap_requests_project_id_idx`

- **C2 disposition:** NAME_TRUNCATION_EQUIVALENT
- **Verdict:** SUSTAINED
- **Confidence:** high
- **Challenge evidence:** SUSTAINED. Independently re-derived the raw actual/declared/historical objects from phase-b-comparison.json for this key and its paired truncated-name counterpart (identified via C2's own cross-reference), normalized out the object's own name token from the DDL/definition text, and compared every remaining field (relation, is_unique, is_primary, predicate, column list / FK reference / ON UPDATE-ON DELETE actions as applicable) programmatically. All fields matched byte-for-byte between the two truncated spellings; the object graph confirms this is a single physical object represented under two different auto-generated names arising from Postgres's 63-byte NAMEDATALEN identifier limit (in several cases, from a hand-picked short name in an original migration vs. Prisma's un-mapped default long name -- a related but distinct root cause than pure truncation-of-one-name, noted as a methodology imprecision but not a substantive error since the definitional-equivalence proof holds regardless of naming mechanism). classification=DECLARED_ONLY.

### 81. `indexes: project_context_bootstrap_requests|project_context_bootstrap_requests_project_idx`

- **C2 disposition:** NAME_TRUNCATION_EQUIVALENT
- **Verdict:** SUSTAINED
- **Confidence:** high
- **Challenge evidence:** SUSTAINED. Independently re-derived the raw actual/declared/historical objects from phase-b-comparison.json for this key and its paired truncated-name counterpart (identified via C2's own cross-reference), normalized out the object's own name token from the DDL/definition text, and compared every remaining field (relation, is_unique, is_primary, predicate, column list / FK reference / ON UPDATE-ON DELETE actions as applicable) programmatically. All fields matched byte-for-byte between the two truncated spellings; the object graph confirms this is a single physical object represented under two different auto-generated names arising from Postgres's 63-byte NAMEDATALEN identifier limit (in several cases, from a hand-picked short name in an original migration vs. Prisma's un-mapped default long name -- a related but distinct root cause than pure truncation-of-one-name, noted as a methodology imprecision but not a substantive error since the definitional-equivalence proof holds regardless of naming mechanism). classification=DECLARED_DRIFT.

### 82. `indexes: project_context_bootstrap_requests|project_context_bootstrap_requests_status_created_at_idx`

- **C2 disposition:** NAME_TRUNCATION_EQUIVALENT
- **Verdict:** SUSTAINED
- **Confidence:** high
- **Challenge evidence:** SUSTAINED. Independently re-derived the raw actual/declared/historical objects from phase-b-comparison.json for this key and its paired truncated-name counterpart (identified via C2's own cross-reference), normalized out the object's own name token from the DDL/definition text, and compared every remaining field (relation, is_unique, is_primary, predicate, column list / FK reference / ON UPDATE-ON DELETE actions as applicable) programmatically. All fields matched byte-for-byte between the two truncated spellings; the object graph confirms this is a single physical object represented under two different auto-generated names arising from Postgres's 63-byte NAMEDATALEN identifier limit (in several cases, from a hand-picked short name in an original migration vs. Prisma's un-mapped default long name -- a related but distinct root cause than pure truncation-of-one-name, noted as a methodology imprecision but not a substantive error since the definitional-equivalence proof holds regardless of naming mechanism). classification=DECLARED_ONLY.

### 83. `indexes: project_context_bootstrap_requests|project_context_bootstrap_requests_status_created_idx`

- **C2 disposition:** NAME_TRUNCATION_EQUIVALENT
- **Verdict:** SUSTAINED
- **Confidence:** high
- **Challenge evidence:** SUSTAINED. Independently re-derived the raw actual/declared/historical objects from phase-b-comparison.json for this key and its paired truncated-name counterpart (identified via C2's own cross-reference), normalized out the object's own name token from the DDL/definition text, and compared every remaining field (relation, is_unique, is_primary, predicate, column list / FK reference / ON UPDATE-ON DELETE actions as applicable) programmatically. All fields matched byte-for-byte between the two truncated spellings; the object graph confirms this is a single physical object represented under two different auto-generated names arising from Postgres's 63-byte NAMEDATALEN identifier limit (in several cases, from a hand-picked short name in an original migration vs. Prisma's un-mapped default long name -- a related but distinct root cause than pure truncation-of-one-name, noted as a methodology imprecision but not a substantive error since the definitional-equivalence proof holds regardless of naming mechanism). classification=DECLARED_DRIFT.

### 84. `indexes: viewer_capability_provisioning_requests|viewer_capability_provisioning_requests_project_id_context__idx`

- **C2 disposition:** NAME_TRUNCATION_EQUIVALENT
- **Verdict:** SUSTAINED
- **Confidence:** high
- **Challenge evidence:** SUSTAINED. Independently re-derived the raw actual/declared/historical objects from phase-b-comparison.json for this key and its paired truncated-name counterpart (identified via C2's own cross-reference), normalized out the object's own name token from the DDL/definition text, and compared every remaining field (relation, is_unique, is_primary, predicate, column list / FK reference / ON UPDATE-ON DELETE actions as applicable) programmatically. All fields matched byte-for-byte between the two truncated spellings; the object graph confirms this is a single physical object represented under two different auto-generated names arising from Postgres's 63-byte NAMEDATALEN identifier limit (in several cases, from a hand-picked short name in an original migration vs. Prisma's un-mapped default long name -- a related but distinct root cause than pure truncation-of-one-name, noted as a methodology imprecision but not a substantive error since the definitional-equivalence proof holds regardless of naming mechanism). classification=DECLARED_ONLY.

### 85. `indexes: viewer_capability_provisioning_requests|viewer_capability_provisioning_requests_project_id_ctx_rel_vid_`

- **C2 disposition:** NAME_TRUNCATION_EQUIVALENT
- **Verdict:** SUSTAINED
- **Confidence:** high
- **Challenge evidence:** SUSTAINED. Independently re-derived the raw actual/declared/historical objects from phase-b-comparison.json for this key and its paired truncated-name counterpart (identified via C2's own cross-reference), normalized out the object's own name token from the DDL/definition text, and compared every remaining field (relation, is_unique, is_primary, predicate, column list / FK reference / ON UPDATE-ON DELETE actions as applicable) programmatically. All fields matched byte-for-byte between the two truncated spellings; the object graph confirms this is a single physical object represented under two different auto-generated names arising from Postgres's 63-byte NAMEDATALEN identifier limit (in several cases, from a hand-picked short name in an original migration vs. Prisma's un-mapped default long name -- a related but distinct root cause than pure truncation-of-one-name, noted as a methodology imprecision but not a substantive error since the definitional-equivalence proof holds regardless of naming mechanism). classification=DECLARED_DRIFT.

### 86. `indexes: localization_geometry_supersessions|localization_geometry_supersessions_pkey`

- **C2 disposition:** COMPARISON_ARTIFACT
- **Verdict:** OVERTURNED -> TRUE_SCHEMA_DRIFT
- **Confidence:** high
- **Challenge evidence:** OVERTURNED. Independently read prisma/migrations/20260823160000_add_localization_geometry_supersession/migration.sql in full: the cited header comment is real and verbatim, but it documents a POLICY CHOICE ("raw SQL access, not a Prisma model"), not a structural/mechanical impossibility -- nothing in Prisma prevents adding a `model LocalizationGeometrySupersession { ... } @@map("localization_geometry_supersessions")` block; this is categorically different from _prisma_migrations, which Prisma's own tooling refuses to let you model at all (a genuine mechanical fact, verified separately). C2's own evidence text undercuts its 'permanent by design' framing: the same comment says the two sibling tables using identical language (project_assessment_projections, localization_geometry_projections) were LATER PROMOTED to real Prisma models -- establishing this team's own precedent that this pattern is normally temporary, pending promotion, not a permanent exclusion. Most decisively: C2 itself draws a distinguishing line elsewhere in this same report -- compare indexes:legal_corpus_chunks|idx_legal_chunks_embedding_hnsw (COMPARISON_ARTIFACT, because schema.prisma ITSELF carries an explicit inline comment acknowledging the raw-SQL nature) against indexes:PostgisImportBatch|uq_postgis_import_batch and indexes:DocumentChunk|documentchunk_embedding_hnsw_idx (both TRUE_SCHEMA_DRIFT, specifically because schema.prisma is silent/unaware even though a migration or script elsewhere documents the object). Grepped schema.prisma directly: it contains ZERO reference to "localization_geometry_supersessions" anywhere (no model, no comment, no @@map) -- schema.prisma is totally silent, exactly the fact pattern C2 itself classified as TRUE_SCHEMA_DRIFT in the PostgisImportBatch/DocumentChunk cases. Applying C2's own standard consistently: this is undocumented-from-schema.prisma's-perspective drift on a whole public-schema table (6 columns, PK, FK, 3 indexes) that Prisma is supposed to own per this program's own frozen governance rule (public schema owned by Prisma via baseline reconciliation), not a safe comparison artifact.

### 87. `indexes: localization_geometry_supersessions|localization_geometry_supersessions_project_idx`

- **C2 disposition:** COMPARISON_ARTIFACT
- **Verdict:** OVERTURNED -> TRUE_SCHEMA_DRIFT
- **Confidence:** high
- **Challenge evidence:** OVERTURNED. Independently read prisma/migrations/20260823160000_add_localization_geometry_supersession/migration.sql in full: the cited header comment is real and verbatim, but it documents a POLICY CHOICE ("raw SQL access, not a Prisma model"), not a structural/mechanical impossibility -- nothing in Prisma prevents adding a `model LocalizationGeometrySupersession { ... } @@map("localization_geometry_supersessions")` block; this is categorically different from _prisma_migrations, which Prisma's own tooling refuses to let you model at all (a genuine mechanical fact, verified separately). C2's own evidence text undercuts its 'permanent by design' framing: the same comment says the two sibling tables using identical language (project_assessment_projections, localization_geometry_projections) were LATER PROMOTED to real Prisma models -- establishing this team's own precedent that this pattern is normally temporary, pending promotion, not a permanent exclusion. Most decisively: C2 itself draws a distinguishing line elsewhere in this same report -- compare indexes:legal_corpus_chunks|idx_legal_chunks_embedding_hnsw (COMPARISON_ARTIFACT, because schema.prisma ITSELF carries an explicit inline comment acknowledging the raw-SQL nature) against indexes:PostgisImportBatch|uq_postgis_import_batch and indexes:DocumentChunk|documentchunk_embedding_hnsw_idx (both TRUE_SCHEMA_DRIFT, specifically because schema.prisma is silent/unaware even though a migration or script elsewhere documents the object). Grepped schema.prisma directly: it contains ZERO reference to "localization_geometry_supersessions" anywhere (no model, no comment, no @@map) -- schema.prisma is totally silent, exactly the fact pattern C2 itself classified as TRUE_SCHEMA_DRIFT in the PostgisImportBatch/DocumentChunk cases. Applying C2's own standard consistently: this is undocumented-from-schema.prisma's-perspective drift on a whole public-schema table (6 columns, PK, FK, 3 indexes) that Prisma is supposed to own per this program's own frozen governance rule (public schema owned by Prisma via baseline reconciliation), not a safe comparison artifact.

### 88. `indexes: localization_geometry_supersessions|localization_geometry_supersessions_project_supersession_key`

- **C2 disposition:** COMPARISON_ARTIFACT
- **Verdict:** OVERTURNED -> TRUE_SCHEMA_DRIFT
- **Confidence:** high
- **Challenge evidence:** OVERTURNED. Independently read prisma/migrations/20260823160000_add_localization_geometry_supersession/migration.sql in full: the cited header comment is real and verbatim, but it documents a POLICY CHOICE ("raw SQL access, not a Prisma model"), not a structural/mechanical impossibility -- nothing in Prisma prevents adding a `model LocalizationGeometrySupersession { ... } @@map("localization_geometry_supersessions")` block; this is categorically different from _prisma_migrations, which Prisma's own tooling refuses to let you model at all (a genuine mechanical fact, verified separately). C2's own evidence text undercuts its 'permanent by design' framing: the same comment says the two sibling tables using identical language (project_assessment_projections, localization_geometry_projections) were LATER PROMOTED to real Prisma models -- establishing this team's own precedent that this pattern is normally temporary, pending promotion, not a permanent exclusion. Most decisively: C2 itself draws a distinguishing line elsewhere in this same report -- compare indexes:legal_corpus_chunks|idx_legal_chunks_embedding_hnsw (COMPARISON_ARTIFACT, because schema.prisma ITSELF carries an explicit inline comment acknowledging the raw-SQL nature) against indexes:PostgisImportBatch|uq_postgis_import_batch and indexes:DocumentChunk|documentchunk_embedding_hnsw_idx (both TRUE_SCHEMA_DRIFT, specifically because schema.prisma is silent/unaware even though a migration or script elsewhere documents the object). Grepped schema.prisma directly: it contains ZERO reference to "localization_geometry_supersessions" anywhere (no model, no comment, no @@map) -- schema.prisma is totally silent, exactly the fact pattern C2 itself classified as TRUE_SCHEMA_DRIFT in the PostgisImportBatch/DocumentChunk cases. Applying C2's own standard consistently: this is undocumented-from-schema.prisma's-perspective drift on a whole public-schema table (6 columns, PK, FK, 3 indexes) that Prisma is supposed to own per this program's own frozen governance rule (public schema owned by Prisma via baseline reconciliation), not a safe comparison artifact.

### 89. `enums: ConfidenceLevel|HIGH`

- **C2 disposition:** TRUE_SCHEMA_DRIFT
- **Verdict:** SUSTAINED
- **Confidence:** high
- **Challenge evidence:** SUSTAINED. actual_fingerprint === historical_fingerprint (byte-identical) while declared_fingerprint differs, for this enum value; sort_order fields quoted directly from file 1's structured actual/declared/historical objects (3 vs 1 vs 3). Independently re-verified this citation directly against the repository (file read / grep) rather than trusting C2's summary; the cited file/line/migration content matches exactly as described, and the raw actual/declared/historical fingerprints and field values in phase-b-comparison.json corroborate the stated fact pattern.

### 90. `enums: ConfidenceLevel|LOW`

- **C2 disposition:** TRUE_SCHEMA_DRIFT
- **Verdict:** SUSTAINED
- **Confidence:** high
- **Challenge evidence:** SUSTAINED. actual_fingerprint === historical_fingerprint (byte-identical) while declared_fingerprint differs, for this enum value; sort_order fields quoted directly from file 1's structured actual/declared/historical objects (1 vs 3 vs 1). Independently re-verified this citation directly against the repository (file read / grep) rather than trusting C2's summary; the cited file/line/migration content matches exactly as described, and the raw actual/declared/historical fingerprints and field values in phase-b-comparison.json corroborate the stated fact pattern.

### 91. `enums: DocumentProcessingStatus|CHUNKED`

- **C2 disposition:** TRUE_SCHEMA_DRIFT
- **Verdict:** SUSTAINED
- **Confidence:** high
- **Challenge evidence:** SUSTAINED. actual_fingerprint === historical_fingerprint (byte-identical) while declared_fingerprint differs, for this enum value; sort_order fields quoted directly from file 1's structured actual/declared/historical objects (5 vs 3 vs 5). Independently re-verified this citation directly against the repository (file read / grep) rather than trusting C2's summary; the cited file/line/migration content matches exactly as described, and the raw actual/declared/historical fingerprints and field values in phase-b-comparison.json corroborate the stated fact pattern.

### 92. `enums: DocumentProcessingStatus|EMBEDDED`

- **C2 disposition:** TRUE_SCHEMA_DRIFT
- **Verdict:** SUSTAINED
- **Confidence:** high
- **Challenge evidence:** SUSTAINED. actual_fingerprint === historical_fingerprint (byte-identical) while declared_fingerprint differs, for this enum value; sort_order fields quoted directly from file 1's structured actual/declared/historical objects (3 vs 4 vs 3). Independently re-verified this citation directly against the repository (file read / grep) rather than trusting C2's summary; the cited file/line/migration content matches exactly as described, and the raw actual/declared/historical fingerprints and field values in phase-b-comparison.json corroborate the stated fact pattern.

### 93. `enums: DocumentProcessingStatus|FAILED`

- **C2 disposition:** TRUE_SCHEMA_DRIFT
- **Verdict:** SUSTAINED
- **Confidence:** high
- **Challenge evidence:** SUSTAINED. actual_fingerprint === historical_fingerprint (byte-identical) while declared_fingerprint differs, for this enum value; sort_order fields quoted directly from file 1's structured actual/declared/historical objects (4 vs 5 vs 4). Independently re-verified this citation directly against the repository (file read / grep) rather than trusting C2's summary; the cited file/line/migration content matches exactly as described, and the raw actual/declared/historical fingerprints and field values in phase-b-comparison.json corroborate the stated fact pattern.

### 94. `enums: RequirementVerificationStatus|NEEDS_REVIEW`

- **C2 disposition:** TRUE_SCHEMA_DRIFT
- **Verdict:** SUSTAINED
- **Confidence:** high
- **Challenge evidence:** SUSTAINED. actual_fingerprint === historical_fingerprint (byte-identical) while declared_fingerprint differs, for this enum value; sort_order fields quoted directly from file 1's structured actual/declared/historical objects (5 vs 2 vs 5). Independently re-verified this citation directly against the repository (file read / grep) rather than trusting C2's summary; the cited file/line/migration content matches exactly as described, and the raw actual/declared/historical fingerprints and field values in phase-b-comparison.json corroborate the stated fact pattern.

### 95. `enums: RequirementVerificationStatus|REJECTED`

- **C2 disposition:** TRUE_SCHEMA_DRIFT
- **Verdict:** SUSTAINED
- **Confidence:** high
- **Challenge evidence:** SUSTAINED. actual_fingerprint === historical_fingerprint (byte-identical) while declared_fingerprint differs, for this enum value; sort_order fields quoted directly from file 1's structured actual/declared/historical objects (4 vs 5 vs 4). Independently re-verified this citation directly against the repository (file read / grep) rather than trusting C2's summary; the cited file/line/migration content matches exactly as described, and the raw actual/declared/historical fingerprints and field values in phase-b-comparison.json corroborate the stated fact pattern.

### 96. `enums: RequirementVerificationStatus|REVIEWED`

- **C2 disposition:** TRUE_SCHEMA_DRIFT
- **Verdict:** SUSTAINED
- **Confidence:** high
- **Challenge evidence:** SUSTAINED. actual_fingerprint === historical_fingerprint (byte-identical) while declared_fingerprint differs, for this enum value; sort_order fields quoted directly from file 1's structured actual/declared/historical objects (2 vs 3 vs 2). Independently re-verified this citation directly against the repository (file read / grep) rather than trusting C2's summary; the cited file/line/migration content matches exactly as described, and the raw actual/declared/historical fingerprints and field values in phase-b-comparison.json corroborate the stated fact pattern.

### 97. `enums: RequirementVerificationStatus|VERIFIED`

- **C2 disposition:** TRUE_SCHEMA_DRIFT
- **Verdict:** SUSTAINED
- **Confidence:** high
- **Challenge evidence:** SUSTAINED. actual_fingerprint === historical_fingerprint (byte-identical) while declared_fingerprint differs, for this enum value; sort_order fields quoted directly from file 1's structured actual/declared/historical objects (3 vs 4 vs 3). Independently re-verified this citation directly against the repository (file read / grep) rather than trusting C2's summary; the cited file/line/migration content matches exactly as described, and the raw actual/declared/historical fingerprints and field values in phase-b-comparison.json corroborate the stated fact pattern.

### 98. `extensions: vector`

- **C2 disposition:** TRUE_SCHEMA_DRIFT
- **Verdict:** SUSTAINED
- **Confidence:** high
- **Challenge evidence:** SUSTAINED. File 1 structured extension objects quoted directly: actual={name:"vector",schema:"public",version:"0.8.6"}; declared={name:"vector",schema:"public",version:"0.8.2"}; historical={name:"vector",schema:"public",version:"0.8.2"}. Independently re-verified this citation directly against the repository (file read / grep) rather than trusting C2's summary; the cited file/line/migration content matches exactly as described, and the raw actual/declared/historical fingerprints and field values in phase-b-comparison.json corroborate the stated fact pattern.


## Summary

```
SUSTAINED     85
OVERTURNED    13
--------------
TOTAL         98
```
