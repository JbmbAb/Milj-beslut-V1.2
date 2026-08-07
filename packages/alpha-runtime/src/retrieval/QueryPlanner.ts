import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export interface QueryPlanContext {
  municipality_id?: string;
  decision_date_start?: Date;
  decision_date_end?: Date;
  intent: string;
}

export class QueryPlanner {
  /**
   * Plans and executes an AI retrieval query.
   * Enforces MIMER-SCALE-I01 by reading exclusively from DecisionImpactArtifact
   * instead of raw EvidenceChunks.
   */
  async executeRetrieval(context: QueryPlanContext) {
    console.log(`Planning retrieval for intent: ${context.intent}`);

    // Build the query against the materialized facts layer
    const whereClause: any = {};
    if (context.municipality_id) {
      whereClause.municipality_id = context.municipality_id;
    }

    // A real implementation would parse the intent to vector search over decision_facts
    // or filter by semantic properties. For now, we fetch the relevant artifacts.
    const artifacts = await prisma.decisionImpactArtifact.findMany({
      where: {
        ...whereClause,
        verification_status: 'VERIFIED',
      },
      take: 20, // Soft limit (to be handled by CostGuard in Epoch 3)
      orderBy: { created_at: 'desc' }
    });

    console.log(`Query Planner retrieved ${artifacts.length} materialized artifacts.`);

    // Return the distilled facts directly to the AI, NEVER the raw evidence.
    return artifacts.map(a => ({
      id: a.id,
      municipality_id: a.municipality_id,
      facts: a.decision_facts,
      semantic_version: a.semantic_version
    }));
  }
}
