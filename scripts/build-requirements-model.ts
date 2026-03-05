import { promises as fs } from "node:fs";
import path from "node:path";
import {
  buildRows,
  parseOptions,
  readDumpFromDb,
  readDumpFromFile,
  type RequirementBuildRow,
} from "./export-kravmatris-from-dump.ts";

type ModelOptions = {
  inputPath?: string;
  outputDir: string;
  maxPerDocument: number;
  limitDocs?: number;
  projectId?: string;
  projectNameIncludes?: string;
  pdfBaseUrl: string;
};

type GenericRow = Record<string, string>;

const CASE_HEADERS = [
  "CaseId",
  "DocumentId",
  "PdfViewUrl",
  "PdfOpenLinkSv",
  "PdfOpenLinkEn",
  "ProjectId",
  "OrganisationId",
  "Kommun",
  "Myndighetstyp",
  "Myndighet",
  "Diarienummer",
  "Dokumenttyp",
  "Dokumentdatum",
  "KallaFil",
  "Kallrubrik",
  "CaseReviewStatus",
  "ValidatedBy",
  "ValidatedAt",
  "Notes",
] as const;

const REQUIREMENT_HEADERS = [
  "RequirementId",
  "CaseId",
  "DocumentId",
  "PdfViewUrl",
  "PdfOpenLinkSv",
  "PdfOpenLinkEn",
  "ProjectId",
  "KravkallaTyp",
  "Kravkategori",
  "Kravsubkategori",
  "KravtextCitat",
  "TolkadKravtext",
  "Kravniva",
  "RattsligHanvisning",
  "Tidsfrist",
  "Kontrollfrekvens",
  "SanktionEllerKonsekvens",
  "UtlosandeVillkor",
  "Avfallsslag",
  "EWC",
  "MaxMangdTon",
  "MaxLagringstid",
  "KopplingKonstruktion",
  "KopplingLakvatten",
  "KopplingKontrollprogram",
  "KopplingRisk",
  "Mallavsnitt",
  "KommunBlankettFalt",
  "BilagaSomStods",
  "MinimikravJaNej",
  "KommunspecifiktJaNej",
  "StatusIAnmalan",
  "Kommentar",
  "Kodningssakerhet",
  "Verifieringsstatus",
  "VerifieradJaNej",
  "VerifieradAv",
  "VerifieradDatum",
  "Feltyp",
  "ValideringsKommentar",
] as const;

const CITATION_HEADERS = [
  "CitationId",
  "RequirementId",
  "CaseId",
  "DocumentId",
  "PdfViewUrl",
  "PdfOpenLinkSv",
  "PdfOpenLinkEn",
  "QuoteText",
  "PageNumber",
  "CharStart",
  "CharEnd",
  "Extractor",
  "VerifieradJaNej",
  "VerifieradAv",
  "VerifieradDatum",
  "Kommentar",
] as const;

function printHelp() {
  console.log(
    [
      "Usage: tsx scripts/build-requirements-model.ts [options]",
      "",
      "Options:",
      "  --input=PATH                Read existing /api/admin/database-dump JSON file",
      "  --output-dir=PATH           Output directory (default: docs/qa/requirements-model)",
      "  --max-per-document=NUMBER   Max auto-rader per dokument (default: 3)",
      "  --limit-docs=NUMBER         Process only first N matching documents",
      "  --project-id=ID             Filter by projectId",
      "  --project-name=TEXT         Filter by project propertyDesignation contains TEXT",
      "  --pdf-base-url=URL          Base URL for PDF view links (default: http://localhost:8787)",
      "  --help                      Show this help",
      "",
      "Outputs:",
      "  requirement_cases.csv",
      "  requirement_rows.csv",
      "  requirement_citations.csv",
      "  requirement_summary.json",
    ].join("\n")
  );
}

function parseModelOptions(argv: string[]): ModelOptions {
  if (argv.includes("--help")) {
    printHelp();
    process.exit(0);
  }

  const base = parseOptions(argv);
  const args = argv.slice(2);
  const outputArg = args.find((arg) => arg.startsWith("--output-dir="));
  const outputDir = outputArg?.slice("--output-dir=".length).trim() || "docs/qa/requirements-model";
  const pdfBaseUrlArg = args.find((arg) => arg.startsWith("--pdf-base-url="));
  const pdfBaseUrl = (pdfBaseUrlArg?.slice("--pdf-base-url=".length).trim() || "http://localhost:8787").replace(/\/+$/, "");

  return {
    inputPath: base.inputPath,
    outputDir,
    maxPerDocument: base.maxPerDocument,
    limitDocs: base.limitDocs,
    projectId: base.projectId,
    projectNameIncludes: base.projectNameIncludes,
    pdfBaseUrl,
  };
}

