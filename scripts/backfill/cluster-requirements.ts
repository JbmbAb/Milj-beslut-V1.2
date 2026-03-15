import { prisma } from '../../server/db/prisma';
import { startPipelineRun, finishPipelineRun, failPipelineRun } from './_shared';

async function main() {
    const runId = await startPipelineRun({ runType: 'CLUSTER', stageName: 'cluster-requirements' });
    let processed = 0;
    const errors = 0;

    const clusters = [
        { category: 'BullerBullerskydd', keywords: ['buller', 'skärm', 'ljuddämp', 'vallen', 'ljudnivå', 'riktvärde för buller'] },
        { category: 'DammDammbildning', keywords: ['damm', 'bevattning', 'dammbildande', 'sopning', 'vindkänsligt'] },
        { category: 'LuktOdor', keywords: ['lukt', 'odör', 'spridning av lukt', 'luktolägenhet'] },
        { category: 'TransportTrafik', keywords: ['transport', 'fordon', 'trafik', 'lastbil', 'ut- och infart', 'vägdamning'] },
        { category: 'KemikalierHantering', keywords: ['kemikalie', 'pölsäker', 'invallning', 'cistern', 'absorptionsmedel', 'sanering'] },
        { category: 'RiskanalysSakerhet', keywords: ['risk', 'olycka', 'brand', 'stängsel', 'grind', 'obehöriga', 'larm'] },
        { category: 'KontrollProvtagning', keywords: ['provtagning', 'analys', 'kontrollprogram', 'recipient', 'grundvattenrör'] },
        { category: 'BelysningLjus', keywords: ['belysning', 'strålkastare', 'ljusstörning'] },
    ];

    try {
        const requirements = await prisma.requirementRecord.findMany({
            where: {
                category: 'Ovrigt'
            }
        });

        console.log(`Clustering ${requirements.length} 'Ovrigt' requirements...`);

        for (const req of requirements) {
            const text = req.requirementTextQuote.toLowerCase();
            let matchedCategory: string | null = null;

            for (const cluster of clusters) {
                for (const kw of cluster.keywords) {
                    if (text.includes(kw.toLowerCase())) {
                        matchedCategory = cluster.category;
                        break;
                    }
                }
                if (matchedCategory) break;
            }

            if (matchedCategory) {
                await prisma.requirementRecord.update({
                    where: { id: req.id },
                    data: { category: matchedCategory }
                });
                processed++;
            }
        }

        await finishPipelineRun(runId, processed, errors);
    } catch (e) {
        await failPipelineRun(runId, e);
        throw e;
    }

    console.log(`Clustering complete. Re-categorized ${processed} requirements.`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
