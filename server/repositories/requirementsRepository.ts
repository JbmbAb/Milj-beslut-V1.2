import { prisma } from "../db/prisma";

const db = prisma as any;

export type RequirementVerificationStatus = "AUTO" | "REVIEWED" | "VERIFIED" | "REJECTED";

export interface PaginationInput {
  page?: number;
  pageSize?: number;
}

export interface RequirementsFilterInput extends PaginationInput {
  municipality?: string;
  documentType?: string;
  category?: string;
  ewcCode?: string;
  caseId?: string;
  requirementCode?: string;
  verificationStatus?: RequirementVerificationStatus;
  includePreliminary?: boolean;
}

function normalizeText(value?: string): string | undefined {
  const normalized = String(value || "").trim();
  return normalized || undefined;
}

function normalizePagination(input?: PaginationInput) {
  const page = Math.max(1, Number(input?.page || 1));
  const pageSize = Math.max(1, Math.min(200, Number(input?.pageSize || 25)));
  const skip = (page - 1) * pageSize;
  return { page, pageSize, skip, take: pageSize };
}

function caseWhere(input: RequirementsFilterInput): Record<string, unknown> {
  const where: Record<string, unknown> = {};
  const municipality = normalizeText(input.municipality);
  const documentType = normalizeText(input.documentType);
  const verificationStatus = normalizeText(input.verificationStatus) as RequirementVerificationStatus | undefined;

  if (municipality) {
    where.municipality = { contains: municipality, mode: "insensitive" };
  }
  if (documentType) {
    where.documentType = documentType;
  }
  if (verificationStatus) {
    where.reviewStatus = verificationStatus;
  }

  return where;
}

function requirementWhere(input: RequirementsFilterInput): Record<string, unknown> {
  const where: Record<string, unknown> = {};
  const caseId = normalizeText(input.caseId);
  const requirementCode = normalizeText(input.requirementCode);
  const category = normalizeText(input.category);
  const ewcCode = normalizeText(input.ewcCode);
  const verificationStatus = normalizeText(input.verificationStatus) as RequirementVerificationStatus | undefined;
  const municipality = normalizeText(input.municipality);
  const documentType = normalizeText(input.documentType);
  const includePreliminary = Boolean(input.includePreliminary);

  if (!includePreliminary && !verificationStatus) {
    where.verificationStatus = "VERIFIED";
  } else if (verificationStatus) {
    where.verificationStatus = verificationStatus;
  }

  if (caseId) where.caseId = caseId;
  if (requirementCode) where.requirementCode = requirementCode;
  if (category) where.category = category;
  if (ewcCode) where.ewcCode = { contains: ewcCode, mode: "insensitive" };
  if (municipality || documentType) {
    where.case = {
      ...(municipality ? { municipality: { contains: municipality, mode: "insensitive" } } : {}),
      ...(documentType ? { documentType } : {}),
    };
  }

  return where;
}

function citationWhere(input: RequirementsFilterInput): Record<string, unknown> {
  const where: Record<string, unknown> = {};
  const requirementCode = normalizeText(input.requirementCode);
  const verificationStatus = normalizeText(input.verificationStatus) as RequirementVerificationStatus | undefined;
  const includePreliminary = Boolean(input.includePreliminary);

  if (!includePreliminary && !verificationStatus) {
    where.requirement = {
      verificationStatus: "VERIFIED",
    };
  }
  if (verificationStatus) {
    where.verificationStatus = verificationStatus;
  }
  if (requirementCode) {
    where.requirement = {
      ...(where.requirement as Record<string, unknown> | undefined),
      requirementCode,
    };
  }

  return where;
}

export async function listRequirementCases(input: RequirementsFilterInput) {
  const { page, pageSize, skip, take } = normalizePagination(input);
  const where = caseWhere(input);

  const [total, items] = await Promise.all([
    db.requirementCase.count({ where }),
    db.requirementCase.findMany({
      where,
      orderBy: [{ documentDate: "desc" }, { createdAt: "desc" }],
      skip,
      take,
    }),
  ]);

  return { items, total, page, pageSize };
}

export async function listRequirementRows(input: RequirementsFilterInput) {
  const { page, pageSize, skip, take } = normalizePagination(input);
  const where = requirementWhere(input);

  const [total, items] = await Promise.all([
    db.requirementRecord.count({ where }),
    db.requirementRecord.findMany({
      where,
      include: {
        case: true,
      },
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
      skip,
      take,
    }),
  ]);

  return { items, total, page, pageSize };
}

export async function listRequirementCitations(input: RequirementsFilterInput) {
  const { page, pageSize, skip, take } = normalizePagination(input);
  const where = citationWhere(input);

  const [total, items] = await Promise.all([
    db.requirementCitation.count({ where }),
    db.requirementCitation.findMany({
      where,
      include: {
        requirement: true,
        case: true,
      },
      orderBy: [{ createdAt: "desc" }],
      skip,
      take,
    }),
  ]);

  return { items, total, page, pageSize };
}

export async function getRequirementByCode(requirementCode: string) {
  return db.requirementRecord.findUnique({
    where: { requirementCode },
    include: {
      case: true,
      citations: true,
    },
  });
}

