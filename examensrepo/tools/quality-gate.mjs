#!/usr/bin/env node
import path from 'node:path';
import { DOUBLE_REVIEW_CATEGORIES, INPUT_FILENAMES } from './contracts.mjs';
import { normalizeText, readCsvFile, toUpper, writeJsonFile, yesNoToBool } from './lib.mjs';

function parseArgs(argv) {
  const args = argv.slice(2);
  const parsed = {
    dataset: './working/current',
    out: './working/current/quality_gate_report.json',
    soft: false,
  };

  for (const arg of args) {
    if (arg.startsWith('--dataset=')) parsed.dataset = arg.slice('--dataset='.length);
    else if (arg.startsWith('--out=')) parsed.out = arg.slice('--out='.length);
    else if (arg === '--soft') parsed.soft = true;
  }

  return parsed;
}

function isRequirementVerified(requirement) {
  return toUpper(requirement.Verifieringsstatus) === 'VERIFIED' && yesNoToBool(requirement.VerifieradJaNej);
}

function isCitationVerified(citation) {
  const hasTraceAnchor = normalizeText(citation.PageNumber) !== '' || normalizeText(citation.Kommentar) !== '';
  return yesNoToBool(citation.VerifieradJaNej) && normalizeText(citation.VerifieradAv) !== '' && normalizeText(citation.VerifieradDatum) !== '' && hasTraceAnchor;
}

async function main() {
  const options = parseArgs(process.argv);
  const datasetDir = path.resolve(process.cwd(), options.dataset);
  const outputPath = path.resolve(process.cwd(), options.out);

  const [requirementsCsv, citationsCsv] = await Promise.all([
    readCsvFile(path.join(datasetDir, INPUT_FILENAMES.requirements)),
    readCsvFile(path.join(datasetDir, INPUT_FILENAMES.citations)),
  ]);

  const citationsByRequirement = new Map();
  for (const citation of citationsCsv.records) {
    const requirementId = normalizeText(citation.RequirementId);
    if (!requirementId) continue;
    const list = citationsByRequirement.get(requirementId) || [];
    list.push(citation);
    citationsByRequirement.set(requirementId, list);
  }

  const errors = [];
  const warnings = [];

  for (const requirement of requirementsCsv.records) {
    const requirementId = normalizeText(requirement.RequirementId);
    if (!requirementId) {
      errors.push({ type: 'MISSING_REQUIREMENT_ID', row: requirement });
      continue;
    }

    if (!isRequirementVerified(requirement)) {
      errors.push({
        type: 'REQUIREMENT_NOT_VERIFIED',
        requirementId,
        status: normalizeText(requirement.Verifieringsstatus),
        verifiedFlag: normalizeText(requirement.VerifieradJaNej),
      });
    }

    if (normalizeText(requirement.VerifieradAv) === '' || normalizeText(requirement.VerifieradDatum) === '') {
      errors.push({ type: 'REQUIREMENT_MISSING_VERIFIER_FIELDS', requirementId });
    }

    const category = toUpper(requirement.Kravkategori);
    if (DOUBLE_REVIEW_CATEGORIES.has(category) && normalizeText(requirement.ValideringsKommentar) === '') {
      warnings.push({
        type: 'CRITICAL_CATEGORY_MISSING_DOUBLE_REVIEW_NOTE',
        requirementId,
        category,
      });
    }

    const citations = citationsByRequirement.get(requirementId) || [];
    if (citations.length === 0) {
      errors.push({ type: 'MISSING_CITATION', requirementId });
      continue;
    }

    const invalidCitationIds = citations
      .filter((citation) => !isCitationVerified(citation))
      .map((citation) => normalizeText(citation.CitationId));

    if (invalidCitationIds.length > 0) {
      errors.push({ type: 'CITATION_NOT_VERIFIED', requirementId, citationIds: invalidCitationIds });
    }
  }

  const report = {
    generatedAt: new Date().toISOString(),
    datasetDir,
    totals: {
      requirements: requirementsCsv.records.length,
      citations: citationsCsv.records.length,
      errors: errors.length,
      warnings: warnings.length,
    },
    passed: errors.length === 0,
    errors,
    warnings,
  };

  await writeJsonFile(outputPath, report);

  if (!report.passed && !options.soft) {
    process.stderr.write(`${JSON.stringify({ ok: false, reportPath: outputPath, errors: report.totals.errors })}\n`);
    process.exit(1);
  }

  process.stdout.write(`${JSON.stringify({ ok: report.passed, reportPath: outputPath, warnings: report.totals.warnings })}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
