import { prisma } from '../../server/db/prisma';
import fs from 'node:fs';

function parseSemicolonCsv(content: string): Array<Record<string, string>> {
    const lines = content
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
    if (lines.length === 0) return [];

    const headers = lines[0].split(';').map((header) => header.trim());
    return lines.slice(1).map((line) => {
        const values = line.split(';');
        return headers.reduce<Record<string, string>>((row, header, index) => {
            row[header] = String(values[index] ?? '').trim();
            return row;
        }, {});
    });
}

async function main() {
    const triagePath = 'C:\\Users\\jimmy\\Desktop\\OutlookExport\\outlook_backlog_operativ_sortering.csv';
    const content = fs.readFileSync(triagePath, 'utf8');
    const rows = parseSemicolonCsv(content);

    const dbDocIds = (await prisma.documentRecord.findMany({ select: { id: true } })).map(d => d.id);
    const dbSet = new Set(dbDocIds);

    console.log(`Total rows in triage: ${rows.length}`);
    console.log(`Unique doc IDs in database: ${dbSet.size}`);

    let _missedWithAttachments = 0;
    let _missedInP2P5 = 0;

    const buckets: Record<string, { total: number, missed: number, missedWithAttachments: number }> = {};

    for (const row of rows) {
        const entryId = row.EntryID;
        const bucket = row.OperationalBucket;
        const hasAttachments = row.HasAttachments === 'True';

        if (!buckets[bucket]) buckets[bucket] = { total: 0, missed: 0, missedWithAttachments: 0 };
        buckets[bucket].total++;

        if (!dbSet.has(entryId)) {
            buckets[bucket].missed++;
            if (hasAttachments) {
                buckets[bucket].missedWithAttachments++;
                _missedWithAttachments++;
            }
            _missedInP2P5++;
        }
    }

    console.log("\nCoverage Analysis:");
    console.table(buckets);
}

main().catch(console.error).finally(() => prisma.$disconnect());
