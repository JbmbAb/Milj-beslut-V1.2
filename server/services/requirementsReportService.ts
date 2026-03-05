import { PassThrough } from "node:stream";
import { Buffer } from "node:buffer";
import path from "node:path";
import { Document, HeadingLevel, Packer, Paragraph, Table, TableCell, TableRow, TextRun, WidthType } from "docx";
import yazl from "yazl";
import {
  getRequirementReportCases,
  getRequirementReportCitations,
  getRequirementReportRows,
} from "../repositories/requirementsRepository";

type RequirementWithRelations = Awaited<ReturnType<typeof getRequirementReportRows>>[number];
type RequirementCase = Awaited<ReturnType<typeof getRequirementReportCases>>[number];
type RequirementCitation = Awaited<ReturnType<typeof getRequirementReportCitations>>[number];

export interface RequirementsReportSummary {
  generatedAt: string;
  scope: "VERIFIED_ONLY" | "INCLUDE_PRELIMINARY";
  warning: string | null;
  totals: {
    requirements: number;
    cases: number;
    citations: number;
    verifiedRequirements: number;
    excludedRequirements: number;
  };
  quality: {
    municipalityCoveragePct: number;
    authorityCoveragePct: number;
    verifiedRequirementsPct: number;
    rejectedRequirements: number;
  };
  tableA: Array<{
    authorityType: string;
    authorityName: string;
    documentType: string;
    caseCount: number;
  }>;
  tableB: Array<{
    category: string;
    requirementCount: number;
  }>;
  tableC: Array<{
    municipality: string;
    ytkonstruktion: number;
    dagvattenLakvatten: number;
  }>;
  tableD: Array<{
    wasteType: string;
    ewcCode: string;
    requirementCount: number;
  }>;
}

function asPct(part: number, total: number): number {
  if (!total) return 0;
  return Number(((part / total) * 100).toFixed(1));
}

function normalize(value: unknown): string {
  const text = String(value || "").trim();
  return text;
}

function toCsvCell(value: string): string {
  const clean = String(value || "").replace(/\r?\n/g, " ").trim();
  if (clean.includes(";") || clean.includes('"')) {
    return `"${clean.replace(/"/g, '""')}"`;
  }
  return clean;
}

function csvFromRows(rows: Array<Record<string, unknown>>, headers: string[]): string {
  const lines = [headers.join(";")];
  for (const row of rows) {
    lines.push(headers.map((header) => toCsvCell(String(row[header] ?? ""))).join(";"));
  }
  return `${lines.join("\n")}\n`;
}

function toTableRows(headers: string[], rows: Array<Record<string, unknown>>, maxRows: number = 20): TableRow[] {
  const headerRow = new TableRow({
    children: headers.map(
      (header) =>
        new TableCell({
          children: [new Paragraph({ children: [new TextRun({ text: header, bold: true })] })],
        })
    ),
  });

  const bodyRows = rows.slice(0, maxRows).map(
    (row) =>
      new TableRow({
        children: headers.map(
          (header) =>
            new TableCell({
              children: [new Paragraph(String(row[header] ?? ""))],
            })
        ),
      })
  );

  return [headerRow, ...bodyRows];
}

