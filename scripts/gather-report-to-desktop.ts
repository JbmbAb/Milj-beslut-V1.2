import fs from 'node:fs';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const DEST_DIR = 'C:/Users/jimmy/Desktop/Mellanlagringsytor_Rapport';
const DOCS_SUBDIR = path.join(DEST_DIR, 'Underlag_Dokument');

async function main() {
    console.log('--- FINAL GATHERING REPORT DOCUMENTS FOR DESKTOP (V3) ---');

    if (!fs.existsSync(DEST_DIR)) fs.mkdirSync(DEST_DIR, { recursive: true });
    if (!fs.existsSync(DOCS_SUBDIR)) fs.mkdirSync(DOCS_SUBDIR, { recursive: true });

    // 1. Copy PM
    const sourcePm = 'C:/Users/jimmy/.gemini/antigravity/brain/8dbe0fb3-36a3-43c3-89c9-97cec472ac84/pm_mellanlagringsytor.md';
    if (fs.existsSync(sourcePm)) {
        fs.copyFileSync(sourcePm, path.join(DEST_DIR, 'PM_Mellanlagringsytor.md'));
    }

    const munis = ['Mariestad', 'Lidköping', 'Gullspång', 'Töreboda', 'Skövde', 'Götene'];
    let totalCopied = 0;

    for (const muniName of munis) {
        console.log(`Searching for ${muniName}...`);
        
        // Search DocumentRecord
        const docs = await prisma.documentRecord.findMany({
            where: {
                absolutePath: { contains: muniName, mode: 'insensitive' }
            },
            take: 15
        });

        // Search OutlookAttachment (attachments)
        const attachments = await prisma.outlookAttachment.findMany({
            where: {
                storedPath: { contains: muniName, mode: 'insensitive' }
            },
            take: 15
        });

        const allDocs = [
            ...docs.map(d => ({ path: d.absolutePath, name: d.originalName, id: d.id })),
            ...attachments.map(a => ({ path: a.storedPath, name: a.filename, id: a.attachmentHash }))
        ];

        for (const doc of allDocs) {
            if (!doc.path || !fs.existsSync(doc.path)) continue;
            try {
                const safeName = doc.name.replace(/[/\\?%*:|"<>]/g, '-');
                const destFilename = `${muniName}_${doc.id.slice(-4)}_${safeName}`;
                fs.copyFileSync(doc.path, path.join(DOCS_SUBDIR, destFilename));
                totalCopied++;
            } catch (err) {
                // ignore
            }
        }
    }

    console.log(`--- GATHERING COMPLETE. Total Copied: ${totalCopied} ---`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
