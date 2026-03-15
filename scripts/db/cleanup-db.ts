
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    const indexes = [
        'CaseCandidate_diarie_idx',
        'CaseCandidate_status_caseConfidence_idx',
        'MetadataReviewQueue_documentId_idx',
        'MetadataReviewQueue_status_queueType_createdAt_idx',
        'DocumentMetadataEvidence_documentId_fieldName_createdAt_idx',
        'RequirementRecord_requirementHash_key',
        'DocumentRecord_legalStatus_idx',
        'DocumentRecord_municipality_fields_idx',
        'DocumentRecord_metadataReviewStatus_updatedAt_idx'
    ];

    for (const idx of indexes) {
        try {
            await prisma.$executeRawUnsafe(`DROP INDEX IF EXISTS "${idx}"`);
            console.log(`Dropped index ${idx}`);
        } catch (e) {
            console.warn(`Could not drop index ${idx}:`, e);
        }
    }

    // Also drop tables created manually that Prisma wants to manage
    const tables = [
        'extracted_requirements',
        'attachment_occurrences',
        'attachments',
        'email_messages',
        'ingest_runs',
        'CaseCandidate',
        'MetadataReviewQueue',
        'DocumentMetadataEvidence'
    ];

    for (const table of tables) {
        try {
            // We use CASCADE to handle foreign keys
            await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS "${table}" CASCADE`);
            console.log(`Dropped table ${table}`);
        } catch (e) {
            console.warn(`Could not drop table ${table}:`, e);
        }
    }
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