function asInt(value: boolean): string {
  return value ? "1" : "0";
}

function toConfidence(row: RequirementBuildRow): string {
  const hasCore = row.KravtextCitat.length >= 40 && row.Diarienummer.length > 0;
  const hasContext = row.Kommun.length > 0 && row.Myndighet.length > 0 && row.RattsligHanvisning.length > 0;
  if (hasCore && hasContext) return "HIGH";
  if (hasCore) return "MEDIUM";
  return "LOW";
}

function toCsvCell(value: string): string {
  const clean = (value || "").replace(/\r?\n/g, " ").trim();
  if (clean.includes(";") || clean.includes('"')) {
    return `"${clean.replace(/"/g, '""')}"`;
  }
  return clean;
}

function toCsv(headers: readonly string[], rows: GenericRow[]): string {
  const lines = [headers.join(";")];
  for (const row of rows) {
    lines.push(headers.map((header) => toCsvCell(row[header] || "")).join(";"));
  }
  return `${lines.join("\n")}\n`;
}

async function writeCsv(outputPath: string, headers: readonly string[], rows: GenericRow[]) {
  const csv = toCsv(headers, rows);
  await fs.writeFile(outputPath, csv, "utf8");
}

function toPdfViewUrl(baseUrl: string, documentId: string): string {
  const encodedDocumentId = encodeURIComponent(documentId);
  return `${baseUrl}/api/admin/requirements/documents/${encodedDocumentId}/view`;
}

