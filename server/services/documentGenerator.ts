import { DocumentRecord } from "@prisma/client";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export interface DraftDocumentOptions {
    projectId: string;
    organisationId: string;
    requirementData: any; // Result from the DB/RAG
    userId: string;
}

/**
 * Creates a drafted application document (Anmälan) with the "UTKAST" watermark
 * For MVP, we will simulate the file generation by creating a DocumentRecord
 * with a specific status and watermark metadata, instead of actually generating a full PDF.
 */
export async function generateApplicationDraft(options: DraftDocumentOptions): Promise<DocumentRecord> {

    // 1. Compile the text based on the requirement data.
    // In a full implementation, this would use a PDF/Word library (like pdfkit or docx)
    // To generate the actual binary file and stamp it.

    const draftName = `Anmalan_Utkast_${new Date().getTime()}.pdf`;

    // Create the DB record to represent this generated draft
    const documentRecord = await prisma.documentRecord.create({
        data: {
            projectId: options.projectId,
            organisationId: options.organisationId,
            entryId: `DRAFT-${new Date().getTime()}`,
            subject: "Miljöbeslut.se - Anmalan om mellanlagring - UTKAST",
            originalName: draftName,
            diskName: draftName,
            absolutePath: `/virtual/drafts/${draftName}`,
            status: "METADATA_ONLY",
            legalStatus: "DRAFT_UNVERIFIED", // The "UTKAST" flag
            manifestMeta: {
                watermark: "UTKAST - Kräver manuell verifiering",
                generatedByAI: true,
                requiresSignature: true,
                requirementContext: options.requirementData
            }
        }
    });

    // In the MVP, returning the record implies creation. 
    // The frontend will see the status "DRAFT_UNVERIFIED" and show the signature prompt.
    return documentRecord;
}
