import { prisma } from '../server/db/prisma';
import fs from 'fs';

async function main() {
    const sqlFiles = [
        'scripts/enable_postgis.sql',
        'scripts/db/create_property_unit_pipeline.sql'
    ];

    for (const file of sqlFiles) {
        console.log(`Executing ${file}...`);
        const sql = fs.readFileSync(file, 'utf8');
        const statements = sql
            .split(';')
            .map(s => s.trim())
            .filter(s => s.length > 0 && !s.startsWith('--'));

        for (const statement of statements) {
            try {
                await (prisma as any).$executeRawUnsafe(statement);
            } catch (e) {
                console.error(`Error in statement: ${statement.slice(0, 50)}...`, e);
            }
        }
        console.log(`Finished: ${file}`);
    }
}

main().finally(() => (prisma as any).$disconnect());
