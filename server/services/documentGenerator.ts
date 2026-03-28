import { DocumentRecord } from "@prisma/client";
import { prisma } from "../db/prisma";
import {
    Document,
    Packer,
    Paragraph,
    TextRun,
    HeadingLevel,
    AlignmentType,
    BorderStyle,
    Table,
    TableRow,
    TableCell,
    WidthType,
    ShadingType,
} from "docx";
import * as fs from "fs";
import * as path from "path";

export interface DraftDocumentOptions {
    projectId: string;
    organisationId: string;
    requirementData: any; // Result from the DB/RAG
    userId: string;
}

/**
 * Creates a drafted application document (Anmälan) with the "UTKAST" watermark
 * using the docx library to generate a real .docx file.
 */
export async function generateApplicationDraft(options: DraftDocumentOptions): Promise<DocumentRecord> {
    const timestamp = new Date().getTime();
    const draftName = `Anmalan_Utkast_${timestamp}.docx`;
    const outputDir = path.join(process.cwd(), "storage", "drafts");
    fs.mkdirSync(outputDir, { recursive: true });
    const outputPath = path.join(outputDir, draftName);

    // Build document sections from requirementData
    const requirements: any[] = Array.isArray(options.requirementData?.requirements)
        ? options.requirementData.requirements
        : [];

    const doc = new Document({
        sections: [
            {
                properties: {},
                children: [
                    // Title
                    new Paragraph({
                        text: "UTKAST – Anmälan om miljöfarlig verksamhet / mellanlagring",
                        heading: HeadingLevel.TITLE,
                        alignment: AlignmentType.CENTER,
                        border: {
                            bottom: { style: BorderStyle.SINGLE, size: 6, color: "FF0000" },
                        },
                    }),
                    new Paragraph({
                        children: [
                            new TextRun({
                                text: "⚠ UTKAST – Kräver manuell verifiering och signatur",
                                bold: true,
                                color: "FF0000",
                                size: 24,
                            }),
                        ],
                        alignment: AlignmentType.CENTER,
                    }),
                    new Paragraph({ text: "" }),

                    // Metadata
                    new Paragraph({
                        text: "Ärendeinformation",
                        heading: HeadingLevel.HEADING_1,
                    }),
                    new Table({
                        width: { size: 100, type: WidthType.PERCENTAGE },
                        rows: [
                            new TableRow({
                                children: [
                                    new TableCell({
                                        children: [new Paragraph({ children: [new TextRun({ text: "Projekt-ID", bold: true })] })],
                                        shading: { type: ShadingType.SOLID, color: "F0F0F0" },
                                    }),
                                    new TableCell({
                                        children: [new Paragraph(options.projectId)],
                                    }),
                                ],
                            }),
                            new TableRow({
                                children: [
                                    new TableCell({
                                        children: [new Paragraph({ children: [new TextRun({ text: "Organisation-ID", bold: true })] })],
                                        shading: { type: ShadingType.SOLID, color: "F0F0F0" },
                                    }),
                                    new TableCell({
                                        children: [new Paragraph(options.organisationId)],
                                    }),
                                ],
                            }),
                            new TableRow({
                                children: [
                                    new TableCell({
                                        children: [new Paragraph({ children: [new TextRun({ text: "Skapad av", bold: true })] })],
                                        shading: { type: ShadingType.SOLID, color: "F0F0F0" },
                                    }),
                                    new TableCell({
                                        children: [new Paragraph(options.userId)],
                                    }),
                                ],
                            }),
                            new TableRow({
                                children: [
                                    new TableCell({
                                        children: [new Paragraph({ children: [new TextRun({ text: "Datum", bold: true })] })],
                                        shading: { type: ShadingType.SOLID, color: "F0F0F0" },
                                    }),
                                    new TableCell({
                                        children: [new Paragraph(new Date().toLocaleDateString("sv-SE"))],
                                    }),
                                ],
                            }),
                        ],
                    }),
                    new Paragraph({ text: "" }),

                    // Requirements section
                    ...(requirements.length > 0
                        ? [
                              new Paragraph({
                                  text: "Tillämpliga krav och villkor",
                                  heading: HeadingLevel.HEADING_1,
                              }),
                              ...requirements.flatMap((req: any, i: number) => [
                                  new Paragraph({
                                      text: `${i + 1}. ${req.title ?? req.description ?? "Krav"}`,
                                      heading: HeadingLevel.HEADING_2,
                                  }),
                                  new Paragraph({
                                      text: req.description ?? req.text ?? "",
                                  }),
                                  ...(req.legalReference
                                      ? [
                                            new Paragraph({
                                                children: [
                                                    new TextRun({ text: "Rättslig grund: ", bold: true }),
                                                    new TextRun(req.legalReference),
                                                ],
                                            }),
                                        ]
                                      : []),
                                  new Paragraph({ text: "" }),
                              ]),
                          ]
                        : [
                              new Paragraph({
                                  children: [
                                      new TextRun({
                                          text: "Inga specifika krav identifierade av systemet. Komplettera manuellt.",
                                          italics: true,
                                          color: "888888",
                                      }),
                                  ],
                              }),
                          ]),

                    // Signature section
                    new Paragraph({ text: "" }),
                    new Paragraph({
                        text: "Underskrift",
                        heading: HeadingLevel.HEADING_1,
                    }),
                    new Paragraph({
                        children: [
                            new TextRun({
                                text: "Detta dokument är ett maskinellt genererat utkast och måste verifieras och signeras av behörig handläggare innan det kan användas som officiell anmälan.",
                                italics: true,
                            }),
                        ],
                    }),
                    new Paragraph({ text: "" }),
                    new Paragraph({ text: "Handläggarens underskrift: _______________________________" }),
                    new Paragraph({ text: "" }),
                    new Paragraph({ text: "Datum: _______________________________" }),
                ],
            },
        ],
    });

    const buffer = await Packer.toBuffer(doc);
    fs.writeFileSync(outputPath, buffer);

    const documentRecord = await prisma.documentRecord.create({
        data: {
            projectId: options.projectId,
            organisationId: options.organisationId,
            entryId: `DRAFT-${timestamp}`,
            subject: "Miljöbeslut.se - Anmalan om mellanlagring - UTKAST",
            originalName: draftName,
            diskName: draftName,
            absolutePath: outputPath,
            fileSize: BigInt(buffer.length),
            mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            status: "TEXT_EXTRACTED",
            legalStatus: "DRAFT_UNVERIFIED",
            manifestMeta: {
                watermark: "UTKAST - Kräver manuell verifiering",
                generatedByAI: true,
                requiresSignature: true,
                requirementContext: options.requirementData,
            },
        },
    });

    return documentRecord;
}
