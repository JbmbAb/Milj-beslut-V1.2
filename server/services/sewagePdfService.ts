import PDFDocument from 'pdfkit';
import * as fs from 'fs';
import { SewageApplicationRecord } from '../repositories/sewageApplicationRepository';
import { logger } from '../logger';

/**
 * SewagePdfService
 * Genererar en professionell PDF-dossier för enskilt avlopp.
 * Inkluderar teknisk sammanfattning och plats för ritningar.
 */
export async function generateSewageDossierPdf(
  application: SewageApplicationRecord,
  outputPath: string
): Promise<string> {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        margin: 50,
        size: 'A4',
        bufferPages: true,
        info: {
          Title: `Miljöbeslut Dossier - ${application.propertyDesignation}`,
          Author: 'Miljöbeslut.se',
        }
      });

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

      // --- 1. Fastighetsinformation ---
      doc.fontSize(16).fillColor('#1a5f7a').text('1. Fastighetsinformation', { underline: true });
      doc.moveDown(0.5);
      doc.fontSize(11).fillColor('#333');
      doc.text(`Sökande: ${application.applicantName}`);
      doc.text(`E-post: ${application.applicantEmail}`);
      doc.text(`Koordinater: ${application.latitude}, ${application.longitude}`);
      doc.text(`Dimensionering: ${application.pe} personekvivalenter (PE)`);
      doc.text(`Vald systemtyp: ${application.systemType}`);
      doc.moveDown(2);

      // --- 2. Tekniska förutsättningar ---
      doc.fontSize(16).fillColor('#1a5f7a').text('2. Tekniska förutsättningar', { underline: true });
      doc.moveDown(0.5);
      
      const profile = application.domainSnapshot?.protectionProfile;
      if (profile) {
        doc.fontSize(11).fillColor('#000').text(`Skyddsnivå: ${profile.protectionLevel === 'HIGH' ? 'HÖG' : 'NORMAL'}`);
        doc.fontSize(10).fillColor('#444').text(`Motivering: ${profile.reason || 'Baserat på GIS-analys'}`);
        doc.moveDown(0.5);
        doc.text(`Avstånd till närmaste brunn: ${profile.nearestWell?.distance}m`);
        doc.text(`Avstånd till ytvatten: ${profile.nearestWaterCourse?.distance}m`);
        doc.text(`Avstånd till tomtgräns: ${profile.distanceToPropertyLine}m`);
      } else {
        doc.fontSize(11).text('Teknisk profil saknas i utkastet.');
      }
      doc.moveDown(2);

      // --- 3. Ritningar ---
      doc.addPage();
      doc.fontSize(16).fillColor('#1a5f7a').text('3. Tekniskt Underlag & Ritningar', { underline: true });
      doc.moveDown(1);

      const docs = application.domainSnapshot?.generatedDocuments;
      
      // Situationsplan placeholder/info
      doc.fontSize(12).fillColor('#000').text('3.1 Situationsplan');
      doc.moveDown(0.5);
      if (docs?.situationPlanSVG) {
        doc.rect(doc.x, doc.y, 450, 250).stroke('#ccc');
        doc.fontSize(10).fillColor('#666').text('SVG-ritning genererad och bifogas i digital submission.', doc.x + 100, doc.y + 110);
        doc.moveDown(18);
      } else {
        doc.fontSize(10).fillColor('#900').text('Varning: Situationsplan ej genererad.');
        doc.moveDown(2);
      }

      // Tvärsektion placeholder/info
      doc.fontSize(12).fillColor('#000').text('3.2 Tvärsektion / Jordprofil');
      doc.moveDown(0.5);
      if (docs?.crossSectionSVG) {
        doc.rect(doc.x, doc.y, 450, 200).stroke('#ccc');
        doc.fontSize(10).fillColor('#666').text('Tvärsektion genererad och bifogas i digital submission.', doc.x + 100, doc.y + 90);
      } else {
        doc.fontSize(10).fillColor('#900').text('Varning: Tvärsektion ej genererad.');
      }

      // --- Footer ---
      const pages = doc.bufferedPageRange();
      for (let i = 0; i < pages.count; i++) {
        doc.switchToPage(i);
        doc.fontSize(8).fillColor('#999').text(
          `Sida ${i + 1} av ${pages.count} | Miljöbeslut.se - Referens: ${application.referenceNumber}`,
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
