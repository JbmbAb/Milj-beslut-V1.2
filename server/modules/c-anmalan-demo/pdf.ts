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
import {
  CONTROL_FIELD_LABEL,
  CONTROL_FIELDS,
  EGENKONTROLL_SOURCE_DOCUMENTS,
  EGENKONTROLL_SOURCE_NOTE,
  EGENKONTROLL_TEMPLATE_ID,
} from './egenkontrollTemplate';
import { FICTIONAL_MARK, type ProposalRow, type ProposalSectionId, type UnderlagFileRef } from './types';

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
  egenkontroll: 'Kontrollpunkter ur kommunala beslut',
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

const USER_MISSING_TEXT = 'användarens uppgift – ej ifylld';
const tag = (refs?: UnderlagFileRef[]) => (refs?.length ? ` [${refs.map((r) => r.file.split('-')[0]).join(', ')}]` : '');

/** K-94b table: kontrollpunkt | frekvens | metod | ansvarig | dokumentation | avvikelse. */
function controlTable(doc: PDFKit.PDFDocument, rows: ProposalRow[]) {
  const left = doc.page.margins.left;
  const total = doc.page.width - left - doc.page.margins.right;
  const widths = [0.19, 0.15, 0.17, 0.12, 0.17, 0.2].map((w) => w * total);
  const pad = 3;
  const draw = (cells: string[], bold: boolean) => {
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(7);
    const h = Math.max(...cells.map((c, i) => doc.heightOfString(c, { width: widths[i] - 2 * pad }))) + 2 * pad;
    if (doc.y + h > doc.page.height - doc.page.margins.bottom) {
      doc.addPage();
      if (!bold) {
        draw(HEADER, true);
        doc.font('Helvetica').fontSize(7); // the repeated header leaves bold set; the row was measured in regular
      }
    }
    const y = doc.y;
    let x = left;
    cells.forEach((c, i) => {
      if (bold) doc.rect(x, y, widths[i], h).fillAndStroke('#f1f5f9', '#cbd5e1');
      else doc.rect(x, y, widths[i], h).strokeColor('#cbd5e1').stroke();
      doc.fillColor(c.startsWith('ej ifylld') ? '#94a3b8' : '#1e293b').text(c, x + pad, y + pad, { width: widths[i] - 2 * pad });
      x += widths[i];
    });
    doc.x = left;
    doc.y = y + h;
  };
  const HEADER = ['Kontrollpunkt', ...CONTROL_FIELDS.map((f) => CONTROL_FIELD_LABEL[f])];
  draw(HEADER, true);
  for (const r of rows) {
    const cells = CONTROL_FIELDS.map((f) => {
      const v = r.control?.[f] ?? USER_MISSING_TEXT;
      return v === USER_MISSING_TEXT ? 'ej ifylld' : `${v}${tag(r.controlSources?.[f])}`;
    });
    draw([r.label, ...cells], false);
  }
  doc.font('Helvetica').moveDown(0.5);
}

export function renderEgenkontrollPdf(frozen: FrozenProposal, sha256: string): Promise<Buffer> {
  return render((doc) => {
    header(doc, EGENKONTROLL_TITLE, frozen);
    const ids = ['user-verksamhetsutovare', 'user-verksamhetskoder'];
    frozen.rows.filter((r) => ids.includes(r.id)).forEach((r) => rowBlock(doc, r));

    const table = frozen.rows.filter((r) => r.section === 'egenkontroll' && r.id.startsWith('ek-'));
    const others = frozen.rows.filter((r) => r.section === 'egenkontroll' && !r.id.startsWith('ek-'));
    doc.fontSize(12).fillColor('#0f172a').font('Helvetica-Bold').text('Egenkontrollprogram').font('Helvetica').moveDown(0.3);
    if (table.length) {
      controlTable(doc, table);
      const files = new Map<string, UnderlagFileRef>();
      table.forEach((r) => Object.values(r.controlSources ?? {}).flat().forEach((f) => f && files.set(f.file, f)));
      doc.fontSize(7.5).fillColor('#64748b')
        .text(`Kontrollpunkter: ${EGENKONTROLL_SOURCE_NOTE} (mall ${EGENKONTROLL_TEMPLATE_ID}, ${EGENKONTROLL_SOURCE_DOCUMENTS.length} program, identifierade med sha256; inga namn eller citat).`)
        .text(`"ej ifylld" = användarens uppgift, ej ifylld.${files.size ? ` Märkta celler är användarens uppgift, citerade ur: ${[...files.values()].map((f) => `[${f.file.split('-')[0]}] ${f.file} sha256 ${f.sha256.slice(0, 12)}…`).join('; ')}${frozen.underlag?.fictional ? ' – fiktiv uppgift (demo)' : ''}.` : ''}`)
        .moveDown(0.6);
    } else {
      doc.fontSize(9).fillColor('#64748b').text('Inga godkända kontrollpunkter i tabellen.').moveDown(0.6);
    }

    doc.fontSize(12).fillColor('#0f172a').font('Helvetica-Bold').text(SECTION_TITLES.egenkontroll).font('Helvetica');
    if (frozen.inputs.requirements.state !== 'loaded') {
      doc.fontSize(8.5).fillColor('#b45309').text(`Inga kontrollpunkter ur kommunkorpusen: ${frozen.inputs.requirements.message}`);
    }
    doc.moveDown(0.4);
    if (others.length === 0) doc.fontSize(9).fillColor('#64748b').text('Inga godkända kontrollpunkter.');
    others.forEach((r) => rowBlock(doc, r));
  }, footerText(frozen, sha256), headerText(frozen));
}
