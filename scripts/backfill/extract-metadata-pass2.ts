/**
 * Steg 6 – Pass 2: Metadata från dokumenttext (rubrik + första 2000 tecken)
 * Kör: npx tsx scripts/backfill/extract-metadata-pass2.ts [--limit=200] [--dry-run]
 */
import { prisma } from '../../server/db/prisma';
import {
    arg, flag, startPipelineRun, finishPipelineRun, failPipelineRun,
    conditionalUpdate, extractDiarieSignal, BATCH, MUNICIPALITY_MAP, repairSwedishMojibake,
} from './_shared';

const DECISION_KW: Record<string, string> = {
    'anmälan enligt': 'Anmälan C', 'c-verksamhet': 'Anmälan C',
    'tillstånd': 'Tillstånd B', 'b-verksamhet': 'Tillstånd B',
    'föreläggande': 'Föreläggande', 'villkorsbeslut': 'Villkorsbeslut',
    'förbud': 'Förbud', 'dispens': 'Dispens',
};

const ACTIVITY_RE = /\b(\d{2})\.(\d{2})\b/;

const WASTE_KW: Record<string, string> = {
    'farligt avfall': 'Farligt avfall', 'elavfall': 'Elavfall',
    'däck': 'Däck', 'bygg- och rivning': 'Bygg- och rivningsavfall',
    'metallskrot': 'Metallskrot', 'deponi': 'Deponi',
    'schaktmassor': 'Schaktmassor', 'asbest': 'Asbest',
};

function extractFromText(text: string) {
    const lower = text.toLowerCase();
    const ascii = lower
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9\s-]/g, ' ');
    let municipality: string | null = null;
    let muniConf = 0;
    for (const [key, display] of Object.entries(MUNICIPALITY_MAP)) {
        const normalizedKey = repairSwedishMojibake(key)
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-z0-9\s-]/g, ' ');
        if (ascii.includes(normalizedKey)) { municipality = repairSwedishMojibake(display); muniConf = 0.91; break; }
    }
    let decisionType: string | null = null;
    let dtConf = 0;
    for (const [kw, label] of Object.entries(DECISION_KW)) {
        if (lower.includes(kw)) { decisionType = label; dtConf = 0.88; break; }
    }
    const actM = ACTIVITY_RE.exec(text);
    const activityCode = actM ? actM[0] : null;
    let wasteType: string | null = null;
    let wtConf = 0;
    for (const [kw, label] of Object.entries(WASTE_KW)) {
        if (lower.includes(kw)) { wasteType = label; wtConf = 0.80; break; }
    }
    const diarie = extractDiarieSignal(text);
    return { municipality, muniConf, decisionType, dtConf, activityCode, wasteType, wtConf, diarie };
}

async function main() {
    const limit = Number(arg('limit') || BATCH.metadataPass);
    const dryRun = flag('dry-run');
    const runId = await startPipelineRun({ runType: 'META_PASS2', stageName: 'extract-metadata-pass2', config: { limit, dryRun } });
    let processed = 0;
    let errors = 0;

    try {
        let cursor: string | undefined;
        while (processed < limit) {
            const docs = await prisma.documentRecord.findMany({
                where: {
                    status: { in: ['TEXT_EXTRACTED', 'CHUNKED', 'EMBEDDED'] },
                    metadataReviewStatus: { not: 'LOCKED' },
                    content: { isNot: null },
                },
                select: { id: true, content: { select: { searchText: true } } },
                take: Math.min(BATCH.metadataPass, limit - processed),
                ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
                orderBy: { id: 'asc' },
            });
            if (docs.length === 0) break;

            for (const doc of docs) {
                if (processed >= limit) break;
                const text = (doc.content?.searchText ?? '').slice(0, 2000);
                if (!text) { cursor = doc.id; continue; }
                try {
                    const ex = extractFromText(text);
                    await Promise.allSettled([
                        ex.municipality ? conditionalUpdate({ documentId: doc.id, field: 'municipality', value: ex.municipality, confidence: ex.muniConf, sourceType: 'text_regex', extractorVersion: '1.0', dryRun }) : Promise.resolve(),
                        ex.diarie.value ? conditionalUpdate({ documentId: doc.id, field: 'legalStatus', value: ex.diarie.value, confidence: ex.diarie.confidence, sourceType: 'text_regex', extractorVersion: '1.1', rawEvidence: text.slice(0, 200), dryRun }) : Promise.resolve(),
                        ex.decisionType ? conditionalUpdate({ documentId: doc.id, field: 'decisionType', value: ex.decisionType, confidence: ex.dtConf, sourceType: 'text_regex', extractorVersion: '1.0', dryRun }) : Promise.resolve(),
                        ex.activityCode ? conditionalUpdate({ documentId: doc.id, field: 'activityCode', value: ex.activityCode, confidence: 0.83, sourceType: 'text_regex', extractorVersion: '1.0', dryRun }) : Promise.resolve(),
                        ex.wasteType ? conditionalUpdate({ documentId: doc.id, field: 'wasteType', value: ex.wasteType, confidence: ex.wtConf, sourceType: 'text_regex', extractorVersion: '1.0', dryRun }) : Promise.resolve(),
                    ]);
                    processed++;
                } catch (e) {
                    console.error(`Error on doc ${doc.id}:`, e);
                    errors++;
                }
                cursor = doc.id;
            }
        }

        await finishPipelineRun(runId, processed, errors);
    } catch (e) {
        await failPipelineRun(runId, e);
        throw e;
    }

    console.log(JSON.stringify({ runId, dryRun, processed, errors }, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
