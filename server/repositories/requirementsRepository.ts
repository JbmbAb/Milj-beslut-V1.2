import { prisma } from "../db/prisma";

const db = prisma as any;

export type RequirementVerificationStatus = "AUTO" | "REVIEWED" | "VERIFIED" | "REJECTED";
export type RequirementCaseReviewStatus = "AUTO" | "NEEDS_REVIEW" | "VERIFIED" | "LOCKED";

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
  organisationId: string;
  projectId?: string;
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

function mapCaseReviewStatusToVerificationStatus(
  caseReviewStatus: RequirementCaseReviewStatus
): RequirementVerificationStatus {
  switch (caseReviewStatus) {
    case "AUTO":
      return "AUTO";
    case "NEEDS_REVIEW":
      return "REVIEWED";
    case "VERIFIED":
    case "LOCKED":
      return "VERIFIED";
    default:
      return "AUTO";
  }
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

  // Enforce organisationId (MANDATORY)
  where.organisationId = input.organisationId;
  
  // Optional projectId filter
  if (input.projectId) {
    where.projectId = input.projectId;
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
  if (ewcCode) where.ewcCode = ewcCode;
  if (municipality || documentType) {
    where.case = {
      ...(municipality ? { municipality: { contains: municipality, mode: "insensitive" } } : {}),
      ...(documentType ? { documentType } : {}),
    };
  }

  // Enforce organisationId via Project
  where.project = {
    organisationId: input.organisationId,
  };
  
  if (input.projectId) {
    where.projectId = input.projectId;
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

  // Enforce organisationId via Requirement -> Project
  where.requirement = {
    ...(where.requirement as Record<string, unknown> | undefined),
    project: {
      organisationId: input.organisationId,
    },
  };
  
  if (input.projectId) {
    where.requirement = {
      ...(where.requirement as Record<string, unknown> | undefined),
      projectId: input.projectId,
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

export async function getRequirementByCode(requirementCode: string, organisationId: string) {
  return db.requirementRecord.findFirst({
    where: { 
      requirementCode,
      project: { organisationId }
    },
    include: {
      case: true,
      citations: true,
    },
  });
}

export async function getCitationByCode(citationCode: string, organisationId: string) {
  return db.requirementCitation.findFirst({
    where: { 
      citationCode,
      requirement: {
        project: { organisationId }
      }
    },
    include: {
      requirement: true,
      case: true,
    },
  });
}

export async function getRequirementCaseById(caseId: string, organisationId: string) {
  return db.requirementCase.findFirst({
    where: { 
      id: caseId,
      organisationId
    },
  });
}

export async function updateRequirementCaseReview(input: {
  caseId: string;
  organisationId: string;
  caseReviewStatus: RequirementCaseReviewStatus;
  validatedBy?: string | null;
  validatedAt?: Date | null;
  notes?: string | null;
}) {
  const requirementCase = await getRequirementCaseById(input.caseId, input.organisationId);
  if (!requirementCase) {
    throw new Error("Requirement case not found");
  }

  const normalizedValidatedBy = normalizeText(input.validatedBy);
  if (input.caseReviewStatus !== "AUTO" && !normalizedValidatedBy) {
    throw new Error("validatedBy is required when setting a manual case review status");
  }

  const nextValidatedAt =
    input.caseReviewStatus === "AUTO"
      ? null
      : input.validatedAt || new Date();

  return db.requirementCase.update({
    where: {
      id: requirementCase.id,
    },
    data: {
      caseReviewStatus: input.caseReviewStatus,
      reviewStatus: mapCaseReviewStatusToVerificationStatus(input.caseReviewStatus),
      validatedBy: normalizedValidatedBy || null,
      validatedAt: nextValidatedAt,
      notes: normalizeText(input.notes) || null,
    },
  });
}

export async function updateRequirementVerification(input: {
  requirementCode: string;
  organisationId: string;
  verificationStatus: RequirementVerificationStatus;
  verifiedBy?: string | null;
  verifiedAt?: Date | null;
  errorType?: string | null;
  validationComment?: string | null;
}) {
  const requirement = await getRequirementByCode(input.requirementCode, input.organisationId);
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
    where: {
      id: requirement.id,
    },
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
  organisationId: string;
  verificationStatus: RequirementVerificationStatus;
  verifiedBy?: string | null;
  verifiedAt?: Date | null;
  pageNumber?: number | null;
  charStart?: number | null;
  charEnd?: number | null;
  comment?: string | null;
}) {
  const citation = await getCitationByCode(input.citationCode, input.organisationId);
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
    where: {
      id: citation.id,
    },
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

export async function getDocumentById(documentId: string, organisationId: string) {
  return db.documentRecord.findFirst({
    where: { 
      id: documentId,
      organisationId
    },
    select: {
      id: true,
      originalName: true,
      absolutePath: true,
      mimeType: true,
    },
  });
}

export async function getRequirementReportRows(input: { 
  organisationId: string; 
  projectId?: string;
  includePreliminary?: boolean; 
}) {
  const includePreliminary = Boolean(input.includePreliminary);
  const where: any = includePreliminary
    ? {}
    : { verificationStatus: "VERIFIED" };
  
  where.project = { 
    organisationId: input.organisationId,
    ...(input.projectId ? { id: input.projectId } : {})
  };

  return db.requirementRecord.findMany({
    where,
    include: {
      case: true,
      citations: true,
    },
    orderBy: [{ createdAt: "asc" }],
  });
}

export async function getRequirementReportCases(
  caseIds: string[], 
  filter: { organisationId: string; projectId?: string }
) {
  if (!Array.isArray(caseIds) || caseIds.length === 0) return [];
  return db.requirementCase.findMany({
    where: { 
      id: { in: caseIds },
      organisationId: filter.organisationId,
      ...(filter.projectId ? { projectId: filter.projectId } : {})
    },
    orderBy: [{ documentDate: "asc" }, { createdAt: "asc" }],
  });
}

export async function getRequirementReportCitations(
  requirementIds: string[], 
  filter: { organisationId: string; projectId?: string }
) {
  if (!Array.isArray(requirementIds) || requirementIds.length === 0) return [];
  return db.requirementCitation.findMany({
    where: {
      requirementId: { in: requirementIds },
      verificationStatus: { in: ["REVIEWED", "VERIFIED"] },
      requirement: {
        project: { 
          organisationId: filter.organisationId,
          ...(filter.projectId ? { id: filter.projectId } : {})
        }
      }
    },
    orderBy: [{ createdAt: "asc" }],
  });
}
