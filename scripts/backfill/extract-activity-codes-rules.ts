import { prisma } from '../../server/db/prisma';
import { conditionalUpdate, startPipelineRun, finishPipelineRun, failPipelineRun } from './_shared';

async function main() {
    const runId = await startPipelineRun({ runType: 'ACTIVITY_RULES', stageName: 'extract-activity-codes-rules' });
    let processed = 0;
    const errors = 0;

    const rules = [
        { code: '90.40', keywords: ['mellanlagring av avfall', 'sortering av avfall', 'sortering och mellanlagring'] },
        { code: '90.30', keywords: ['mellanlagring av massor', 'schaktmassor', 'massa-mellanlagring'] },
        { code: '90.10', keywords: ['behandling av avfall', 'avfallsanläggning'] },
        { code: '06.00', keywords: ['vindkraft', 'vindpark'] },
        { code: '07.00', keywords: ['solcell', 'solpark'] },
        { code: '10.50', keywords: ['krossning', 'sortering av berg'] },
    ];

    try {
        const docs = await prisma.documentRecord.findMany({
            where: {
                activityCode: null,
                content: { isNot: null }
            },
            select: {
                id: true,
                subject: true,
                content: { select: { searchText: true } }
            }
        });

        console.log(`Analyzing ${docs.length} documents for activity codes via rules...`);

        for (const doc of docs) {
            const fullText = `${doc.subject} ${doc.content?.searchText ?? ''}`.toLowerCase();
            let matchedCode: string | null = null;
            let matchedKeyword: string | null = null;

            // Simple keyword matching
            for (const rule of rules) {
                for (const kw of rule.keywords) {
                    if (fullText.includes(kw.toLowerCase())) {
                        matchedCode = rule.code;
                        matchedKeyword = kw;
                        break;
                    }
                }
                if (matchedCode) break;
            }

            // Regex for explicit 90.XX codes
            if (!matchedCode) {
                const codeMatch = fullText.match(/\b(90\.\d{2}|06\.\d{2}|07\.\d{2}|10\.\d{2})\b/);
                if (codeMatch) {
                    matchedCode = codeMatch[1];
                    matchedKeyword = 'regex code match';
                }
            }

            if (matchedCode) {
                const res = await conditionalUpdate({
                    documentId: doc.id,
                    field: 'activityCode',
                    value: matchedCode,
                    confidence: 0.85,
                    sourceType: 'rule_based_extraction',
                    rawEvidence: `Matched keyword: ${matchedKeyword}`,
                    dryRun: false
                });
                if (res === 'updated') processed++;
            }
        }

        await finishPipelineRun(runId, processed, errors);
    } catch (e) {
        await failPipelineRun(runId, e);
        throw e;
    }

    console.log(`Rule-based extraction complete. Updated ${processed} documents.`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
