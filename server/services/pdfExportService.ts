import PDFDocument from 'pdfkit';

function sanitizeForPdf(text: string): string {
  return String(text || '').replace(/\u0000/g, '');
}

/**
 * Enkel A4-PDF med rubrik och brödtext (wrappar stycken).
 * Används för utkast/rapport-export där layout inte kräver tabeller i PDF.
 */
export async function buildSimplePdfBuffer(input: {
  title: string;
  subtitle?: string;
  body: string;
}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.fontSize(16).text(sanitizeForPdf(input.title), { underline: true });
    doc.moveDown(0.5);
    if (input.subtitle) {
      doc.fontSize(9).fillColor('#444444').text(sanitizeForPdf(input.subtitle));
      doc.fillColor('#000000');
      doc.moveDown(0.5);
    }
    doc.fontSize(10);
    const body = sanitizeForPdf(input.body);
    for (const para of body.split(/\n{2,}/)) {
      const line = para.replace(/\n/g, ' ').trim();
      doc.text(line || ' ', { align: 'left', paragraphGap: 4 });
      doc.moveDown(0.2);
    }
    doc.moveDown(0.5);
    doc
      .fontSize(8)
      .fillColor('#666666')
      .text(
        'Genererad av Miljobeslut.se (beslutsstöd). Juridisk granskning krävs före myndighetsinlämning.',
        { align: 'left' },
      );
    doc.end();
  });
}

export async function buildJsonPdfBuffer(
  title: string,
  subtitle: string | undefined,
  data: unknown,
): Promise<Buffer> {
  const body = JSON.stringify(data, null, 2);
  return buildSimplePdfBuffer({
    title,
    subtitle,
    body,
  });
}
