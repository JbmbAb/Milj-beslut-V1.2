import PDFDocument from 'pdfkit';
import type PDFKit from 'pdfkit';
import * as fs from 'fs';
import { CNotificationMassCaseRecord } from '../repositories/cNotificationMassRepository';
import type { MassGisSnapshot } from '../../src/types/mass';
import { logger } from '../logger';

const zoneColors: Record<string, string> = {
  MELLANLAGRING: '#6366f1',
  DEPONI: '#059669',
  TRANSIT: '#475569',
};

function appendGisSituationsplanPage(
  doc: PDFKit.PDFDocument,
  record: CNotificationMassCaseRecord,
  gis: MassGisSnapshot,
) {
  doc.addPage();
  doc.fontSize(16).fillColor('#1a5f7a').text('4. GIS & Situationsplan', { underline: true });
  doc.moveDown(0.5);

  doc.fontSize(10).fillColor('#333');
  doc.text(`Fastighet: ${record.propertyDesignation}`);
  doc.text(`Analyserad: ${new Date(gis.analyzedAt).toLocaleString('sv-SE')}`);
  if (gis.propertySource) doc.text(`Datakälla: ${gis.propertySource}`);
  doc.text(
    `Centroid: ${gis.analysis.centroid.lat.toFixed(5)}, ${gis.analysis.centroid.lng.toFixed(5)}`,
  );
  doc.text(`Riskpoäng: ${gis.analysis.overallRiskScore}/100 · ${gis.analysis.logisticsSuitability}`);
  if (gis.analysis.markCover) {
    doc.text(`Marktäcke: ${gis.analysis.markCover.description}`);
  }
  doc.moveDown(0.75);

  const mapX = 50;
  const mapY = doc.y;
  const mapW = 495;
  const mapH = 210;
  doc.rect(mapX, mapY, mapW, mapH).stroke('#cbd5e1');

  const centerX = mapX + mapW / 2;
  const centerY = mapY + mapH / 2;
  const propertySize = 70;
  doc
    .rect(centerX - propertySize / 2, centerY - propertySize / 2, propertySize, propertySize)
    .fillAndStroke('#dbeafe', '#2563eb');
  doc.fillColor('#1e3a8a').fontSize(9).text('Fastighet', centerX - 22, centerY - 4);

  for (const zone of gis.siteProfile.recommendedZones) {
    const lateral = zone.operationType === 'DEPONI' ? -36 : zone.operationType === 'MELLANLAGRING' ? 36 : 0;
    const cx = centerX + lateral;
    const cy = centerY - zone.offsetM * 1.4;
    const color = zoneColors[zone.operationType] ?? '#64748b';
    doc.circle(cx, cy, 14).fillAndStroke(color, color);
    doc.fillColor('#334155').fontSize(8).text(zone.label, cx - 28, cy + 18, { width: 56, align: 'center' });
  }

  doc.y = mapY + mapH + 14;
  doc.fillColor('#333').fontSize(10).text('Platsbedömning:', { continued: false });
  doc.moveDown(0.25);
  for (const constraint of gis.analysis.siteConstraints) {
    doc.fontSize(9).text(`• [${constraint.severity}] ${constraint.label}`);
  }
  if (gis.analysis.warnings.length > 0) {
    doc.moveDown(0.5);
    doc.fontSize(9).fillColor('#92400e').text(`Varningar: ${gis.analysis.warnings.join(' ')}`);
  }
}

/**
 * MassLogisticsPdfService
 * Genererar ett juridiskt underlag för transport och hantering av schaktmassor.
 */
