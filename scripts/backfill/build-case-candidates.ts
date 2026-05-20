/**
 * Steg 4 – Bygg case-kandidater + caseConfidence
 * caseConfidence-formel (låst):
 *   diarieMatch: 0.45, diarieUnique bonus: +0.15, entryId: 0.25,
 *   subject+datum ±7d: 0.20, municipality consistency: 0.10  → clamp [0,1]
 *
 * Kör: npx tsx scripts/backfill/build-case-candidates.ts [--dry-run]
 */
import crypto from 'node:crypto';
import { prisma } from '../../server/db/prisma';
import { flag, startPipelineRun, finishPipelineRun, failPipelineRun } from './_shared';

type DocRow = {
    id: string;
    entryId: string;
    subject: string;
    receivedTime: Date | null;
    municipality: string | null;
    municipalityNormalized: string | null;
    legalStatus: string | null;
    decisionType: string | null;
    activityCode: string | null;
    wasteType: string | null;
};

function stableKey(parts: string[]): string {
    return crypto.createHash('sha256').update(parts.join('|'), 'utf8').digest('hex').slice(0, 16);
}

function dayStr(d: Date | null): string {
    if (!d) return 'nodate';
    return d.toISOString().slice(0, 10);
}

function withinDays(a: Date | null, b: Date | null, days: number): boolean {
    if (!a || !b) return false;
    return Math.abs(a.getTime() - b.getTime()) <= days * 86_400_000;
}

function computeConfidence(opts: {
    hasDiarie: boolean;
    diarieIsUnique: boolean;
    hasEntryGroup: boolean;
    hasSubjectDate: boolean;
    municipalityConsistent: boolean;
}): { score: number; reasoning: Record<string, number> } {
    const reasoning: Record<string, number> = {};
    let score = 0;
    if (opts.hasDiarie) { reasoning.diarieMatch = 0.45; score += 0.45; }
    if (opts.diarieIsUnique) { reasoning.diarieUnique = 0.15; score += 0.15; }
    if (opts.hasEntryGroup) { reasoning.entryIdGroup = 0.25; score += 0.25; }
    if (opts.hasSubjectDate) { reasoning.subjectDate = 0.20; score += 0.20; }
    if (opts.municipalityConsistent) { reasoning.municipalityConsistency = 0.10; score += 0.10; }
    return { score: Math.min(1, score), reasoning };
}