export async function buildRequirementsReportSummary(input?: {
  includePreliminary?: boolean;
}): Promise<{
  summary: RequirementsReportSummary;
  requirements: RequirementWithRelations[];
  cases: RequirementCase[];
  citations: RequirementCitation[];
}> {
  const includePreliminary = Boolean(input?.includePreliminary);
  const requirements = await getRequirementReportRows({ includePreliminary });
  const allRequirements = includePreliminary
    ? requirements
    : await getRequirementReportRows({ includePreliminary: true });
  const caseIds: string[] = Array.from(
    new Set(
      (requirements as Array<{ caseId?: string }>)
        .map((row) => String(row.caseId || ""))
        .filter((value) => value.length > 0)
    )
  );
  const requirementIds: string[] = Array.from(
    new Set(
      (requirements as Array<{ id?: string }>)
        .map((row) => String(row.id || ""))
        .filter((value) => value.length > 0)
    )
  );
  const [cases, citations] = await Promise.all([
    getRequirementReportCases(caseIds),
    getRequirementReportCitations(requirementIds),
  ]);

  const totalRequirements = requirements.length;
  const verifiedRequirements = allRequirements.filter((row) => row.verificationStatus === "VERIFIED").length;
  const rejectedRequirements = requirements.filter((row) => row.verificationStatus === "REJECTED").length;
  const excludedRequirements = includePreliminary ? 0 : Math.max(0, allRequirements.length - requirements.length);
  const municipalityCoverage = cases.filter((row) => normalize(row.municipality).length > 0).length;
  const authorityCoverage = cases.filter((row) => normalize(row.authorityName).length > 0).length;

  const tableAMap = new Map<string, number>();
  for (const row of cases) {
    const authorityType = normalize(row.authorityType) || "Okand";
    const authorityName = normalize(row.authorityName) || "Okand";
    const documentType = normalize(row.documentType) || "Okand";
    const key = `${authorityType}|${authorityName}|${documentType}`;
    tableAMap.set(key, (tableAMap.get(key) || 0) + 1);
  }
  const tableA = [...tableAMap.entries()]
    .map(([key, caseCount]) => {
      const [authorityType, authorityName, documentType] = key.split("|");
      return { authorityType, authorityName, documentType, caseCount };
    })
    .sort((a, b) => b.caseCount - a.caseCount || a.authorityName.localeCompare(b.authorityName));

  const tableBMap = new Map<string, number>();
  for (const row of requirements) {
    const category = normalize(row.category) || "Okand";
    tableBMap.set(category, (tableBMap.get(category) || 0) + 1);
  }
  const tableB = [...tableBMap.entries()]
    .map(([category, requirementCount]) => ({ category, requirementCount }))
    .sort((a, b) => b.requirementCount - a.requirementCount || a.category.localeCompare(b.category));

  const tableCMap = new Map<string, { ytkonstruktion: number; dagvattenLakvatten: number }>();
  for (const row of requirements) {
    const municipality = normalize(row.case?.municipality) || "Okand";
    const category = normalize(row.category);
    const bucket = tableCMap.get(municipality) || { ytkonstruktion: 0, dagvattenLakvatten: 0 };
    if (category === "Ytkonstruktion") bucket.ytkonstruktion += 1;
    if (category === "DagvattenLakvatten") bucket.dagvattenLakvatten += 1;
    tableCMap.set(municipality, bucket);
  }
  const tableC = [...tableCMap.entries()]
    .map(([municipality, bucket]) => ({
      municipality,
      ytkonstruktion: bucket.ytkonstruktion,
      dagvattenLakvatten: bucket.dagvattenLakvatten,
    }))
    .filter((row) => row.ytkonstruktion > 0 || row.dagvattenLakvatten > 0)
    .sort(
      (a, b) =>
        b.ytkonstruktion + b.dagvattenLakvatten - (a.ytkonstruktion + a.dagvattenLakvatten) ||
        a.municipality.localeCompare(b.municipality)
    );

  const tableDMap = new Map<string, number>();
  for (const row of requirements) {
    const wasteType = normalize(row.wasteType) || "Okand";
    const ewcCode = normalize(row.ewcCode) || "Okand";
    const key = `${wasteType}|${ewcCode}`;
    tableDMap.set(key, (tableDMap.get(key) || 0) + 1);
  }
  const tableD = [...tableDMap.entries()]
    .map(([key, requirementCount]) => {
      const [wasteType, ewcCode] = key.split("|");
      return { wasteType, ewcCode, requirementCount };
    })
    .sort((a, b) => b.requirementCount - a.requirementCount || a.wasteType.localeCompare(b.wasteType));

  const warning = includePreliminary
    ? "Varning: preliminara rader ingar i underlaget. Slutrapport ska baseras pa VERIFIED."
    : null;

  const summary: RequirementsReportSummary = {
    generatedAt: new Date().toISOString(),
    scope: includePreliminary ? "INCLUDE_PRELIMINARY" : "VERIFIED_ONLY",
    warning,
    totals: {
      requirements: requirements.length,
      cases: cases.length,
      citations: citations.length,
      verifiedRequirements,
      excludedRequirements,
    },
    quality: {
      municipalityCoveragePct: asPct(municipalityCoverage, cases.length),
      authorityCoveragePct: asPct(authorityCoverage, cases.length),
      verifiedRequirementsPct: asPct(verifiedRequirements, allRequirements.length),
      rejectedRequirements,
    },
    tableA,
    tableB,
    tableC,
    tableD,
  };

  return { summary, requirements, cases, citations };
}

