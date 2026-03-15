/**
 * Steg 3 – Pass 1: Deterministisk metadata-extraktion
 * Källor: subject, originalName, entryId, manifestMeta
 * Kör: npx tsx scripts/backfill/extract-metadata-pass1.ts [--limit=200] [--dry-run]
 */
import { prisma } from '../../server/db/prisma';
import {
    arg, flag, startPipelineRun, finishPipelineRun, failPipelineRun,
    conditionalUpdate, extractDiarie, extractMunicipalityWeighted, BATCH,
} from './_shared';

const DECISION_KEYWORDS: Record<string, string> = {
    'anmälan': 'Anmälan C',
    'anmalan': 'Anmälan C',
    'tillstånd': 'Tillstånd B',
    'tillstand': 'Tillstånd B',
    'beslut': 'Beslut',
    'föreläggande': 'Föreläggande',
    'forelaggande': 'Föreläggande',
    'förbud': 'Förbud',
    'dispens': 'Dispens',
};

const ACTIVITY_REGEX = /\b(\d{2})\.(\d{2})\b/g; // t.ex. 90.30

const WASTE_KEYWORDS: Record<string, string> = {
    'farligt avfall': 'Farligt avfall',
    'elavfall': 'Elavfall',
    'däck': 'Däck',
    'bygg': 'Bygg- och rivningsavfall',
    'metall': 'Metallskrot',
    'deponi': 'Deponi',
    'massor': 'Schaktmassor',
    'asbest': 'Asbest',
};

// Municipality extraction now handled by extractMunicipalityWeighted from _shared.ts

function extractDecisionType(text: string): { value: string | null; confidence: number } {
    const lower = text.toLowerCase();
    for (const [kw, label] of Object.entries(DECISION_KEYWORDS)) {
        if (lower.includes(kw)) return { value: label, confidence: 0.87 };
    }
    return { value: null, confidence: 0 };
}

function extractActivityCode(text: string): { value: string | null; confidence: number } {
    ACTIVITY_REGEX.lastIndex = 0;
    const m = ACTIVITY_REGEX.exec(text);
    if (m) return { value: m[0], confidence: 0.85 };
    return { value: null, confidence: 0 };
}

function extractWasteType(text: string): { value: string | null; confidence: number } {
    const lower = text.toLowerCase();
    for (const [kw, label] of Object.entries(WASTE_KEYWORDS)) {
        if (lower.includes(kw)) return { value: label, confidence: 0.78 };
    }
    return { value: null, confidence: 0 };
}

async function processDoc(doc: {
    id: string;
    subject: string;
    originalName: string;
    entryId: string;
    legalStatus: string | null;
    manifestMeta: unknown;
    absolutePath: string;
}, dryRun: boolean) {
    // Extract sender email from manifestMeta (from Outlook ingest CSV)
    const meta = doc.manifestMeta as Record<string, string> | null;
    const senderEmail = meta?.sender || meta?.Sender || meta?.SenderEmail || meta?.senderEmail || '';

    // Weighted municipality extraction: subject + path + sender domain
    const muni = extractMunicipalityWeighted({
        subject: doc.subject + ' ' + doc.originalName + ' ' + (doc.legalStatus ?? ''),
        absolutePath: doc.absolutePath,
        senderEmail,
    });

    const searchText = [
        doc.subject, doc.originalName, doc.entryId,
        JSON.stringify(meta ?? {}), doc.legalStatus ?? '',
    ].join(' ');

    const dt = extractDecisionType(searchText);
    const ac = extractActivityCode(searchText);
    const wt = extractWasteType(searchText);
    const diarie = extractDiarie(searchText);

    await Promise.allSettled([
        muni.value ? conditionalUpdate({ documentId: doc.id, field: 'municipality', value: muni.value, confidence: muni.confidence, sourceType: 'subject_regex', extractorVersion: '1.1', rawEvidence: searchText.slice(0, 200), dryRun }) : Promise.resolve('skipped_lower' as const),
        diarie ? conditionalUpdate({ documentId: doc.id, field: 'legalStatus', value: diarie, confidence: 0.91, sourceType: 'subject_regex', extractorVersion: '1.1', rawEvidence: doc.subject.slice(0, 200), dryRun }) : Promise.resolve('skipped_lower' as const),
        dt.value ? conditionalUpdate({ documentId: doc.id, field: 'decisionType', value: dt.value, confidence: dt.confidence, sourceType: 'subject_regex', extractorVersion: '1.1', dryRun }) : Promise.resolve('skipped_lower' as const),
        ac.value ? conditionalUpdate({ documentId: doc.id, field: 'activityCode', value: ac.value, confidence: ac.confidence, sourceType: 'subject_regex', extractorVersion: '1.1', dryRun }) : Promise.resolve('skipped_lower' as const),
        wt.value ? conditionalUpdate({ documentId: doc.id, field: 'wasteType', value: wt.value, confidence: wt.confidence, sourceType: 'subject_regex', extractorVersion: '1.1', dryRun }) : Promise.resolve('skipped_lower' as const),
    ]);
}

async function main() {
    const limit = Number(arg('limit') || 3300);
    const dryRun = flag('dry-run');
    const onlyMissing = flag('only-missing'); // target only docs without municipality

    const runId = await startPipelineRun({ runType: 'META_PASS1', stageName: 'extract-metadata-pass1', config: { limit, dryRun, onlyMissing } });
    let processed = 0;
    let errors = 0;

    try {
        let offset = 0;
        while (processed < limit) {
            const docs = await prisma.documentRecord.findMany({
                where: {
                    metadataReviewStatus: { not: 'LOCKED' },
                    ...(onlyMissing ? { municipalityNormalized: null } : {}),
                },
                select: { id: true, subject: true, originalName: true, entryId: true, legalStatus: true, manifestMeta: true, absolutePath: true },
                take: BATCH.metadataPass,
                skip: offset,
                orderBy: { createdAt: 'asc' },
            });
            if (docs.length === 0) break;

            for (const doc of docs) {
                try {
                    await processDoc(doc, dryRun);
                    processed++;
                } catch (e) {
                    console.error(`Error on doc ${doc.id}:`, e);
                    errors++;
                }
            }

            offset += docs.length;
            if (processed >= limit) break;
            console.error(`Pass 1: ${processed} processed so far...`);
        }

        await finishPipelineRun(runId, processed, errors);
    } catch (e) {
        await failPipelineRun(runId, e);
        throw e;
    }

    console.log(JSON.stringify({ runId, dryRun, processed, errors }, null, 2));
}

main()
    .catch((e) => { console.error(e); process.exit(1); })
    .finally(() => prisma.$disconnect());
