import { prisma } from '../server/db/prisma';
import { normalizeMunicipality } from './backfill/_shared';

async function main() {
    const docs = await prisma.documentRecord.findMany({
        where: { municipality: { not: null }, municipalityNormalized: null },
        select: { municipality: true }
    });

    const totals = new Map<string, number>();
    for (const d of docs) {
        if (!d.municipality) continue;
        totals.set(d.municipality, (totals.get(d.municipality) || 0) + 1);
    }

    console.log(`Docs with raw but no normalized muni: ${docs.length}`);
    const sorted = Array.from(totals.entries()).sort((a, b) => b[1] - a[1]);
    console.log('Top raw munis missing normalization:', sorted.slice(0, 20));

    // Test one
    if (docs.length > 0) {
        const test = docs[0].municipality;
        if (test) {
            const cleaned = test.toLowerCase()
                .replace(/\bkommun\b/g, '')
                .replace(/\bmiljöförvaltningen\b/g, '')
                .replace(/\bmiljökontoret\b/g, '')
                .replace(/\bmiljönämnden\b/g, '')
                .replace(/\bstaden\b/g, '')
                .replace(/\bstad\b/g, '')
                .replace(/[^a-zåäö\s-]/g, '')
                .replace(/\s+/g, ' ')
                .trim();
            console.log(`Debug: test='${test}', cleaned='${cleaned}', charCodes=[${Array.from(cleaned).map(c => c.charCodeAt(0)).join(',')}]`);
            console.log(`Testing normalization of '${test}':`, normalizeMunicipality(test));
        }
    }
}

main().catch(console.error).finally(() => prisma.$disconnect());
