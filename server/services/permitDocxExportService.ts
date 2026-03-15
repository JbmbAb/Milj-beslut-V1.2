import { Document, HeadingLevel, Packer, Paragraph, TextRun } from 'docx';

function normalizeText(input: string): string {
  return String(input || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trim();
}

function linesToParagraphs(text: string): Paragraph[] {
  const lines = normalizeText(text).split('\n');
  const paragraphs: Paragraph[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      paragraphs.push(new Paragraph(''));
      continue;
    }

    // Simple heading heuristics for generated draft sections.
    if (/^\d+\.\s+/.test(line) || /^#+\s+/.test(line)) {
      const headingText = line.replace(/^#+\s*/, '');
      paragraphs.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_2,
          children: [new TextRun({ text: headingText, bold: true })],
        })
      );
      continue;
    }

    paragraphs.push(new Paragraph(line));
  }

  return paragraphs;
}

export async function buildPermitDocxBuffer(input: {
  documentType: string;
  draftText: string;
  generatedAt?: Date;
}): Promise<Buffer> {
  const generatedAt = input.generatedAt ?? new Date();

  const doc = new Document({
    sections: [
      {
        children: [
          new Paragraph({
            heading: HeadingLevel.HEADING_1,
            children: [new TextRun({ text: `Miljöbeslut.se - ${input.documentType}`, bold: true })],
          }),
          new Paragraph(`Genererad: ${generatedAt.toLocaleDateString('sv-SE')} ${generatedAt.toLocaleTimeString('sv-SE')}`),
          new Paragraph('Denna rapport är framtagen av Miljöbeslut.se som beslutsstöd. Extern juridisk granskning krävs före slutlig inlämning till myndighet.'),
          new Paragraph(''),
          ...linesToParagraphs(input.draftText),
        ],
      },
    ],
  });

  return Packer.toBuffer(doc);
}
