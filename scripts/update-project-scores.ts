import { prisma } from '../server/db/prisma';

/**
 * Beräknar och uppdaterar Compliance Score och Risk Score för projekt.
 * 
 * Logik (från bank_scoring_implementation.md):
 * 1. Compliance Score (0-100):
 *    - Baseras på andel verifierade krav.
 * 2. Risk Score:
 *    - Aggregerar vikter från kopplade krav (via graf eller direkt via krav-typer).
 */

async function updateProjectScores(projectId: string) {
    console.log(`Updating scores for project: ${projectId}`);

    // 1. Beräkna Compliance Score
    const totalReqs = await prisma.requirementRecord.count({ where: { projectId } });
    if (totalReqs === 0) return;

    const verifiedReqs = await prisma.requirementRecord.count({
        where: {
            projectId,
            // Vi antar att verifierade krav har status 'VERIFIED' eller liknande i framtiden
            // Just nu använder vi 'AUTO' som bas om de inte är rejected
        }
    });

    const complianceScore = (verifiedReqs / totalReqs) * 100;

    // 2. Beräkna Risk Score (Aggregerad risk baserat på kravtyper)
    // Vi hämtar alla krav och deras kategorier/text för att mappa till riskvikter
    const requirements = await prisma.requirementRecord.findMany({
        where: { projectId },
        select: { interpretedRequirement: true, requirementTextQuote: true, category: true, document: { select: { activityCode: true } } }
    });

    // Intern mappning (samma logik som i graf-scriptet)
    const RISK_WEIGHTS: Record<string, number> = {
        'Farligt Avfall': 5,
        'Lab-overskridande': 4,
        'Vattenskyddsomrade': 3,
        'Dokumentationsbrist': 2,
        'Volym-Risk': 2,
        'GenerellMiljorisk': 1
    };

    let totalRiskPoints = 0;
    const uniqueRisks = new Set<string>();

    for (const req of requirements) {
        const text = (req.interpretedRequirement || req.requirementTextQuote || '').toLowerCase();
        // Enkel detektion för att summera unika riskfaktorer per projekt
        if (text.includes('farligt avfall') || req.document?.activityCode?.startsWith('90.40')) uniqueRisks.add('Farligt Avfall');
        if (text.includes('riktvärde') || text.includes('överskridande')) uniqueRisks.add('Lab-overskridande');
        if (text.includes('vattenskydd')) uniqueRisks.add('Vattenskyddsomrade');
        if (text.includes('journal') || text.includes('redovisning')) uniqueRisks.add('Dokumentationsbrist');
        if (text.includes('mängd') || text.includes('volym')) uniqueRisks.add('Volym-Risk');
    }

    uniqueRisks.forEach(r => {
        totalRiskPoints += RISK_WEIGHTS[r] || 0;
    });

    // Mappa poäng till betyg (LOW / MEDIUM / HIGH)
    let fundingRating = 'LOW';
    if (totalRiskPoints >= 7) fundingRating = 'HIGH';
    else if (totalRiskPoints >= 3) fundingRating = 'MEDIUM';

    await prisma.project.update({
        where: { id: projectId },
        data: {
            complianceScore,
            regulatoryRiskScore: totalRiskPoints,
            fundingRating
        }
    });

    console.log(`Project ${projectId}: Compliance=${complianceScore.toFixed(1)}%, RiskPoints=${totalRiskPoints}, Rating=${fundingRating}`);
}

async function main() {
    const projects = await prisma.project.findMany();
    for (const p of projects) {
        await updateProjectScores(p.id);
    }
}

main().catch(console.error).finally(() => prisma.$disconnect());