export async function getCitationByCode(citationCode: string) {
  return db.requirementCitation.findUnique({
    where: { citationCode },
    include: {
      requirement: true,
      case: true,
    },
  });
}

export async function updateRequirementVerification(input: {
  requirementCode: string;
  verificationStatus: RequirementVerificationStatus;
  verifiedBy?: string | null;
  verifiedAt?: Date | null;
  errorType?: string | null;
  validationComment?: string | null;
}) {
  const requirement = await getRequirementByCode(input.requirementCode);
  if (!requirement) {
    throw new Error("Requirement not found");
  }

  if (input.verificationStatus === "VERIFIED") {
    const missingReviewer = !normalizeText(input.verifiedBy);
    if (missingReviewer) {
      throw new Error("verifiedBy is required when setting VERIFIED");
    }
    const hasValidCitation = Array.isArray(requirement.citations)
      ? requirement.citations.every((citation: { verificationStatus: RequirementVerificationStatus }) =>
          citation.verificationStatus === "VERIFIED" || citation.verificationStatus === "REVIEWED"
        )
      : false;
    if (!hasValidCitation) {
      throw new Error("All citations must be REVIEWED or VERIFIED before requirement can be VERIFIED");
    }
  }

  const nextVerifiedAt =
    input.verificationStatus === "VERIFIED"
      ? input.verifiedAt || new Date()
      : input.verifiedAt || null;

  return db.requirementRecord.update({
    where: { requirementCode: input.requirementCode },
    data: {
      verificationStatus: input.verificationStatus,
      verifiedBy: normalizeText(input.verifiedBy) || null,
      verifiedAt: nextVerifiedAt,
      errorType: normalizeText(input.errorType) || null,
      validationComment: normalizeText(input.validationComment) || null,
    },
    include: {
      case: true,
      citations: true,
    },
  });
}

export async function updateCitationVerification(input: {
  citationCode: string;
  verificationStatus: RequirementVerificationStatus;
  verifiedBy?: string | null;
  verifiedAt?: Date | null;
  pageNumber?: number | null;
  charStart?: number | null;
  charEnd?: number | null;
  comment?: string | null;
}) {
  const citation = await getCitationByCode(input.citationCode);
  if (!citation) {
    throw new Error("Citation not found");
  }

  if (input.verificationStatus === "VERIFIED") {
    const verifiedBy = normalizeText(input.verifiedBy);
    const nextComment = normalizeText(input.comment) || normalizeText(citation.comment);
    const nextPageNumber =
      typeof input.pageNumber === "number"
        ? input.pageNumber
        : typeof citation.pageNumber === "number"
          ? citation.pageNumber
          : null;

    if (!verifiedBy) {
      throw new Error("verifiedBy is required when setting VERIFIED");
    }
    if (nextPageNumber == null && !nextComment) {
      throw new Error("pageNumber or comment is required when setting VERIFIED");
    }
  }

  const nextVerifiedAt =
    input.verificationStatus === "VERIFIED"
      ? input.verifiedAt || new Date()
      : input.verifiedAt || null;

  return db.requirementCitation.update({
    where: { citationCode: input.citationCode },
    data: {
      verificationStatus: input.verificationStatus,
      verifiedBy: normalizeText(input.verifiedBy) || null,
      verifiedAt: nextVerifiedAt,
      pageNumber:
        typeof input.pageNumber === "number"
          ? input.pageNumber
          : input.pageNumber === null
            ? null
            : undefined,
      charStart:
        typeof input.charStart === "number"
          ? input.charStart
          : input.charStart === null
            ? null
            : undefined,
      charEnd:
        typeof input.charEnd === "number"
          ? input.charEnd
          : input.charEnd === null
            ? null
            : undefined,
      comment:
        input.comment == null
          ? undefined
          : normalizeText(input.comment) || null,
    },
    include: {
      requirement: true,
      case: true,
    },
  });
}

export async function getDocumentById(documentId: string) {
  return db.documentRecord.findUnique({
    where: { id: documentId },
    select: {
      id: true,
      originalName: true,
      absolutePath: true,
      mimeType: true,
    },
  });
}

export async function getRequirementReportRows(input?: { includePreliminary?: boolean }) {
  const includePreliminary = Boolean(input?.includePreliminary);
  const where = includePreliminary
    ? {}
    : { verificationStatus: "VERIFIED" };

  return db.requirementRecord.findMany({
    where,
    include: {
      case: true,
      citations: true,
    },
    orderBy: [{ createdAt: "asc" }],
  });
}

export async function getRequirementReportCases(caseIds: string[]) {
  if (!Array.isArray(caseIds) || caseIds.length === 0) return [];
  return db.requirementCase.findMany({
    where: { id: { in: caseIds } },
    orderBy: [{ documentDate: "asc" }, { createdAt: "asc" }],
  });
}

export async function getRequirementReportCitations(requirementIds: string[]) {
  if (!Array.isArray(requirementIds) || requirementIds.length === 0) return [];
  return db.requirementCitation.findMany({
    where: {
      requirementId: { in: requirementIds },
      verificationStatus: { in: ["REVIEWED", "VERIFIED"] },
    },
    orderBy: [{ createdAt: "asc" }],
  });
}
