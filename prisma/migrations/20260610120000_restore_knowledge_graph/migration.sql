-- Restore Prisma knowledge graph tables removed in 20260513051405_consolidate_relations_and_remove_legacy_graph

CREATE TABLE "public"."knowledge_nodes" (
    "id" TEXT NOT NULL,
    "node_type" "public"."KnowledgeNodeType" NOT NULL,
    "name" TEXT NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "knowledge_nodes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "public"."knowledge_edges" (
    "id" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "target_id" TEXT NOT NULL,
    "relation" TEXT NOT NULL,
    "weight" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "knowledge_edges_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "public"."extracted_requirements" ADD COLUMN "knowledge_node_id" TEXT;

CREATE INDEX "knowledge_nodes_node_type_idx" ON "public"."knowledge_nodes"("node_type");

CREATE UNIQUE INDEX "knowledge_nodes_node_type_name_key" ON "public"."knowledge_nodes"("node_type", "name");

CREATE INDEX "knowledge_edges_source_id_relation_idx" ON "public"."knowledge_edges"("source_id", "relation");

CREATE INDEX "knowledge_edges_target_id_relation_idx" ON "public"."knowledge_edges"("target_id", "relation");

CREATE UNIQUE INDEX "knowledge_edges_source_id_target_id_relation_key" ON "public"."knowledge_edges"("source_id", "target_id", "relation");

ALTER TABLE "public"."extracted_requirements" ADD CONSTRAINT "extracted_requirements_knowledge_node_id_fkey" FOREIGN KEY ("knowledge_node_id") REFERENCES "public"."knowledge_nodes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "public"."knowledge_edges" ADD CONSTRAINT "knowledge_edges_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "public"."knowledge_nodes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "public"."knowledge_edges" ADD CONSTRAINT "knowledge_edges_target_id_fkey" FOREIGN KEY ("target_id") REFERENCES "public"."knowledge_nodes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