function toExcelHyperlinkFormulaSv(url: string): string {
  const safe = url.replace(/"/g, '""');
  return `=HYPERLÄNK("${safe}";"Öppna PDF")`;
}

function toExcelHyperlinkFormulaEn(url: string): string {
  const safe = url.replace(/"/g, '""');
  return `=HYPERLINK("${safe}","Open PDF")`;
}

async function main() {
  const options = parseModelOptions(process.argv);
  const dump = options.inputPath ? await readDumpFromFile(options.inputPath) : await readDumpFromDb();

  const rows = buildRows(dump, {
    inputPath: options.inputPath,
    outputPath: "kravmatris_mellanlagring_autofylld.csv",
    maxPerDocument: options.maxPerDocument,
    limitDocs: options.limitDocs,
    projectId: options.projectId,
    projectNameIncludes: options.projectNameIncludes,
  });

  const casesByKey = new Map<string, GenericRow>();
  const requirementRows: GenericRow[] = [];
  const citationRows: GenericRow[] = [];
  let citationCounter = 1;

  for (const row of rows) {
    const pdfViewUrl = toPdfViewUrl(options.pdfBaseUrl, row._documentId);
    const pdfOpenLinkSv = toExcelHyperlinkFormulaSv(pdfViewUrl);
    const pdfOpenLinkEn = toExcelHyperlinkFormulaEn(pdfViewUrl);

    if (!casesByKey.has(row._caseKey)) {
      casesByKey.set(row._caseKey, {
        CaseId: row.CaseId,
        DocumentId: row._documentId,
        PdfViewUrl: pdfViewUrl,
        PdfOpenLinkSv: pdfOpenLinkSv,
        PdfOpenLinkEn: pdfOpenLinkEn,
        ProjectId: row._projectId,
        OrganisationId: row._organisationId,
        Kommun: row.Kommun,
        Myndighetstyp: row.Myndighetstyp,
        Myndighet: row.Myndighet,
        Diarienummer: row.Diarienummer,
        Dokumenttyp: row.Dokumenttyp,
        Dokumentdatum: row.Dokumentdatum,
        KallaFil: row.KallaFil,
        Kallrubrik: row._subject,
        CaseReviewStatus: "AUTO",
        ValidatedBy: "",
        ValidatedAt: "",
        Notes: "AUTO_GENERERAD. Bekrafta metadata mot kallfil.",
      });
    }

    requirementRows.push({
      RequirementId: row.KravId,
      CaseId: row.CaseId,
      DocumentId: row._documentId,
      PdfViewUrl: pdfViewUrl,
      PdfOpenLinkSv: pdfOpenLinkSv,
      PdfOpenLinkEn: pdfOpenLinkEn,
      ProjectId: row._projectId,
      KravkallaTyp: row.KravkallaTyp,
      Kravkategori: row.Kravkategori,
      Kravsubkategori: row.Kravsubkategori,
      KravtextCitat: row.KravtextCitat,
      TolkadKravtext: row.TolkadKravtext,
      Kravniva: row.Kravniva,
      RattsligHanvisning: row.RattsligHanvisning,
      Tidsfrist: row.Tidsfrist,
      Kontrollfrekvens: row.Kontrollfrekvens,
      SanktionEllerKonsekvens: row.SanktionEllerKonsekvens,
      UtlosandeVillkor: row.UtlosandeVillkor,
      Avfallsslag: row.Avfallsslag,
      EWC: row.EWC,
      MaxMangdTon: row.MaxMangdTon,
      MaxLagringstid: row.MaxLagringstid,
      KopplingKonstruktion: row.KopplingKonstruktion,
      KopplingLakvatten: row.KopplingLakvatten,
      KopplingKontrollprogram: row.KopplingKontrollprogram,
      KopplingRisk: row.KopplingRisk,
      Mallavsnitt: row.Mallavsnitt,
      KommunBlankettFalt: row.KommunBlankettFalt,
      BilagaSomStods: row.BilagaSomStods,
      MinimikravJaNej: row.MinimikravJaNej,
      KommunspecifiktJaNej: row.KommunspecifiktJaNej,
      StatusIAnmalan: row.StatusIAnmalan,
      Kommentar: row.Kommentar,
      Kodningssakerhet: toConfidence(row),
      Verifieringsstatus: "AUTO",
      VerifieradJaNej: "Nej",
      VerifieradAv: "",
      VerifieradDatum: "",
      Feltyp: "",
      ValideringsKommentar: "",
    });

    citationRows.push({
      CitationId: `CIT-AUTO-${String(citationCounter).padStart(6, "0")}`,
      RequirementId: row.KravId,
      CaseId: row.CaseId,
      DocumentId: row._documentId,
      PdfViewUrl: pdfViewUrl,
      PdfOpenLinkSv: pdfOpenLinkSv,
      PdfOpenLinkEn: pdfOpenLinkEn,
      QuoteText: row.KravtextCitat,
      PageNumber: "",
      CharStart: "",
      CharEnd: "",
      Extractor: "heuristics-v1",
      VerifieradJaNej: "Nej",
      VerifieradAv: "",
      VerifieradDatum: "",
      Kommentar: "",
    });
    citationCounter += 1;
  }

  const caseRows = [...casesByKey.values()];
  const totalRows = rows.length;
  const requirementVerified = requirementRows.filter((row) => row.VerifieradJaNej === "Ja").length;
  const municipalityCoverage = caseRows.filter((row) => row.Kommun.trim().length > 0).length;
  const authorityCoverage = caseRows.filter((row) => row.Myndighet.trim().length > 0).length;

  const summary = {
    generatedAt: new Date().toISOString(),
    totals: {
      cases: caseRows.length,
      requirements: requirementRows.length,
      citations: citationRows.length,
    },
    quality: {
      municipalityCoveragePct: caseRows.length > 0 ? Number(((municipalityCoverage / caseRows.length) * 100).toFixed(1)) : 0,
      authorityCoveragePct: caseRows.length > 0 ? Number(((authorityCoverage / caseRows.length) * 100).toFixed(1)) : 0,
      verifiedRequirementsPct: totalRows > 0 ? Number(((requirementVerified / totalRows) * 100).toFixed(1)) : 0,
    },
    reviewRules: {
      useOnlyVerifiedRowsForFinalAnalysis: true,
      criticalCategoriesRequireDoubleReview: ["Ytkonstruktion", "DagvattenLakvatten"],
      mandatoryManualFields: ["Kommun", "Myndighet", "VerifieradJaNej", "VerifieradAv", "VerifieradDatum"],
    },
  };

  const outputDir = path.resolve(process.cwd(), options.outputDir);
  await fs.mkdir(outputDir, { recursive: true });

  const casesPath = path.join(outputDir, "requirement_cases.csv");
  const requirementsPath = path.join(outputDir, "requirement_rows.csv");
  const citationsPath = path.join(outputDir, "requirement_citations.csv");
  const summaryPath = path.join(outputDir, "requirement_summary.json");

  await Promise.all([
    writeCsv(casesPath, CASE_HEADERS, caseRows),
    writeCsv(requirementsPath, REQUIREMENT_HEADERS, requirementRows),
    writeCsv(citationsPath, CITATION_HEADERS, citationRows),
    fs.writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8"),
  ]);

  console.log(
    [
      `Klar. Skrev normaliserat underlag till: ${outputDir}`,
      `- Cases: ${caseRows.length}`,
      `- Requirements: ${requirementRows.length}`,
      `- Citations: ${citationRows.length}`,
      `- Summary: ${summaryPath}`,
      `- Municipality coverage: ${asInt(municipalityCoverage > 0)} (${summary.quality.municipalityCoveragePct}%)`,
    ].join("\n")
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
