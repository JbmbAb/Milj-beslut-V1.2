#!/usr/bin/env node
import path from 'node:path';
import { INPUT_FILENAMES } from './contracts.mjs';
import { normalizeText, readCsvFile, toUpper, writeCsvFile } from './lib.mjs';

const QUEUE_HEADERS = [
  'Priority',
  'RequirementId',
  'CaseId',
  'DocumentId',
  'PdfViewPath',
  'Kommun',
  'Myndighet',
  'Dokumenttyp',
  'Kravkategori',
  'Kravsubkategori',
  'Verifieringsstatus',
  'VerifieradJaNej',
  'VerifieradAv',
  'VerifieradDatum',
  'PrimaryCitationId',
  'PrimaryPageNumber',
  'PrimaryComment',
  'Kallafil',
];

function parseArgs(argv) {
  const args = argv.slice(2);
  const parsed = {
    dataset: './working/current',
    out: './working/current/verification_queue.csv',
  };

  for (const arg of args) {
    if (arg.startsWith('--dataset=')) parsed.dataset = arg.slice('--dataset='.length);
    else if (arg.startsWith('--out=')) parsed.out = arg.slice('--out='.length);
  }

  return parsed;
}

function priorityForCategory(category) {
  const normalized = toUpper(category);
  if (normalized === 'YTKONSTRUKTION' || normalized === 'DAGVATTENLAKVATTEN') return 'HIGH';
  if (normalized === 'RISKHANTERING' || normalized === 'DRIFTEGENKONTROLL') return 'MEDIUM';
  return 'NORMAL';
}

async function main() {
  const options = parseArgs(process.argv);
  const datasetDir = path.resolve(process.cwd(), options.dataset);
  const outPath = path.resolve(process.cwd(), options.out);

  const [casesCsv, requirementsCsv, citationsCsv] = await Promise.all([
    readCsvFile(path.join(datasetDir, INPUT_FILENAMES.cases)),
    readCsvFile(path.join(datasetDir, INPUT_FILENAMES.requirements)),
    readCsvFile(path.join(datasetDir, INPUT_FILENAMES.citations)),
  ]);

  const casesById = new Map(casesCsv.records.map((row) => [normalizeText(row.CaseId), row]));
  const firstCitationByRequirement = new Map();
  for (const citation of citationsCsv.records) {
    const reqId = normalizeText(citation.RequirementId);
    if (!reqId || firstCitationByRequirement.has(reqId)) continue;
    firstCitationByRequirement.set(reqId, citation);
  }

  const queueRows = requirementsCsv.records
    .filter((row) => toUpper(row.Verifieringsstatus) !== 'VERIFIED' || toUpper(row.VerifieradJaNej) !== 'JA')
    .map((row) => {
      const caseRow = casesById.get(normalizeText(row.CaseId));
      const citation = firstCitationByRequirement.get(normalizeText(row.RequirementId));
      return {
        Priority: priorityForCategory(row.Kravkategori),
        RequirementId: normalizeText(row.RequirementId),
        CaseId: normalizeText(row.CaseId),
        DocumentId: normalizeText(row.DocumentId),
        PdfViewPath: `/api/admin/requirements/documents/${normalizeText(row.DocumentId)}/view`,
        Kommun: normalizeText(caseRow?.Kommun),
        Myndighet: normalizeText(caseRow?.Myndighet),
        Dokumenttyp: normalizeText(caseRow?.Dokumenttyp),
        Kravkategori: normalizeText(row.Kravkategori),
        Kravsubkategori: normalizeText(row.Kravsubkategori),
        Verifieringsstatus: normalizeText(row.Verifieringsstatus),
        VerifieradJaNej: normalizeText(row.VerifieradJaNej),
        VerifieradAv: normalizeText(row.VerifieradAv),
        VerifieradDatum: normalizeText(row.VerifieradDatum),
        PrimaryCitationId: normalizeText(citation?.CitationId),
        PrimaryPageNumber: normalizeText(citation?.PageNumber),
        PrimaryComment: normalizeText(citation?.Kommentar),
        Kallafil: normalizeText(caseRow?.KallaFil),
      };
    })
    .sort((a, b) => {
      const rank = { HIGH: 0, MEDIUM: 1, NORMAL: 2 };
      return rank[a.Priority] - rank[b.Priority] || a.Kommun.localeCompare(b.Kommun);
    });

  await writeCsvFile(outPath, QUEUE_HEADERS, queueRows);
  process.stdout.write(`${JSON.stringify({ ok: true, outPath, queueSize: queueRows.length })}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
