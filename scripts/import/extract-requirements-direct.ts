import { PrismaClient } from '@prisma/client';
import crypto from 'node:crypto';
const prisma = new PrismaClient();

const REQUIREMENT_KEYWORDS = [
  'ska', 'skall', 'måste', 'får inte', 'krävs', 'bör', 'krav', 'villkor',
];

function shortHash(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex').slice(0, 24);
}

function normalizeText(raw: string): string {
  return String(raw || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

function splitSegments(text: string): string[] {
  const lines = normalizeText(text)
    .split('\n')
    .flatMap((line) => line.split(/(?<=[.!?])\s+/))
    .map((line) => line.trim())
    .filter((line) => line.length >= 25 && line.length <= 900);
  return Array.from(new Set(lines));
}

function isRequirementCandidate(segment: string): boolean {
  const lower = segment.toLowerCase();
  return REQUIREMENT_KEYWORDS.some((keyword) => lower.includes(keyword));
}

function inferCategory(segment: string): string {
  const lower = segment.toLowerCase();
  if (lower.includes('dagvatten') || lower.includes('lakvatten') || lower.includes('oljeavskiljare')) return 'DagvattenLakvatten';
  if (lower.includes('platta') || lower.includes('tät') || lower.includes('infiltration')) return 'Ytkonstruktion';
  if (lower.includes('lagringstid') || lower.includes('ton') || lower.includes('mängd')) return 'LagringVolymTid';
  if (lower.includes('provtag') || lower.includes('analys') || lower.includes('kontrollprogram')) return 'KontrollProvtagning';
  if (lower.includes('buller') || lower.includes('damm') || lower.includes('lukt')) return 'Störningsskydd';
  return 'Övrigt';
}

async function main() {
    console.log('--- STARTING DIRECT REQUIREMENT EXTRACTION ---');

    const docs = await prisma.documentRecord.findMany({
        where: {
            status: { in: ['TEXT_EXTRACTED', 'CHUNKED', 'EMBEDDED'] },
            requirementCase: { is: null } // Only docs not yet processed for requirements
        },
        include: {
            content: true
        },
        take: 500
    });

    console.log(`Found ${docs.length} documents to process.`);

    let totalRequirements = 0;

    for (const doc of docs) {
        if (!doc.content?.searchText) continue;

        console.log(`Processing [${doc.id}] ${doc.originalName}...`);

        // 1. Create Case
        const caseRow = await prisma.requirementCase.upsert({
            where: { documentId: doc.id },
            create: {
                caseKey: `CASE-${doc.id}`,
                projectId: doc.projectId,
                documentId: doc.id,
                organisationId: doc.organisationId,
                municipality: doc.municipality,
                authorityType: 'Kommun',
                authorityName: doc.municipality,
                documentType: doc.decisionType,
                sourceFile: doc.originalName,
                sourceSubject: doc.subject,
            },
            update: {
                municipality: doc.municipality,
                authorityName: doc.municipality,
            }
        });

        // 2. Extract Segments
        const segments = splitSegments(doc.content.searchText).filter(isRequirementCandidate);
        
        for (const segment of segments) {
            const reqCode = `REQ-${shortHash(`${doc.id}|${segment}`)}`;
            const reqHash = shortHash(`${caseRow.id}|${segment}`);
            const category = inferCategory(segment);
            
            const createdReq = await prisma.requirementRecord.upsert({
                where: { requirementCode: reqCode },
                update: { requirementHash: reqHash },
                create: {
                    requirementCode: reqCode,
                    requirementHash: reqHash,
                    caseId: caseRow.id,
                    documentId: doc.id,
                    projectId: doc.projectId,
                    sourceType: 'AUTO_PDF',
                    category,
                    subcategory: 'Generell',
                    requirementTextQuote: segment,
                    interpretedRequirement: segment,
                    level: 'MANDATORY',
                    codingConfidence: 'MEDIUM'
                },
                select: { id: true }
            });

            // 3. Create Citation
            const citCode = `CIT-${shortHash(`${reqCode}|1`)}`;
            await prisma.requirementCitation.upsert({
                where: { citationCode: citCode },
                update: { quoteText: segment },
                create: {
                    citationCode: citCode,
                    requirementId: createdReq.id,
                    caseId: caseRow.id,
                    documentId: doc.id,
                    quoteText: segment,
                    extractor: 'direct_extraction_v1'
                }
            });

            totalRequirements++;
        }
        
        console.log(`  Done. Found ${segments.length} requirements.`);
    }

    console.log(`--- EXTRACTION COMPLETE. Total new requirements: ${totalRequirements} ---`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
