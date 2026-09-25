# PUBLIC-PRISMA-BASELINE-RECONCILIATION-01 — Phase C ratification

Status: **RECOVERY_REFERENCE_RATIFICATION_COMPLETE — BASELINE DDL NOT AUTHORIZED**

Comparison SHA-256: `7e0bcd73d758561418b32166e76d56dfda5f15b1b03ec96e5d26d3dc24b9226a`

Governing frozen rule: `public` is Prisma-owned and current production + `schema.prisma` are the recovery reference.

## Summary

| Result | Count |
|---|---:|
| Total findings | 1947 |
| Ratified from recovery-reference agreement | 1849 |
| Review required | 98 |

## Ratification rule

A finding is mechanically ratified only when ACTUAL and DECLARED have identical semantic fingerprints, including the case where both omit the object.

- `MATCH` => keep the agreed recovery-reference state.
- `HISTORY_DRIFT` => baseline to the agreed ACTUAL/DECLARED state; historical reconstruction is stale.
- `HISTORY_ONLY` => exclude the historical-only object from the new baseline because both recovery references omit it.

All findings where ACTUAL and DECLARED disagree remain held for explicit review.

## Review-required findings

| Section | Identity | Source class | Reason |
|---|---|---|---|
| relations | _prisma_migrations\|r | DECLARED_DRIFT | ACTUAL and DECLARED disagree; declaration differs from running recovery reference. |
| relations | localization_geometry_supersessions\|r | DECLARED_DRIFT | ACTUAL and DECLARED disagree; declaration differs from running recovery reference. |
| columns | PostgisImportBatch\|imported_at | INTENT_REQUIRES_OWNER_DECISION | No recovery-reference agreement exists; owner intent must be resolved explicitly. |
| columns | PostgisImportBatch\|started_at | INTENT_REQUIRES_OWNER_DECISION | No recovery-reference agreement exists; owner intent must be resolved explicitly. |
| columns | Project\|property_source_dataset | ACTUAL_ONLY | Running object is absent from DECLARED; recovery references disagree. |
| columns | Project\|property_source_key | ACTUAL_ONLY | Running object is absent from DECLARED; recovery references disagree. |
| columns | _prisma_migrations\|applied_steps_count | DECLARED_DRIFT | ACTUAL and DECLARED disagree; declaration differs from running recovery reference. |
| columns | _prisma_migrations\|checksum | DECLARED_DRIFT | ACTUAL and DECLARED disagree; declaration differs from running recovery reference. |
| columns | _prisma_migrations\|finished_at | DECLARED_DRIFT | ACTUAL and DECLARED disagree; declaration differs from running recovery reference. |
| columns | _prisma_migrations\|id | DECLARED_DRIFT | ACTUAL and DECLARED disagree; declaration differs from running recovery reference. |
| columns | _prisma_migrations\|logs | DECLARED_DRIFT | ACTUAL and DECLARED disagree; declaration differs from running recovery reference. |
| columns | _prisma_migrations\|migration_name | DECLARED_DRIFT | ACTUAL and DECLARED disagree; declaration differs from running recovery reference. |
| columns | _prisma_migrations\|rolled_back_at | DECLARED_DRIFT | ACTUAL and DECLARED disagree; declaration differs from running recovery reference. |
| columns | _prisma_migrations\|started_at | DECLARED_DRIFT | ACTUAL and DECLARED disagree; declaration differs from running recovery reference. |
| columns | legal_corpus_chunk_embeddings\|embeddingVector | DECLARED_ONLY | Declared object is absent from ACTUAL; recovery references disagree. |
| columns | legal_corpus_chunk_embeddings\|embedding_vector | DECLARED_DRIFT | ACTUAL and DECLARED disagree; declaration differs from running recovery reference. |
| columns | legal_corpus_chunks\|created_at | INTENT_REQUIRES_OWNER_DECISION | No recovery-reference agreement exists; owner intent must be resolved explicitly. |
| columns | legal_corpus_chunks\|embedding_vector | DECLARED_DRIFT | ACTUAL and DECLARED disagree; declaration differs from running recovery reference. |
| columns | localization_geometry_supersessions\|created_at | DECLARED_DRIFT | ACTUAL and DECLARED disagree; declaration differs from running recovery reference. |
| columns | localization_geometry_supersessions\|id | DECLARED_DRIFT | ACTUAL and DECLARED disagree; declaration differs from running recovery reference. |
| columns | localization_geometry_supersessions\|predecessor_geometry_artifact_id | DECLARED_DRIFT | ACTUAL and DECLARED disagree; declaration differs from running recovery reference. |
| columns | localization_geometry_supersessions\|project_id | DECLARED_DRIFT | ACTUAL and DECLARED disagree; declaration differs from running recovery reference. |
| columns | localization_geometry_supersessions\|successor_geometry_artifact_id | DECLARED_DRIFT | ACTUAL and DECLARED disagree; declaration differs from running recovery reference. |
| columns | localization_geometry_supersessions\|supersession_artifact_id | DECLARED_DRIFT | ACTUAL and DECLARED disagree; declaration differs from running recovery reference. |
| constraints | _prisma_migrations\|_prisma_migrations_pkey | DECLARED_DRIFT | ACTUAL and DECLARED disagree; declaration differs from running recovery reference. |
| constraints | legal_corpus_chunk_embeddings\|legal_corpus_chunk_embeddings_materialization_id_fragment__fkey | DECLARED_ONLY | Declared object is absent from ACTUAL; recovery references disagree. |
| constraints | legal_corpus_chunk_embeddings\|legal_corpus_chunk_embeddings_materialization_id_fragment_id_fk | DECLARED_DRIFT | ACTUAL and DECLARED disagree; declaration differs from running recovery reference. |
| constraints | legal_corpus_chunks\|legal_corpus_chunks_record_id_chunk_index_chunk_version_key | ACTUAL_ONLY | Running object is absent from DECLARED; recovery references disagree. |
| constraints | localization_geometry_supersession_requests\|localization_geometry_supersession_requests_requested_by_fkey | DECLARED_DRIFT | ACTUAL and DECLARED disagree; declaration differs from running recovery reference. |
| constraints | localization_geometry_supersession_requests\|localization_geometry_supersession_requests_requested_by_u_fkey | DECLARED_ONLY | Declared object is absent from ACTUAL; recovery references disagree. |
| constraints | localization_geometry_supersessions\|localization_geometry_supersessions_pkey | DECLARED_DRIFT | ACTUAL and DECLARED disagree; declaration differs from running recovery reference. |
| constraints | localization_geometry_supersessions\|localization_geometry_supersessions_project_id_fkey | DECLARED_DRIFT | ACTUAL and DECLARED disagree; declaration differs from running recovery reference. |
| constraints | localization_identity_provisioning_requests\|localization_identity_provisioning_requests_requested_by_u_fkey | DECLARED_ONLY | Declared object is absent from ACTUAL; recovery references disagree. |
| constraints | localization_identity_provisioning_requests\|localization_identity_provisioning_requests_requested_by_user_i | DECLARED_DRIFT | ACTUAL and DECLARED disagree; declaration differs from running recovery reference. |
| constraints | viewer_capability_provisioning_requests\|viewer_capability_provisioning_requests_requested_by_user__fkey | DECLARED_ONLY | Declared object is absent from ACTUAL; recovery references disagree. |
| constraints | viewer_capability_provisioning_requests\|viewer_capability_provisioning_requests_requested_by_user_id_fk | DECLARED_DRIFT | ACTUAL and DECLARED disagree; declaration differs from running recovery reference. |
| indexes | DocumentChunk\|documentchunk_embedding_hnsw_idx | ACTUAL_ONLY | Running object is absent from DECLARED; recovery references disagree. |
| indexes | PostgisImportBatch\|uq_postgis_import_batch | ACTUAL_ONLY | Running object is absent from DECLARED; recovery references disagree. |
| indexes | _prisma_migrations\|_prisma_migrations_pkey | DECLARED_DRIFT | ACTUAL and DECLARED disagree; declaration differs from running recovery reference. |
| indexes | attachments\|idx_attachments_document | DECLARED_DRIFT | ACTUAL and DECLARED disagree; declaration differs from running recovery reference. |
| indexes | attachments\|idx_attachments_parsed | DECLARED_DRIFT | ACTUAL and DECLARED disagree; declaration differs from running recovery reference. |
| indexes | legal_corpus_chunks\|idx_legal_chunks_embedding_hnsw | DECLARED_DRIFT | ACTUAL and DECLARED disagree; declaration differs from running recovery reference. |
| indexes | legal_corpus_chunks\|legal_corpus_chunks_chapter_paragraph_idx | INTENT_REQUIRES_OWNER_DECISION | No recovery-reference agreement exists; owner intent must be resolved explicitly. |
| indexes | legal_corpus_materializations\|legal_corpus_materializations_identity_key | DECLARED_DRIFT | ACTUAL and DECLARED disagree; declaration differs from running recovery reference. |
| indexes | legal_corpus_materializations\|legal_corpus_materializations_logical_source_id_registry_ar_key | DECLARED_ONLY | Declared object is absent from ACTUAL; recovery references disagree. |
| indexes | legal_corpus_materialized_chunks\|legal_corpus_materialized_chunks_materialization_id_fragmen_key | DECLARED_ONLY | Declared object is absent from ACTUAL; recovery references disagree. |
| indexes | legal_corpus_materialized_chunks\|legal_corpus_materialized_chunks_materialization_id_fragment_i | DECLARED_DRIFT | ACTUAL and DECLARED disagree; declaration differs from running recovery reference. |
| indexes | legal_corpus_materialized_chunks\|legal_corpus_materialized_chunks_materialization_id_sequenc_idx | DECLARED_ONLY | Declared object is absent from ACTUAL; recovery references disagree. |
| indexes | legal_corpus_materialized_chunks\|legal_corpus_materialized_chunks_materialization_id_sequence_i | DECLARED_DRIFT | ACTUAL and DECLARED disagree; declaration differs from running recovery reference. |
| indexes | localization_geometry_projections\|localization_geometry_projections_project_id_geometry_artif_key | DECLARED_ONLY | Declared object is absent from ACTUAL; recovery references disagree. |
| indexes | localization_geometry_projections\|localization_geometry_projections_project_id_geometry_artifact_ | DECLARED_DRIFT | ACTUAL and DECLARED disagree; declaration differs from running recovery reference. |
| indexes | localization_geometry_supersession_requests\|localization_geometry_supersession_requests_project_id_pred_idx | DECLARED_ONLY | Declared object is absent from ACTUAL; recovery references disagree. |
| indexes | localization_geometry_supersession_requests\|localization_geometry_supersession_requests_status_created__idx | DECLARED_ONLY | Declared object is absent from ACTUAL; recovery references disagree. |
| indexes | localization_geometry_supersession_requests\|localization_geometry_supersession_requests_status_created_idx | DECLARED_DRIFT | ACTUAL and DECLARED disagree; declaration differs from running recovery reference. |
| indexes | localization_geometry_supersession_requests\|localization_geometry_supersession_requests_subject_idx | DECLARED_DRIFT | ACTUAL and DECLARED disagree; declaration differs from running recovery reference. |
| indexes | localization_geometry_supersessions\|localization_geometry_supersessions_pkey | DECLARED_DRIFT | ACTUAL and DECLARED disagree; declaration differs from running recovery reference. |
| indexes | localization_geometry_supersessions\|localization_geometry_supersessions_project_idx | DECLARED_DRIFT | ACTUAL and DECLARED disagree; declaration differs from running recovery reference. |
| indexes | localization_geometry_supersessions\|localization_geometry_supersessions_project_supersession_key | DECLARED_DRIFT | ACTUAL and DECLARED disagree; declaration differs from running recovery reference. |
| indexes | localization_identity_provisioning_requests\|localization_identity_provisioning_requests_project_id_geom_idx | DECLARED_ONLY | Declared object is absent from ACTUAL; recovery references disagree. |
| indexes | localization_identity_provisioning_requests\|localization_identity_provisioning_requests_project_id_geometry | DECLARED_DRIFT | ACTUAL and DECLARED disagree; declaration differs from running recovery reference. |
| indexes | localization_identity_provisioning_requests\|localization_identity_provisioning_requests_status_created__idx | DECLARED_ONLY | Declared object is absent from ACTUAL; recovery references disagree. |
| indexes | localization_identity_provisioning_requests\|localization_identity_provisioning_requests_status_created_at_i | DECLARED_DRIFT | ACTUAL and DECLARED disagree; declaration differs from running recovery reference. |
| indexes | project_assessment_projections\|project_assessment_projections_binding_idx | DECLARED_DRIFT | ACTUAL and DECLARED disagree; declaration differs from running recovery reference. |
| indexes | project_assessment_projections\|project_assessment_projections_created_idx | DECLARED_DRIFT | ACTUAL and DECLARED disagree; declaration differs from running recovery reference. |
| indexes | project_assessment_projections\|project_assessment_projections_project_assessment_key | DECLARED_DRIFT | ACTUAL and DECLARED disagree; declaration differs from running recovery reference. |
| indexes | project_assessment_projections\|project_assessment_projections_project_id_assessment_artifa_key | DECLARED_ONLY | Declared object is absent from ACTUAL; recovery references disagree. |
| indexes | project_assessment_projections\|project_assessment_projections_project_id_binding_artifact__idx | DECLARED_ONLY | Declared object is absent from ACTUAL; recovery references disagree. |
| indexes | project_assessment_projections\|project_assessment_projections_project_id_created_at_idx | DECLARED_ONLY | Declared object is absent from ACTUAL; recovery references disagree. |
| indexes | project_assessment_projections\|project_assessment_projections_project_id_localization_geom_idx | DECLARED_ONLY | Declared object is absent from ACTUAL; recovery references disagree. |
| indexes | project_assessment_projections\|project_assessment_projections_project_id_localization_geometry | DECLARED_DRIFT | ACTUAL and DECLARED disagree; declaration differs from running recovery reference. |
| indexes | project_context_binding_supersessions\|project_context_binding_supersessions_artifact_key | DECLARED_DRIFT | ACTUAL and DECLARED disagree; declaration differs from running recovery reference. |
| indexes | project_context_binding_supersessions\|project_context_binding_supersessions_predecessor_idx | DECLARED_DRIFT | ACTUAL and DECLARED disagree; declaration differs from running recovery reference. |
| indexes | project_context_binding_supersessions\|project_context_binding_supersessions_project_id_idx | DECLARED_ONLY | Declared object is absent from ACTUAL; recovery references disagree. |
| indexes | project_context_binding_supersessions\|project_context_binding_supersessions_project_id_successor__idx | DECLARED_ONLY | Declared object is absent from ACTUAL; recovery references disagree. |
| indexes | project_context_binding_supersessions\|project_context_binding_supersessions_project_id_superseded_idx | DECLARED_ONLY | Declared object is absent from ACTUAL; recovery references disagree. |
| indexes | project_context_binding_supersessions\|project_context_binding_supersessions_project_idx | DECLARED_DRIFT | ACTUAL and DECLARED disagree; declaration differs from running recovery reference. |
| indexes | project_context_binding_supersessions\|project_context_binding_supersessions_successor_idx | DECLARED_DRIFT | ACTUAL and DECLARED disagree; declaration differs from running recovery reference. |
| indexes | project_context_binding_supersessions\|project_context_binding_supersessions_supersession_artifact_key | DECLARED_ONLY | Declared object is absent from ACTUAL; recovery references disagree. |
| indexes | project_context_bindings\|project_context_bindings_project_context_idx | ACTUAL_ONLY | Running object is absent from DECLARED; recovery references disagree. |
| indexes | project_context_bindings\|project_context_bindings_project_context_key | ACTUAL_ONLY | Running object is absent from DECLARED; recovery references disagree. |
| indexes | project_context_bindings\|project_context_bindings_project_id_project_context_artifac_idx | DECLARED_ONLY | Declared object is absent from ACTUAL; recovery references disagree. |
| indexes | project_context_bindings\|project_context_bindings_project_id_project_context_artifac_key | DECLARED_ONLY | Declared object is absent from ACTUAL; recovery references disagree. |
| indexes | project_context_bootstrap_requests\|project_context_bootstrap_requests_project_id_idx | DECLARED_ONLY | Declared object is absent from ACTUAL; recovery references disagree. |
| indexes | project_context_bootstrap_requests\|project_context_bootstrap_requests_project_idx | DECLARED_DRIFT | ACTUAL and DECLARED disagree; declaration differs from running recovery reference. |
| indexes | project_context_bootstrap_requests\|project_context_bootstrap_requests_status_created_at_idx | DECLARED_ONLY | Declared object is absent from ACTUAL; recovery references disagree. |
| indexes | project_context_bootstrap_requests\|project_context_bootstrap_requests_status_created_idx | DECLARED_DRIFT | ACTUAL and DECLARED disagree; declaration differs from running recovery reference. |
| indexes | viewer_capability_provisioning_requests\|viewer_capability_provisioning_requests_project_id_context__idx | DECLARED_ONLY | Declared object is absent from ACTUAL; recovery references disagree. |
| indexes | viewer_capability_provisioning_requests\|viewer_capability_provisioning_requests_project_id_ctx_rel_vid_ | DECLARED_DRIFT | ACTUAL and DECLARED disagree; declaration differs from running recovery reference. |
| enums | ConfidenceLevel\|HIGH | DECLARED_DRIFT | ACTUAL and DECLARED disagree; declaration differs from running recovery reference. |
| enums | ConfidenceLevel\|LOW | DECLARED_DRIFT | ACTUAL and DECLARED disagree; declaration differs from running recovery reference. |
| enums | DocumentProcessingStatus\|CHUNKED | DECLARED_DRIFT | ACTUAL and DECLARED disagree; declaration differs from running recovery reference. |
| enums | DocumentProcessingStatus\|EMBEDDED | DECLARED_DRIFT | ACTUAL and DECLARED disagree; declaration differs from running recovery reference. |
| enums | DocumentProcessingStatus\|FAILED | DECLARED_DRIFT | ACTUAL and DECLARED disagree; declaration differs from running recovery reference. |
| enums | RequirementVerificationStatus\|NEEDS_REVIEW | DECLARED_DRIFT | ACTUAL and DECLARED disagree; declaration differs from running recovery reference. |
| enums | RequirementVerificationStatus\|REJECTED | DECLARED_DRIFT | ACTUAL and DECLARED disagree; declaration differs from running recovery reference. |
| enums | RequirementVerificationStatus\|REVIEWED | DECLARED_DRIFT | ACTUAL and DECLARED disagree; declaration differs from running recovery reference. |
| enums | RequirementVerificationStatus\|VERIFIED | DECLARED_DRIFT | ACTUAL and DECLARED disagree; declaration differs from running recovery reference. |
| extensions | vector | ACTUAL_DRIFT | Running recovery reference differs from DECLARED; environment/runtime parity may be involved. |

## Stop boundary

This artifact ratifies recovery-reference agreement only. It does not generate baseline SQL, mutate `_prisma_migrations`, delete historical migrations, merge, or promote.

