/**
 * DEMO-01 PDFs (K-20 §6, K-26 §2). Rendered only from a frozen, hash-checked approval
 * (caseStore.loadFrozen), never from the live case. Footer on every page: marking, release SHA
 * and frozen-JSON hash. Footer is written with the bottom margin lifted so pdfkit never
 * auto-adds a page for it (the blank-page defect found in D0).
 */
import PDFDocument from 'pdfkit';
import type { FrozenProposal } from './approvalGate';
import { loadBlob } from './caseStore';
import { formatSource } from './formatSource';
import { FICTIONAL_MARK, type ProposalRow, type ProposalSectionId } from './types';

export const ANMALAN_TITLE = 'C-anmälan – förslag, ej inlämnad';
export const EGENKONTROLL_TITLE = 'Egenkontrollprogram – förslag';
export const DISCLAIMER =
  'Detta är ett förslag sammanställt i Mimer (DEMO-01, demo-branch). Det är inte inlämnat och Mimer lämnar inte in. ' +
  'Verksamhetsutövaren ansvarar för innehållet. Varje rad anger sin källa eller är markerad som användarens uppgift.';

const SECTION_TITLES: Record<ProposalSectionId, string> = {
  verksamhetsutovare: '1. Verksamhetsutövare och fastighet',
  verksamhet: '2. Verksamhet och verksamhetskod',
  lokalisering: '3. Lokalisering',
  teknisk_beskrivning: '4. Teknisk beskrivning av lagringsytan',
  forsiktighetsmatt: '5. Försiktighetsmått',
  egenkontroll: 'Kontrollpunkter',
  bilagor: '6. Bilagor',
};

function render(
  build: (doc: PDFKit.PDFDocument) => void,
  footer: string,
  runningHeader: string,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margins: { top: 56, bottom: 72, left: 56, right: 56 }, bufferPages: true });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    build(doc);
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i += 1) {
      doc.switchToPage(i);
      const saved = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;
      const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
      doc.fontSize(7).fillColor('#475569')
        .text(`${footer} · sida ${i - range.start + 1} av ${range.count}`, doc.page.margins.left, doc.page.height - 48, { width, align: 'center', lineBreak: true, height: 30 });
      // Same running header on every page, attachment pages included (K-54).
      doc.fontSize(8).fillColor('#b91c1c').text(runningHeader, doc.page.margins.left, 30, { width, align: 'right', lineBreak: false });
      doc.page.margins.bottom = saved;
    }
    doc.end();
  });
}

function header(doc: PDFKit.PDFDocument, title: string, frozen: FrozenProposal) {
  doc.fontSize(18).fillColor('#0f172a').text(title);
  doc.fontSize(10).fillColor('#334155').text(`Fastighet: ${frozen.input.propertyDesignation}`);
  doc.text(`Godkänt radvis av användaren: ${frozen.approvedAt.slice(0, 16).replace('T', ' ')} (UTC)`);
  if (frozen.underlag?.fictional) {
    doc.fillColor('#b91c1c').font('Helvetica-Bold')
      .text(`${FICTIONAL_MARK}. Användarens uppgifter kommer ur ${frozen.underlag.label} (sha256 ${frozen.underlag.sha256.slice(0, 12)}…) och är påhittade för test; detta är ingen verklig anmälan.`)
      .font('Helvetica');
  } else if (frozen.underlag) {
    doc.fillColor('#334155').text(`Användarens underlag: ${frozen.underlag.label} (sha256 ${frozen.underlag.sha256.slice(0, 12)}…)`);
  }
  if (frozen.input.placeholder) {
    doc.fillColor('#b45309').text('Ärendet innehåller platshållare: användarens underlag är inte ifyllt.');
  }
  doc.moveDown(0.5).fontSize(8).fillColor('#475569').text(DISCLAIMER);
  doc.moveDown(0.8);
}

function rowBlock(doc: PDFKit.PDFDocument, r: ProposalRow) {
  doc.fontSize(9.5).fillColor('#0f172a').font('Helvetica-Bold').text(r.label);
  doc.font('Helvetica').fontSize(9.5).fillColor('#1e293b').text(r.text);
  if (r.control) {
    const c = r.control;
    doc.fontSize(8.5).fillColor('#1e293b')
      .text(`Frekvens: ${c.frekvens} · Metod: ${c.metod} · Ansvarig: ${c.ansvarig} · Dokumentation: ${c.dokumentation} · Avvikelsehantering: ${c.avvikelse}`);
  }
  if (r.note) doc.fontSize(8).fillColor('#b45309').text(r.note);
  doc.fontSize(7.5).fillColor('#64748b').text(formatSource(r.provenance));
  if (r.editedFrom) doc.text(`Ursprungligt förslag: ${formatSource(r.editedFrom).replace(/^Källa: /, '')}`);
  doc.moveDown(0.6);
}