function caseRowsToExport(rows: RequirementCase[]) {
  return rows.map((row) => ({
    CaseId: row.caseKey,
    DocumentId: row.documentId,
    ProjectId: row.projectId,
    OrganisationId: row.organisationId,
    Kommun: row.municipality || "",
    Myndighetstyp: row.authorityType || "",
    Myndighet: row.authorityName || "",
    Diarienummer: row.diarienummer || "",
    Dokumenttyp: row.documentType || "",
    Dokumentdatum: row.documentDate ? new Date(row.documentDate).toISOString().slice(0, 10) : "",
    KallaFil: row.sourceFile,
    Kallrubrik: row.sourceSubject || "",
    ReviewStatus: row.reviewStatus,
    ValidatedBy: row.validatedBy || "",
    ValidatedAt: row.validatedAt ? new Date(row.validatedAt).toISOString() : "",
    Notes: row.notes || "",
  }));
}

function requirementRowsToExport(rows: RequirementWithRelations[]) {
  return rows.map((row) => ({
    RequirementId: row.requirementCode,
    CaseId: row.case?.caseKey || "",
    DocumentId: row.documentId,
    ProjectId: row.projectId,
    Kravkategori: row.category,
    Kravsubkategori: row.subcategory,
    Kravniva: row.level,
    RattsligHanvisning: row.legalReference || "",
    KravtextCitat: row.requirementTextQuote,
    TolkadKravtext: row.interpretedRequirement,
    Avfallsslag: row.wasteType || "",
    EWC: row.ewcCode || "",
    VerificationStatus: row.verificationStatus,
    VerifiedBy: row.verifiedBy || "",
    VerifiedAt: row.verifiedAt ? new Date(row.verifiedAt).toISOString() : "",
    ValidationComment: row.validationComment || "",
  }));
}

function citationRowsToExport(rows: RequirementCitation[]) {
  return rows.map((row) => ({
    CitationId: row.citationCode,
    RequirementId: row.requirementId,
    CaseId: row.caseId,
    DocumentId: row.documentId,
    QuoteText: row.quoteText,
    PageNumber: row.pageNumber ?? "",
    CharStart: row.charStart ?? "",
    CharEnd: row.charEnd ?? "",
    VerificationStatus: row.verificationStatus,
    VerifiedBy: row.verifiedBy || "",
    VerifiedAt: row.verifiedAt ? new Date(row.verifiedAt).toISOString() : "",
    Comment: row.comment || "",
  }));
}