export async function generateMassLogisticsPdf(
  record: CNotificationMassCaseRecord,
  outputPath: string
): Promise<string> {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        margin: 50,
        size: 'A4',
        bufferPages: true,
        info: {
          Title: `Logistikunderlag - ${record.propertyDesignation}`,
          Author: 'Miljöbeslut.se',
        }
      });

      const stream = fs.createWriteStream(outputPath);
      doc.pipe(stream);

      // --- Header & Branding ---
      doc.fontSize(24).fillColor('#1a5f7a').text('MILJÖBESLUT.SE', { align: 'right' });
      doc.fontSize(10).fillColor('#666').text('Digital logistikplanering för schaktmassor', { align: 'right' });
      doc.moveDown(2);

      // --- Title Page ---
      doc.fontSize(28).fillColor('#000').text('Logistikunderlag: Schaktmassor', { align: 'left' });
      doc.fontSize(18).fillColor('#444').text(record.propertyDesignation, { align: 'left' });
      doc.moveDown(1);
      
      doc.fontSize(12).fillColor('#000').text(`Datum: ${new Date().toLocaleDateString('sv-SE')}`);
      doc.text(`Referensnummer: ${record.referenceNumber}`);
      doc.text(`Status: ${record.status}`);
      doc.moveDown(2);

      // --- 1. Delbeslut & Kapacitet ---
      doc.fontSize(16).fillColor('#1a5f7a').text('1. Hantering och Kapacitet', { underline: true });
      doc.moveDown(0.5);

      const mellanlagring = record.operations.find(o => o.operationType === 'MELLANLAGRING');
      const deponi = record.operations.find(o => o.operationType === 'DEPONI');

      if (mellanlagring) {
        doc.fontSize(12).fillColor('#000').text('1.1 Mellanlagring');
        doc.fontSize(10).fillColor('#333');
        doc.text(`EWC-kod: ${mellanlagring.ewcCode}`);
        doc.text(`Mängd per år: ${mellanlagring.quantityPerYear} ton`);
        doc.text(`Bedömning: ${mellanlagring.gateDecision}`);
        doc.moveDown(0.5);
      }

      if (deponi) {
        doc.fontSize(12).fillColor('#000').text('1.2 Deponering');
        doc.fontSize(10).fillColor('#333');
        doc.text(`EWC-kod: ${deponi.ewcCode}`);
        doc.text(`Mängd per år: ${deponi.quantityPerYear} ton`);
        doc.text(`Bedömning: ${deponi.gateDecision}`);
        doc.moveDown(0.5);
      }

      if (!mellanlagring && !deponi) {
        doc.fontSize(10).text('Inga operationer registrerade.');
      }
      doc.moveDown(1);

      // --- 2. Transportkedja ---
      doc.fontSize(16).fillColor('#1a5f7a').text('2. Transport och Logistik', { underline: true });
      doc.moveDown(0.5);
      
      if (record.logisticsPlanId) {
        doc.fontSize(10).fillColor('#333').text(`Logistikplan ID: ${record.logisticsPlanId}`);
        doc.text('Planerad transportkedja inkluderar ruttoptimering och CO2-beräkning.');
      } else {
        doc.fontSize(10).text('Ingen aktiv logistikplan kopplad till ärendet.');
      }
      doc.moveDown(2);

      // --- 3. Massflöde ---
      doc.addPage();
      doc.fontSize(16).fillColor('#1a5f7a').text('3. Aktuellt Massflöde (Snapshot)', { underline: true });
      doc.moveDown(1);

      if (record.massFlowSnapshot) {
        doc.fontSize(10).fillColor('#333').text('Aktuell status för lagringsplatser inuti projektet:');
        doc.moveDown(0.5);
        doc.text(JSON.stringify(record.massFlowSnapshot, null, 2).substring(0, 500) + '...');
      } else {
        doc.fontSize(10).text('Inget massflöde registrerat ännu.');
      }

      if (record.gisSnapshot) {
        appendGisSituationsplanPage(doc, record, record.gisSnapshot);
      } else {
        doc.addPage();
        doc.fontSize(16).fillColor('#1a5f7a').text('4. GIS & Situationsplan', { underline: true });
        doc.moveDown(0.5);
        doc.fontSize(10).fillColor('#92400e').text(
          'GIS-underlag saknas på ärendet. Kör GIS-analys i C-anmälan schaktmassor och spara delbeslut innan slutlig inlämning.',
        );
      }

      doc.addPage();
      doc.fontSize(14).fillColor('#1a5f7a').text('5. Human in the Loop', { underline: true });
      doc.moveDown(0.5);
      doc
        .fontSize(10)
        .fillColor('#333')
        .text(
          'Underlaget är AI-assisterat. Handläggare ska verifiera MPF/EWC, kapacitet och transportkedja innan myndighetsinlämning.',
        );

      // --- Footer ---
      const pages = doc.bufferedPageRange();
      for (let i = 0; i < pages.count; i++) {
        doc.switchToPage(i);
        doc.fontSize(8).fillColor('#999').text(
          `Sida ${i + 1} av ${pages.count} | Miljöbeslut.se - Referens: ${record.referenceNumber}`,
          50,
          doc.page.height - 50,
          { align: 'center' }
        );
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
