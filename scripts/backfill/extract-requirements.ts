/**
 * Steg 10a – Extrahera kravrader från materialiserade cases
 * Använder enkel sökords-heuristik (ska, villkor, etc.)
 * Kör: npx tsx scripts/backfill/extract-requirements.ts [--limit=20] [--dry-run]
 */
import { prisma } from '../../server/db/prisma';
import {
    arg, flag, startPipelineRun, finishPipelineRun, failPipelineRun,
    sha256, shortHash
} from './_shared';

const KEYWORDS = ['ska', 'skall', 'måste', 'får inte', 'krävs', 'villkor', 'beslutar', 'förpliktas'];

async function main() {
    const limit = Number(arg('limit') || 50);
    const dryRun = flag('dry-run');
    const runId = await startPipelineRun({
        runType: 'EXTRACT_REQS',
        stageName: 'extract-requirements',
        config: { limit, dryRun }
    });

    let processed = 0;
    const errors = 0;
    let reqCount = 0;

    try {
        const cases = await prisma.requirementCase.findMany({
            where: {
                requirements: { none: {} } // Only cases without requirements
            },
            include: {
                document: {
                    include: {
                        content: true
                    }
                }
            },
            take: limit,
            orderBy: { createdAt: 'desc' }
        });

        console.error(`Found ${cases.length} cases to process requirements for.`);

        for (const c of cases) {
            const text = c.document.content?.searchText ?? '';
            if (!text) {
                console.error(`SKIP: No text for case ${c.caseKey} (doc ${c.documentId})`);
                continue;
            }

            // Simple segment split: lines or sentences
            const segments = text.split(/\n|(?<=[.!?])\s+/)
                .map(s => s.trim())
                .filter(s => s.length > 20 && s.length < 1000);

            const candidates = segments.filter(s =>
                KEYWORDS.some(kw => s.toLowerCase().includes(kw))
            );

            console.error(`Case ${c.caseKey}: found ${candidates.length} candidate segments`);

            for (const segment of candidates) {
                const reqCode = `REQ-${shortHash(`${c.documentId}|${segment}`)}`;
                const reqHash = sha256(`${c.id}|${segment}`);

                if (!dryRun) {
                    await prisma.requirementRecord.upsert({
                        where: { requirementCode: reqCode },
                        create: {
                            requirementCode: reqCode,
                            requirementHash: reqHash,
                            caseId: c.id,
                            documentId: c.documentId,
                            projectId: c.projectId,
                            sourceType: 'AUTO_BACKFILL',
                            category: 'Ovrigt',
                            subcategory: 'Generell',
                            requirementTextQuote: segment,
                            interpretedRequirement: segment,
                            level: segment.toLowerCase().includes('bör') ? 'GUIDANCE' : 'MANDATORY',
                            statusInNotification: 'Ej behandlad',
                            codingConfidence: 'LOW'
                        },
                        update: {
                            requirementHash: reqHash,
                            requirementTextQuote: segment,
                            interpretedRequirement: segment
                        }
                    });

                    // Add a citation
                    const citCode = `CIT-${shortHash(`${reqCode}|1`)}`;
                    await prisma.requirementCitation.upsert({
                        where: { citationCode: citCode },
                        create: {
                            citationCode: citCode,
                            requirementId: (await prisma.requirementRecord.findUnique({ where: { requirementCode: reqCode }, select: { id: true } }))!.id,
                            caseId: c.id,
                            documentId: c.documentId,
                            quoteText: segment,
                            extractor: 'heuristics-v1'
                        },
                        update: {
                            quoteText: segment
                        }
                    });
                }
                reqCount++;
            }
            processed++;
        }

        await finishPipelineRun(runId, processed, errors);
        console.error(`Done. Processed ${processed} cases, created ${reqCount} requirement rows.`);
    } catch (e) {
        await failPipelineRun(runId, e);
        throw e;
    }

    console.log(JSON.stringify({ runId, processed, reqCount, errors }, null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
