#!/usr/bin/env node
import path from 'node:path';
import { INPUT_FILENAMES } from './contracts.mjs';
import { normalizeText, readCsvFile, writeCsvFile, writeJsonFile } from './lib.mjs';

function parseArgs(argv) {
  const args = argv.slice(2);
  const parsed = {
    dataset: './working/current',
    report: './working/current/backfill_citation_links_report.json',
    dryRun: false,
  };

  for (const arg of args) {
    if (arg.startsWith('--dataset=')) parsed.dataset = arg.slice('--dataset='.length);
    else if (arg.startsWith('--report=')) parsed.report = arg.slice('--report='.length);
    else if (arg === '--dry-run') parsed.dryRun = true;
  }

  return parsed;
}

function hasAnchor(citation) {
  return normalizeText(citation.PageNumber) !== '' || normalizeText(citation.Kommentar) !== '';
}

function buildAutoComment(documentId, fileName) {
  const doc = normalizeText(documentId) || 'missing-document-id';
  const file = normalizeText(fileName) || 'unknown-file';
  return `AUTO_LINK: /api/admin/requirements/documents/${doc}/view | file=${file} | page=manual-required`;
}

async function main() {
  const options = parseArgs(process.argv);
  const datasetDir = path.resolve(process.cwd(), options.dataset);
  const reportPath = path.resolve(process.cwd(), options.report);

  const [casesCsv, requirementsCsv, citationsCsv] = await Promise.all([
    readCsvFile(path.join(datasetDir, INPUT_FILENAMES.cases)),
    readCsvFile(path.join(datasetDir, INPUT_FILENAMES.requirements)),
    readCsvFile(path.join(datasetDir, INPUT_FILENAMES.citations)),
  ]);

  const caseById = new Map(casesCsv.records.map((row) => [normalizeText(row.CaseId), row]));
  const reqById = new Map(requirementsCsv.records.map((row) => [normalizeText(row.RequirementId), row]));

  let updatedCount = 0;
  let alreadyAnchoredCount = 0;
  let missingDocumentIdCount = 0;
  const touchedCitationIds = [];

  const nextCitations = citationsCsv.records.map((citation) => {
    if (hasAnchor(citation)) {
      alreadyAnchoredCount += 1;
      return citation;
    }

    const requirement = reqById.get(normalizeText(citation.RequirementId));
    const caseId = normalizeText(citation.CaseId) || normalizeText(requirement?.CaseId);
    const caseRow = caseById.get(caseId);
    const documentId = normalizeText(citation.DocumentId) || normalizeText(requirement?.DocumentId) || normalizeText(caseRow?.DocumentId);
    const kallaFil = normalizeText(caseRow?.KallaFil);

    if (!documentId) {
      missingDocumentIdCount += 1;
    }

    const next = { ...citation };
    next.Kommentar = buildAutoComment(documentId, kallaFil);
    updatedCount += 1;
    touchedCitationIds.push(normalizeText(citation.CitationId));
    return next;
  });

  if (!options.dryRun) {
    await writeCsvFile(path.join(datasetDir, INPUT_FILENAMES.citations), citationsCsv.headers, nextCitations);
  }

  const report = {
    generatedAt: new Date().toISOString(),
    datasetDir,
    dryRun: options.dryRun,
    totals: {
      citations: citationsCsv.records.length,
      alreadyAnchored: alreadyAnchoredCount,
      updated: updatedCount,
      missingDocumentId: missingDocumentIdCount,
    },
    sampleTouchedCitationIds: touchedCitationIds.slice(0, 25),
  };

  await writeJsonFile(reportPath, report);
  process.stdout.write(`${JSON.stringify({ ok: true, reportPath, totals: report.totals })}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});

