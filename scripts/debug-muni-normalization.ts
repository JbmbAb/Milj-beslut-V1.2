import { prisma } from '../server/db/prisma';
import { normalizeMunicipality } from './backfill/_shared';

async function main() {
    const rawMunis = await prisma.documentRecord.groupBy({
        by: ['municipality'],
        _count: { id: true },
        where: { municipality: { not: null } }
    });

    const missing = rawMunis
        .filter(r => !normalizeMunicipality(r.municipality))
        .map(r => r.municipality);

    console.log('Raw municipalities that failed to normalize:');
    console.log(JSON.stringify(missing, null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