function headerText(frozen: FrozenProposal) {
  return frozen.underlag?.fictional ? `FÖRSLAG – EJ INLÄMNAD · ${FICTIONAL_MARK}` : 'FÖRSLAG – EJ INLÄMNAD';
}

function footerText(frozen: FrozenProposal, sha256: string) {
  const mark = frozen.underlag?.fictional ? `${FICTIONAL_MARK} · ` : '';
  return `${mark}Förslag – ej inlämnad · release ${frozen.releaseSha} · fryst JSON sha256 ${sha256}`;
}

export async function renderAnmalanPdf(frozen: FrozenProposal, sha256: string): Promise<Buffer> {
  const order: ProposalSectionId[] = ['verksamhetsutovare', 'verksamhet', 'lokalisering', 'teknisk_beskrivning', 'forsiktighetsmatt'];
  // Every approved attachment is read back by its frozen hash BEFORE rendering starts: a changed
  // byte is an error (attachment_hash_mismatch), never a silently different image.
  const attachments = frozen.rows
    .filter((r) => r.section === 'bilagor' && r.attachment)
    .map((r, i) => ({ n: i + 1, row: r, image: loadBlob(r.attachment!.sha256, r.attachment!.mime) }));
  return render((doc) => {
    header(doc, ANMALAN_TITLE, frozen);
    for (const section of order) {
      const rows = frozen.rows.filter((r) => r.section === section);
      doc.fontSize(12).fillColor('#0f172a').font('Helvetica-Bold').text(SECTION_TITLES[section]).font('Helvetica');
      if (section === 'lokalisering') doc.fontSize(8).fillColor('#b45309').text(frozen.inputs.localizationLabel);
      if (section === 'forsiktighetsmatt' && frozen.inputs.requirements.state !== 'loaded') {
        doc.fontSize(8.5).fillColor('#b45309').text(`Inga förslag ur kommunkorpusen: ${frozen.inputs.requirements.message}`);
      }
      doc.moveDown(0.4);
      if (rows.length === 0) doc.fontSize(9).fillColor('#64748b').text('Inga godkända rader i detta avsnitt.').moveDown(0.6);
      rows.forEach((r) => rowBlock(doc, r));
    }
    if (attachments.length) {
      doc.fontSize(12).fillColor('#0f172a').font('Helvetica-Bold').text(SECTION_TITLES.bilagor).font('Helvetica').moveDown(0.3);
      attachments.forEach(({ n, row }) => doc.fontSize(9.5).fillColor('#1e293b').text(`Bilaga ${n}: ${row.attachment!.title}`));
    }
    for (const { n, row, image } of attachments) {
      doc.addPage();
      doc.fontSize(14).fillColor('#0f172a').font('Helvetica-Bold').text(`Bilaga ${n}: ${row.attachment!.title}`).font('Helvetica');
      if (row.note) doc.fontSize(8).fillColor('#b45309').text(row.note);
      doc.fontSize(7.5).fillColor('#64748b').text(`${formatSource(row.provenance)}; bild-sha256 ${row.attachment!.sha256}`);
      doc.moveDown(0.5);
      const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
      const height = doc.page.height - doc.y - doc.page.margins.bottom - 8;
      doc.image(image, doc.page.margins.left, doc.y, { fit: [width, height], align: 'center' });
    }
  }, footerText(frozen, sha256), headerText(frozen));
}

export function renderEgenkontrollPdf(frozen: FrozenProposal, sha256: string): Promise<Buffer> {
  return render((doc) => {
    header(doc, EGENKONTROLL_TITLE, frozen);
    const ids = ['user-verksamhetsutovare', 'user-verksamhetskoder'];
    frozen.rows.filter((r) => ids.includes(r.id)).forEach((r) => rowBlock(doc, r));
    doc.fontSize(12).fillColor('#0f172a').font('Helvetica-Bold').text(SECTION_TITLES.egenkontroll).font('Helvetica');
    const rows = frozen.rows.filter((r) => r.section === 'egenkontroll');
    if (frozen.inputs.requirements.state !== 'loaded') {
      doc.fontSize(8.5).fillColor('#b45309').text(`Inga kontrollpunkter ur kommunkorpusen: ${frozen.inputs.requirements.message}`);
    }
    doc.moveDown(0.4);
    if (rows.length === 0) doc.fontSize(9).fillColor('#64748b').text('Inga godkända kontrollpunkter.');
    rows.forEach((r) => rowBlock(doc, r));
  }, footerText(frozen, sha256), headerText(frozen));
}