export async function buildRequirementsExportCsvZip(input?: { includePreliminary?: boolean }) {
  const { summary, requirements, cases, citations } = await buildRequirementsReportSummary(input);
  const caseRows = caseRowsToExport(cases);
  const requirementRows = requirementRowsToExport(requirements);
  const citationRows = citationRowsToExport(citations);

  const zip = new yazl.ZipFile();
  zip.addBuffer(
    Buffer.from(
      csvFromRows(caseRows, [
        "CaseId",
        "DocumentId",
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
        "ReviewStatus",
        "ValidatedBy",
        "ValidatedAt",
        "Notes",
      ]),
      "utf8"
    ),
    "cases.csv"
  );
  zip.addBuffer(
    Buffer.from(
      csvFromRows(requirementRows, [
        "RequirementId",
        "CaseId",
        "DocumentId",
        "ProjectId",
        "Kravkategori",
        "Kravsubkategori",
        "Kravniva",
        "RattsligHanvisning",
        "KravtextCitat",
        "TolkadKravtext",
        "Avfallsslag",
        "EWC",
        "VerificationStatus",
        "VerifiedBy",
        "VerifiedAt",
        "ValidationComment",
      ]),
      "utf8"
    ),
    "requirements_verified.csv"
  );
  zip.addBuffer(
    Buffer.from(
      csvFromRows(citationRows, [
        "CitationId",
        "RequirementId",
        "CaseId",
        "DocumentId",
        "QuoteText",
        "PageNumber",
        "CharStart",
        "CharEnd",
        "VerificationStatus",
        "VerifiedBy",
        "VerifiedAt",
        "Comment",
      ]),
      "utf8"
    ),
    "citations_verified.csv"
  );
  zip.addBuffer(Buffer.from(`${JSON.stringify(summary, null, 2)}\n`, "utf8"), "summary.json");
  zip.end();

  const stream = new PassThrough();
  zip.outputStream.pipe(stream);
  return stream;
}

export async function buildRequirementsDocxBuffer(input?: { includePreliminary?: boolean }) {
  const { summary } = await buildRequirementsReportSummary(input);

  const doc = new Document({
    sections: [
      {
        children: [
          new Paragraph({
            heading: HeadingLevel.TITLE,
            text: "Examensrapportutkast - Kravanalys mellanlagringsplattor",
          }),
          new Paragraph(`Genererad: ${new Date(summary.generatedAt).toLocaleString("sv-SE")}`),
          new Paragraph(`Scope: ${summary.scope}`),
          ...(summary.warning ? [new Paragraph({ children: [new TextRun({ text: summary.warning, bold: true })] })] : []),
          new Paragraph({ heading: HeadingLevel.HEADING_1, text: "Metod och avgransning" }),
          new Paragraph("Datakalla: normaliserad kravmodell (RequirementCase/RequirementRecord/RequirementCitation)."),
          new Paragraph("Verifieringspolicy: endast VERIFIED-rader ingar i rapportresultat som standard."),
          new Paragraph({ heading: HeadingLevel.HEADING_1, text: "Kvalitetsmatning" }),
          new Paragraph(`Totalt kravrader: ${summary.totals.requirements}`),
          new Paragraph(`Verifierade kravrader: ${summary.totals.verifiedRequirements}`),
          new Paragraph(`Kommuntackning: ${summary.quality.municipalityCoveragePct}%`),
          new Paragraph(`Myndighetstackning: ${summary.quality.authorityCoveragePct}%`),
          new Paragraph({ heading: HeadingLevel.HEADING_1, text: "Resultat - Tabell A (arenden per myndighet/dokumenttyp)" }),
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: toTableRows(["authorityType", "authorityName", "documentType", "caseCount"], summary.tableA),
          }),
          new Paragraph({ heading: HeadingLevel.HEADING_1, text: "Resultat - Tabell B (kravfrekvens per kategori)" }),
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: toTableRows(["category", "requirementCount"], summary.tableB),
          }),
          new Paragraph({ heading: HeadingLevel.HEADING_1, text: "Resultat - Tabell C (kommunskillnader)" }),
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: toTableRows(["municipality", "ytkonstruktion", "dagvattenLakvatten"], summary.tableC),
          }),
          new Paragraph({ heading: HeadingLevel.HEADING_1, text: "Resultat - Tabell D (krav per avfallsslag/EWC)" }),
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: toTableRows(["wasteType", "ewcCode", "requirementCount"], summary.tableD),
          }),
          new Paragraph({ heading: HeadingLevel.HEADING_1, text: "Bilaga" }),
          new Paragraph("Exportmetadata och auditreferens hanteras i separat CSV/JSON-paket."),
        ],
      },
    ],
  });

  return Packer.toBuffer(doc);
}

export function exportFilename(prefix: string, extension: string): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const safePrefix = path.basename(prefix).replace(/[^a-zA-Z0-9-_]/g, "-");
  return `${safePrefix}-${timestamp}.${extension}`;
}
