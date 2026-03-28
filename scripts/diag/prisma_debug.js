import { PrismaClient } from '@prisma/client';
import fs from 'fs';

console.log('--- PRISMA DEBUGGER ---');
console.log('CWD:', process.cwd());

const env = fs.readFileSync('.env', 'utf-8');
console.log('.env DATABASE_URL exists:', env.includes('DATABASE_URL'));

const prisma = new PrismaClient({
    datasources: {
        db: {
            url: process.env.DATABASE_URL
        }
    }
});

async function check() {
    try {
        console.log('Ansluter till Prisma...');
        await prisma.$connect();
        console.log('✅ PRISMA_CONNECT_SUCCESS');
        const count = await prisma.user.count();
        console.log('User count:', count);
    } catch (e) {
        console.error('❌ PRISMA_FAIL:', e.message);
        console.error('Stack:', e.stack);
    } finally {
        await prisma.$disconnect();
    }
}

check();
