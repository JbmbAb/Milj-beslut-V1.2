import PDFDocument from 'pdfkit';
import { applyUnicodeFont } from './pdfUnicodeFont';
import {
  buildReportTraceability,
  formatTraceabilityFooter,
  type ReportTraceabilityInput,
} from './reportTraceability';

function sanitizeForPdf(text: string): string {
  return String(text || '').replace(/\u0000/g, '');
}

/**
 * Enkel A4-PDF med rubrik och brödtext (wrappar stycken).
 * Svensk Unicode-font + juridisk spårbarhetsfot.
 */
export async function buildSimplePdfBuffer(input: {
  title: string;
  subtitle?: string;
  body: string;
  traceability?: ReportTraceabilityInput;
}): Promise<Buffer> {
  const meta = buildReportTraceability(input.traceability);
  const traceFooter = formatTraceabilityFooter(meta);

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      margin: 50,
      size: 'A4',
      bufferPages: true,
      info: {
        Title: sanitizeForPdf(input.title),
        Author: 'Miljöbeslut.se',
        Keywords: traceFooter,
        Subject: `Spårbarhet: ${traceFooter}`,
      },
    });
    applyUnicodeFont(doc);

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
      if (doc.y > doc.page.height - 100) {
        doc.addPage();
      }
      doc.text(line || ' ', { align: 'left', paragraphGap: 4 });
      doc.moveDown(0.2);
    }
    doc.moveDown(0.5);
    doc
      .fontSize(8)
      .fillColor('#666666')
      .text(
        'Genererad av Miljöbeslut.se (beslutsstöd). Juridisk granskning krävs före myndighetsinlämning.',
        { align: 'left' },
      );

    const pages = doc.bufferedPageRange();
    for (let i = 0; i < pages.count; i++) {
      doc.switchToPage(i);
      doc.fontSize(6).fillColor('#888').text(traceFooter, 50, doc.page.height - 40, {
        align: 'center',
        width: doc.page.width - 100,
      });
    }

    doc.end();
  });
}

export async function buildJsonPdfBuffer(
  title: string,
  subtitle: string | undefined,
  data: unknown,
  traceability?: ReportTraceabilityInput,
): Promise<Buffer> {
  const body = JSON.stringify(data, null, 2);
  return buildSimplePdfBuffer({
    title,
    subtitle,
    body,
    traceability,
  });
}
