import { DocumentRecord } from '@prisma/client';
import { prisma } from '../db/prisma';
import * as docx from 'docx';
import * as fs from 'fs';
import * as path from 'path';

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
  const outputDir = path.join(process.cwd(), 'storage', 'drafts');
  fs.mkdirSync(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, draftName);

  // Build document sections from requirementData
  const requirements: any[] = Array.isArray(options.requirementData?.requirements)
    ? options.requirementData.requirements
    : [];

  const doc = new docx.Document({
    sections: [
      {
        properties: {},
        children: [
          // Title
          new docx.Paragraph({
            text: 'UTKAST – Anmälan om miljöfarlig verksamhet / mellanlagring',
            heading: docx.HeadingLevel.TITLE,
            alignment: docx.AlignmentType.CENTER,
            border: {
              bottom: { style: docx.BorderStyle.SINGLE, size: 6, color: 'FF0000' },
            },
          }),
          new docx.Paragraph({
            children: [
              new docx.TextRun({
                text: '⚠ UTKAST – Kräver manuell verifiering och signatur',
                bold: true,
                color: 'FF0000',
                size: 24,
              }),
            ],
            alignment: docx.AlignmentType.CENTER,
          }),
          new docx.Paragraph({ text: '' }),

          // Metadata
          new docx.Paragraph({
            text: 'Ärendeinformation',
            heading: docx.HeadingLevel.HEADING_1,
          }),
          new docx.Table({
            width: { size: 100, type: docx.WidthType.PERCENTAGE },
            rows: [
              new docx.TableRow({
                children: [
                  new docx.TableCell({
                    children: [
                      new docx.Paragraph({
                        children: [new docx.TextRun({ text: 'Projekt-ID', bold: true })],
                      }),
                    ],
                    shading: { type: docx.ShadingType.SOLID, color: 'F0F0F0' },
                  }),
                  new docx.TableCell({
                    children: [new docx.Paragraph(options.projectId)],
                  }),
                ],
              }),
              new docx.TableRow({
                children: [
                  new docx.TableCell({
                    children: [
                      new docx.Paragraph({
                        children: [new docx.TextRun({ text: 'Organisation-ID', bold: true })],
                      }),
                    ],
                    shading: { type: docx.ShadingType.SOLID, color: 'F0F0F0' },
                  }),
                  new docx.TableCell({
                    children: [new docx.Paragraph(options.organisationId)],
                  }),
                ],
              }),
              new docx.TableRow({
                children: [
                  new docx.TableCell({
                    children: [
                      new docx.Paragraph({ children: [new docx.TextRun({ text: 'Skapad av', bold: true })] }),
                    ],
                    shading: { type: docx.ShadingType.SOLID, color: 'F0F0F0' },
                  }),
                  new docx.TableCell({
                    children: [new docx.Paragraph(options.userId)],
                  }),
                ],
              }),
              new docx.TableRow({
                children: [
                  new docx.TableCell({
                    children: [
                      new docx.Paragraph({ children: [new docx.TextRun({ text: 'Datum', bold: true })] }),
                    ],
                    shading: { type: docx.ShadingType.SOLID, color: 'F0F0F0' },
                  }),
                  new docx.TableCell({
                    children: [new docx.Paragraph(new Date().toLocaleDateString('sv-SE'))],
                  }),
                ],
              }),
            ],
          }),
          new docx.Paragraph({ text: '' }),

          // Requirements section
          ...(requirements.length > 0
            ? [
                new docx.Paragraph({
                  text: 'Tillämpliga krav och villkor',
                  heading: docx.HeadingLevel.HEADING_1,
                }),
                ...requirements.flatMap((req: any, i: number) => [
                  new docx.Paragraph({
                    text: `${i + 1}. ${req.title ?? req.description ?? 'Krav'}`,
                    heading: docx.HeadingLevel.HEADING_2,
                  }),
                  new docx.Paragraph({
                    text: req.description ?? req.text ?? '',
                  }),
                  ...(req.legalReference
                    ? [
                        new docx.Paragraph({
                          children: [
                            new docx.TextRun({ text: 'Rättslig grund: ', bold: true }),
                            new docx.TextRun(req.legalReference),
                          ],
                        }),
                      ]
                    : []),
                  new docx.Paragraph({ text: '' }),
                ]),
              ]
            : [
                new docx.Paragraph({
                  children: [
                    new docx.TextRun({
                      text: 'Inga specifika krav identifierade av systemet. Komplettera manuellt.',
                      italics: true,
                      color: '888888',
                    }),
                  ],
                }),
              ]),

          // Signature section
          new docx.Paragraph({ text: '' }),
          new docx.Paragraph({
            text: 'Underskrift',
            heading: docx.HeadingLevel.HEADING_1,
          }),
          new docx.Paragraph({
            children: [
              new docx.TextRun({
                text: 'Detta dokument är ett maskinellt genererat utkast och måste verifieras och signeras av behörig handläggare innan det kan användas som officiell anmälan.',
                italics: true,
              }),
            ],
          }),
          new docx.Paragraph({ text: '' }),
          new docx.Paragraph({ text: 'Handläggarens underskrift: _______________________________' }),
          new docx.Paragraph({ text: '' }),
          new docx.Paragraph({ text: 'Datum: _______________________________' }),
        ],
      },
    ],
  });

  const buffer = await docx.Packer.toBuffer(doc);
  fs.writeFileSync(outputPath, buffer);

  const documentRecord = await prisma.documentRecord.create({
    data: {
      projectId: options.projectId,
      organisationId: options.organisationId,
      entryId: `DRAFT-${timestamp}`,
      subject: 'Miljobeslut.se - Anmalan om mellanlagring - UTKAST',
      originalName: draftName,
      diskName: draftName,
      absolutePath: outputPath,
      fileSize: BigInt(buffer.length),
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      status: 'TEXT_EXTRACTED',
      legalStatus: 'DRAFT_UNVERIFIED',
      manifestMeta: {
        watermark: 'UTKAST - Kräver manuell verifiering',
        generatedByAI: true,
        requiresSignature: true,
        requirementContext: options.requirementData,
      },
    },
  });

  return documentRecord;
}
