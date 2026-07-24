import PDFDocument from 'pdfkit';
import * as fs from 'fs';
import { SewageApplicationRecord } from '../repositories/sewageApplicationRepository';
import { logger } from '../logger';
import { StaticMapGenerator } from '../../src/infrastructure/geo/static-map-generator';
import { applyUnicodeFont } from './pdfUnicodeFont';
import {
  buildReportTraceability,
  formatTraceabilityFooter,
  type ReportTraceabilityInput,
} from './reportTraceability';

export interface SewagePdfOptions {
  traceability?: ReportTraceabilityInput;
}

type PdfDocLike = {
  page: {
    margins: { left: number; right: number; top: number; bottom: number };
    width: number;
    height: number;
  };
  x: number;
  y: number;
  rect: (x: number, y: number, w: number, h: number) => { stroke: (color: string) => unknown };
  fontSize: (n: number) => PdfDocLike;
  fillColor: (c: string) => PdfDocLike;
  text: (t: string, x?: number, y?: number, opts?: object) => unknown;
  addPage: () => unknown;
};

function drawKeyValueTable(doc: PdfDocLike, rows: Array<[string, string]>, startY?: number): void {
  const x = doc.page.margins.left;
  let y = startY ?? doc.y;
  const col1 = 160;
  const col2 = doc.page.width - doc.page.margins.right - x - col1;
  const rowH = 18;

  for (const [key, value] of rows) {
    if (y + rowH > doc.page.height - doc.page.margins.bottom - 60) {
      doc.addPage();
      y = doc.page.margins.top;
    }
    doc.rect(x, y, col1 + col2, rowH).stroke('#cccccc');
    doc.fontSize(9).fillColor('#333').text(key, x + 4, y + 4, { width: col1 - 8 });
    doc.fillColor('#000').text(value, x + col1 + 4, y + 4, { width: col2 - 8 });
    y += rowH;
  }
  doc.y = y + 8;
  doc.x = x;
}

/**
 * SewagePdfService
 * Genererar en professionell PDF-dossier för enskilt avlopp.
 * Inkluderar teknisk sammanfattning, tabeller, sidbrytningar och spårbarhetsfot.
 */
