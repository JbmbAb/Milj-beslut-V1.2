import fs from 'fs';
import { prisma } from '../server/db/prisma';

function parseCsvLine(line: string, delimiter: ';' | ','): string[] {
    const values: string[] = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i += 1) {
        const ch = line[i];
        const next = line[i + 1];
        if (ch === '"') {
            if (inQuotes && next === '"') {
                current += '"';
                i += 1;
            } else {
                inQuotes = !inQuotes;
            }
            continue;
        }
        if (ch === delimiter && !inQuotes) {
            values.push(current.trim());
            current = '';
            continue;
        }
        current += ch;
    }
    values.push(current.trim());
    return values;
}

async function main() {
    const inputPath = 'C:/Users/jimmy/Desktop/OutlookExport/outlook_backlog_ai_deep_analysis.csv';
    const raw = fs.readFileSync(inputPath, 'utf8');
    const lines = raw.split(/\r?\n/).filter(l => l.trim());
    if (lines.length < 2) return;

    const headers = parseCsvLine(lines[0], ';').map(h => h.replace(/^"|"$/g, ''));
    const entryIdIdx = headers.indexOf('EntryID');
    const muniIdx = headers.indexOf('Municipality');
    const typeIdx = headers.indexOf('DecisionType');
    const activityIdx = headers.indexOf('ActivityCode');

    console.log(`Processing deep analysis... Headers: ${headers.join(', ')}`);

    let updatedCount = 0;
    for (let i = 1; i < lines.length; i++) {
        const cells = parseCsvLine(lines[i], ';').map(c => c.replace(/^"|"$/g, ''));
        const entryId = cells[entryIdIdx];
        const municipality = cells[muniIdx];
        const decisionType = cells[typeIdx];
        const activityCode = cells[activityIdx];

        if (!entryId) continue;

        const docs = await prisma.documentRecord.findMany({
            where: { entryId }
        });

        for (const doc of docs) {
            // Update if current is null or weak
            const needsUpdate = !doc.municipality || doc.municipality === 'Okänd';
            if (needsUpdate && municipality) {
                await prisma.documentRecord.update({
                    where: { id: doc.id },
                    data: {
                        municipality,
                        municipalityRaw: municipality,
                        municipalityNormalized: municipality.toLowerCase().replace(/ kommun$/, '').replace(/s kommun$/, '').trim(),
                        decisionType: decisionType || doc.decisionType,
                        activityCode: activityCode || doc.activityCode
                    }
                });
                updatedCount++;
            }
        }
        if (i % 50 === 0) console.log(`Step ${i}/${lines.length}...`);
    }

    console.log(`Updated ${updatedCount} document records from deep analysis.`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