async function main() {
    const dryRun = flag('dry-run');
    const runId = await startPipelineRun({ runType: 'BUILD_CASES', stageName: 'build-case-candidates', config: { dryRun } });
    let processed = 0;
    let errors = 0;

    try {
        const docs = await prisma.documentRecord.findMany({
            select: {
                id: true, entryId: true, subject: true, receivedTime: true,
                municipality: true, municipalityNormalized: true,
                legalStatus: true, decisionType: true, activityCode: true, wasteType: true,
            },
        }) as DocRow[];

        // Count diarie occurrences for uniqueness check
        const diarieCount = new Map<string, number>();
        for (const d of docs) {
            if (d.legalStatus) diarieCount.set(d.legalStatus, (diarieCount.get(d.legalStatus) ?? 0) + 1);
        }

        // Group by diarie first
        const byDiarie = new Map<string, DocRow[]>();
        const noDiarie: DocRow[] = [];
        for (const d of docs) {
            if (d.legalStatus) {
                const arr = byDiarie.get(d.legalStatus) ?? [];
                arr.push(d);
                byDiarie.set(d.legalStatus, arr);
            } else {
                noDiarie.push(d);
            }
        }

        // Group remaining by entryId
        const byEntry = new Map<string, DocRow[]>();
        const noEntry: DocRow[] = [];
        for (const d of noDiarie) {
            if (d.entryId) {
                const arr = byEntry.get(d.entryId) ?? [];
                arr.push(d);
                byEntry.set(d.entryId, arr);
            } else {
                noEntry.push(d);
            }
        }

        // Group remaining by normalized subject + date window
        const subjectGroups = new Map<string, DocRow[]>();
        for (const d of noEntry) {
            const norm = d.subject.toLowerCase().replace(/\s+/g, ' ').trim();
            const day = dayStr(d.receivedTime);
            // Attempt to merge within ±7 day window
            let matched = false;
            for (const [, group] of subjectGroups.entries()) {
                const rep = group[0];
                const repNorm = rep.subject.toLowerCase().replace(/\s+/g, ' ').trim();
                if (repNorm === norm && withinDays(rep.receivedTime, d.receivedTime, 7)) {
                    group.push(d);
                    matched = true;
                    break;
                }
            }
            if (!matched) {
                subjectGroups.set(stableKey([norm, day]), [d]);
            }
        }

        // Assemble all candidate groups
        const allGroups: { key: string; docs: DocRow[]; groupType: string }[] = [];
        for (const [diarie, grp] of byDiarie.entries()) {
            allGroups.push({ key: `diarie:${stableKey([diarie])}`, docs: grp, groupType: 'diarie' });
        }
        for (const [entryId, grp] of byEntry.entries()) {
            allGroups.push({ key: `entry:${stableKey([entryId])}`, docs: grp, groupType: 'entry' });
        }
        for (const [k, grp] of subjectGroups.entries()) {
            allGroups.push({ key: `subj:${k}`, docs: grp, groupType: 'subject_date' });
        }

        // Upsert each candidate
        for (const group of allGroups) {
            try {
                const rep = group.docs[0];
                const diarie = rep.legalStatus ?? null;
                const diarieUnique = diarie ? (diarieCount.get(diarie) ?? 0) === group.docs.length : false;
                const allMunis = group.docs.map((d) => d.municipalityNormalized ?? d.municipality).filter(Boolean);
                const uniqueMunis = new Set(allMunis);
                const muniConsistent = allMunis.length > 0 && uniqueMunis.size === 1;
                const municipality = muniConsistent ? allMunis[0] : null;

                const { score, reasoning } = computeConfidence({
                    hasDiarie: !!diarie,
                    diarieIsUnique: diarieUnique,
                    hasEntryGroup: group.groupType === 'entry',
                    hasSubjectDate: group.groupType === 'subject_date',
                    municipalityConsistent: muniConsistent,
                });

                const docIds = group.docs.map((d) => d.id);
                const entryIds = [...new Set(group.docs.map((d) => d.entryId).filter(Boolean))];

                if (!dryRun) {
                    await prisma.$executeRawUnsafe(
                        `INSERT INTO "CaseCandidate"
               ("id", "caseKey", "documentIds", "entryIds", "municipality", "diarie",
                "decisionType", "activityCode", "wasteType", "caseConfidence", "reasoning", "updatedAt")
             VALUES
               (gen_random_uuid()::text, $1, $2::jsonb, $3::jsonb, $4, $5, $6, $7, $8, $9, $10::jsonb, NOW())
             ON CONFLICT ("caseKey") DO UPDATE SET
               "documentIds" = $2::jsonb,
               "entryIds"    = $3::jsonb,
               "municipality" = COALESCE($4, "CaseCandidate"."municipality"),
               "caseConfidence" = $9,
               "reasoning"   = $10::jsonb,
               "updatedAt"   = NOW()
             WHERE "CaseCandidate"."status" != 'MATERIALIZED';`,
                        group.key,
                        JSON.stringify(docIds),
                        JSON.stringify(entryIds),
                        municipality ?? null,
                        diarie ?? null,
                        rep.decisionType ?? null,
                        rep.activityCode ?? null,
                        rep.wasteType ?? null,
                        score,
                        JSON.stringify({ groupType: group.groupType, ...reasoning }),
                    );
                }

                processed++;
            } catch (e) {
                console.error(`Error on group ${group.key}:`, e);
                errors++;
            }
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