export async function generateSewageDossierPdf(
  application: SewageApplicationRecord,
  outputPath: string,
  options: SewagePdfOptions = {},
): Promise<string> {
  // eslint-disable-next-line no-async-promise-executor
  return new Promise(async (resolve, reject) => {
    try {
      const meta = buildReportTraceability({
        operator: options.traceability?.operator ?? application.applicantName,
        modelId: options.traceability?.modelId,
        datasetVersions: options.traceability?.datasetVersions ?? {
          topo10: 'vatten',
          property: 'core.property_unit',
        },
        correlationId: options.traceability?.correlationId ?? application.referenceNumber,
        gitCommit: options.traceability?.gitCommit,
        dbMigrationVersion: options.traceability?.dbMigrationVersion,
      });
      const traceFooter = formatTraceabilityFooter(meta);

      const doc = new PDFDocument({
        margin: 50,
        size: 'A4',
        bufferPages: true,
        info: {
          Title: `Miljöbeslut Dossier - ${application.propertyDesignation}`,
          Author: 'Miljöbeslut.se',
          Keywords: traceFooter,
          Subject: `Spårbarhet: ${traceFooter}`,
        },
      });

      applyUnicodeFont(doc);

      const stream = fs.createWriteStream(outputPath);
      doc.pipe(stream);

      // --- Header & Branding ---
      doc.fontSize(24).fillColor('#1a5f7a').text('MILJÖBESLUT.SE', { align: 'right' });
      doc.fontSize(10).fillColor('#666').text('Digitalt beslutsstöd för enskilt avlopp', { align: 'right' });
      doc.moveDown(2);

      // --- Title Page ---
      doc.fontSize(28).fillColor('#000').text('Dossier: Enskilt Avlopp', { align: 'left' });
      doc.fontSize(18).fillColor('#444').text(application.propertyDesignation, { align: 'left' });
      doc.moveDown(1);

      doc.fontSize(12).fillColor('#000').text(`Datum: ${new Date().toLocaleDateString('sv-SE')}`);
      doc.text(`Referensnummer: ${application.referenceNumber}`);
      doc.text(`Status: ${application.status}`);
      doc.moveDown(2);

      // --- 1. Fastighetsinformation (table) ---
      doc.fontSize(16).fillColor('#1a5f7a').text('1. Fastighetsinformation', { underline: true });
      doc.moveDown(0.5);
      drawKeyValueTable(doc, [
        ['Sökande', String(application.applicantName ?? '')],
        ['E-post', String(application.applicantEmail ?? '')],
        ['Koordinater', `${application.latitude}, ${application.longitude}`],
        ['Dimensionering', `${application.pe} personekvivalenter (PE)`],
        ['Vald systemtyp', String(application.systemType ?? '')],
        ['Fastighet', String(application.propertyDesignation ?? '')],
      ]);
      doc.moveDown(1);

      // --- 2. Tekniska förutsättningar ---
      doc.fontSize(16).fillColor('#1a5f7a').text('2. Tekniska förutsättningar', { underline: true });
      doc.moveDown(0.5);

      const profile = application.domainSnapshot?.protectionProfile;
      if (profile) {
        drawKeyValueTable(doc, [
          ['Skyddsnivå', profile.protectionLevel === 'HIGH' ? 'HÖG' : 'NORMAL'],
          ['Motivering', String(profile.reason || 'Baserat på GIS-analys')],
          ['Avstånd till närmaste brunn', `${profile.nearestWell?.distance ?? '–'} m`],
          ['Avstånd till ytvatten', `${profile.nearestWaterCourse?.distance ?? '–'} m`],
          ['Avstånd till tomtgräns', `${profile.distanceToPropertyLine ?? '–'} m`],
        ]);
      } else {
        doc.fontSize(11).fillColor('#000').text('Teknisk profil saknas i utkastet.');
      }
      doc.moveDown(1);

      // Explicit page break before drawings
      doc.addPage();
      doc.fontSize(16).fillColor('#1a5f7a').text('3. Tekniskt Underlag & Ritningar', { underline: true });
      doc.moveDown(1);

      const docs = application.domainSnapshot?.generatedDocuments;

      doc.fontSize(12).fillColor('#000').text('3.1 Situationsplan');
      doc.moveDown(0.5);

      const currentX = doc.x;
      const currentY = doc.y;

      try {
        const generator = new StaticMapGenerator();
        const intersectingZones = await generator.drawMapToPdf(
          doc,
          application.propertyDesignation,
          currentX,
          currentY,
          450,
          250,
          25,
        );

        logger.info(`Intersecting zones for ${application.propertyDesignation}: ${intersectingZones.join(', ')}`);

        doc.y = currentY + 265;

        if (intersectingZones.length > 0) {
          doc.fontSize(10).fillColor('#d9534f').text(`Varning - Miljöskyddszoner som berörs:`, currentX, doc.y);
          intersectingZones.forEach((zone) => {
            doc.fontSize(9).fillColor('#333333').text(`• ${zone}`, { indent: 10 });
          });
          doc.moveDown(1);
        } else {
          doc
            .fontSize(10)
            .fillColor('#5cb85c')
            .text('Inga överlappande miljöskyddszoner identifierades i kartanalysen.', currentX, doc.y);
          doc.moveDown(1);
        }
      } catch (mapErr: any) {
        logger.error(`Misslyckades att generera statisk karta i PDF: ${mapErr.message}`);
        doc.rect(currentX, currentY, 450, 250).stroke('#ccc');
        doc.fontSize(10).fillColor('#900').text(`Kunde inte rita karta: ${mapErr.message}`, currentX + 10, currentY + 110);
        doc.y = currentY + 265;
      }

      doc.fontSize(12).fillColor('#000').text('3.2 Tvärsektion / Jordprofil');
      doc.moveDown(0.5);
      if (docs?.crossSectionSVG) {
        doc.rect(doc.x, doc.y, 450, 200).stroke('#ccc');
        doc.fontSize(10).fillColor('#666').text('Tvärsektion genererad och bifogas i digital submission.', doc.x + 100, doc.y + 90);
      } else {
        doc.fontSize(10).fillColor('#900').text('Varning: Tvärsektion ej genererad.');
      }

      // --- Footer with legal traceability on every page ---
      const pages = doc.bufferedPageRange();
      for (let i = 0; i < pages.count; i++) {
        doc.switchToPage(i);
        doc.fontSize(7).fillColor('#999').text(
          `Sida ${i + 1} av ${pages.count} | Miljöbeslut.se - Referens: ${application.referenceNumber}`,
          50,
          doc.page.height - 55,
          { align: 'center', width: doc.page.width - 100 },
        );
        doc.fontSize(6).fillColor('#888').text(traceFooter, 50, doc.page.height - 42, {
          align: 'center',
          width: doc.page.width - 100,
        });
      }

      doc.end();
      stream.on('finish', () => {
        logger.info(`PDF genererad: ${outputPath}`);
        resolve(outputPath);
      });
      stream.on('error', (err) => reject(err));
    } catch (err) {
      reject(err);
    }
  });
}
