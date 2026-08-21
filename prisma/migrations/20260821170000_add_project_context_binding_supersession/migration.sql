-- PROJECT-CONTEXT-BINDING-SUPERSESSION-V1
-- Rebuildable append-only projection. CAS artifacts and verified graph resolution remain authority.
CREATE TABLE "project_context_binding_supersessions" (
  "id" TEXT NOT NULL,
  "project_id" TEXT NOT NULL,
  "supersession_artifact_id" TEXT NOT NULL,
  "superseded_binding_artifact_id" TEXT NOT NULL,
  "successor_binding_artifact_id" TEXT NOT NULL,
  "reason_code" TEXT NOT NULL,
  "issuer_artifact_id" TEXT NOT NULL,
  "issuer_key_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "project_context_binding_supersessions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "project_context_binding_supersessions_project_id_fkey"
    FOREIGN KEY ("project_id") REFERENCES "Project"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "project_context_binding_supersessions_artifact_key"
  ON "project_context_binding_supersessions"("supersession_artifact_id");
CREATE INDEX "project_context_binding_supersessions_project_idx"
  ON "project_context_binding_supersessions"("project_id");
CREATE INDEX "project_context_binding_supersessions_predecessor_idx"
  ON "project_context_binding_supersessions"("project_id", "superseded_binding_artifact_id");
CREATE INDEX "project_context_binding_supersessions_successor_idx"
  ON "project_context_binding_supersessions"("project_id", "successor_binding_artifact_id");
