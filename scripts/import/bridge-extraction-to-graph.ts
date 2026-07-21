/**
 * bridge-extraction-to-graph.ts
 * 
 * Bridges 'ExtractedRequirement' to the Knowledge Graph ('KnowledgeNode'/'KnowledgeEdge').
 */
import { prisma } from '../../server/db/prisma';
import { buildGraphFromRequirements } from '../../server/services/knowledgeGraphService';

async function main() {
    console.log('--- KNOWLEDGE GRAPH BRIDGE ---');
    
    const requirements = await prisma.extractedRequirement.findMany({
        take: 500,
        include: {
            attachment: {
                include: {
                    document: true
                }
            }
        }
    });

    if (requirements.length === 0) {
        console.log('No extracted requirements found to bridge. Run processPendingAttachments first.');
        return;
    }

    console.log('Found ' + requirements.length + ' requirements. Building graph nodes...');

    const input = requirements.map(r => ({
        attachmentHash: r.attachmentHash,
        municipality: r.municipality || r.attachment?.document?.municipalityNormalized,
        caseNumber: r.caseNumber || r.attachment?.document?.entryId,
        requirementText: r.requirementText,
        category: r.category,
        requirementLevel: r.requirementLevel,
        legalReference: r.legalReference,
        confidence: r.confidence
    }));

    const result = await buildGraphFromRequirements(input);
    console.log('Success: Created ' + result.nodesCreated + ' nodes and ' + result.edgesCreated + ' edges.');
}

main().catch(console.error).finally(() => prisma.$disconnect());
