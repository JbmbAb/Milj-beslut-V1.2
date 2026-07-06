import express from 'express';
import { requireAuth } from '../security/auth';
import { rateLimitByUser } from '../security/rateLimit';
import { toSafeErrorResponse, SecureError } from '../security/secureErrors';
import {
  listRequirementCases,
  listRequirementRows,
  listRequirementCitations,
  updateRequirementCaseReview,
  updateRequirementVerification,
  updateCitationVerification,
} from '../modules/requirements/public';
import {
  buildRequirementsDocxBuffer,
  buildRequirementsExportCsvZip,
  buildRequirementsReportPdfBuffer,
  buildRequirementsReportSummary,
  exportFilename,
} from '../modules/reports/requirements/public';
import { getDocumentById as getSearchDocumentById } from '../modules/search/public';
import { appendDomainAudit } from '../security/auditTrail';
import { auditRequirementChanged } from '../modules/audit/public';
import { createStorageReadStream, storageFileExists } from '../modules/documents/public';
import {
  parsePositiveInt,
  parseOptionalText,
  parseBooleanFlag,
  parseOptionalRequirementStatus,
  parseOptionalRequirementCaseReviewStatus,
} from '../utils/routeUtils';

const router = express.Router();

router.get('/api/admin/requirements/cases', requireAuth, rateLimitByUser(40, 60_000), async (req, res) => {
  try {
    if (!req.authUser || req.authUser.role !== 'ADMIN') {
      res.status(403).json({ ok: false, error: 'Admin role required' });
      return;
    }

    const page = parsePositiveInt(req.query?.page, 1, 1, 10_000);
    const pageSize = parsePositiveInt(req.query?.pageSize, 25, 1, 200);
    const payload = await listRequirementCases({
      page,
      pageSize,
      organisationId: req.authUser.organisationId,
      municipality: parseOptionalText(req.query?.municipality),
      documentType: parseOptionalText(req.query?.documentType),
      verificationStatus: parseOptionalRequirementStatus(req.query?.verificationStatus),
    });

    res.json({ ok: true, ...payload });
  } catch (error: unknown) {
    res.status(error instanceof SecureError ? error.statusCode : 500).json(toSafeErrorResponse(error));
  }
});

router.get('/api/admin/requirements/rows', requireAuth, rateLimitByUser(60, 60_000), async (req, res) => {
  try {
    if (!req.authUser || req.authUser.role !== 'ADMIN') {
      res.status(403).json({ ok: false, error: 'Admin role required' });
      return;
    }

    const page = parsePositiveInt(req.query?.page, 1, 1, 10_000);
    const pageSize = parsePositiveInt(req.query?.pageSize, 25, 1, 200);
    const includePreliminary = parseBooleanFlag(req.query?.includePreliminary, true);
    const payload = await listRequirementRows({
      page,
      pageSize,
      organisationId: req.authUser.organisationId,
      municipality: parseOptionalText(req.query?.municipality),
      documentType: parseOptionalText(req.query?.documentType),
      category: parseOptionalText(req.query?.category),
      caseId: parseOptionalText(req.query?.caseId),
      requirementCode: parseOptionalText(req.query?.requirementCode),
      verificationStatus: parseOptionalRequirementStatus(req.query?.verificationStatus),
      includePreliminary,
    });

    res.json({ ok: true, ...payload });
  } catch (error: unknown) {
    res.status(error instanceof SecureError ? error.statusCode : 500).json(toSafeErrorResponse(error));
  }
});

router.get(
  '/api/admin/requirements/citations',
  requireAuth,
  rateLimitByUser(60, 60_000),
  async (req, res) => {
    try {
      if (!req.authUser || req.authUser.role !== 'ADMIN') {
        res.status(403).json({ ok: false, error: 'Admin role required' });
        return;
      }

      const page = parsePositiveInt(req.query?.page, 1, 1, 10_000);
      const pageSize = parsePositiveInt(req.query?.pageSize, 25, 1, 200);
      const includePreliminary = parseBooleanFlag(req.query?.includePreliminary, true);
      const payload = await listRequirementCitations({
        page,
        pageSize,
        organisationId: req.authUser.organisationId,
        requirementCode: parseOptionalText(req.query?.requirementCode),
        verificationStatus: parseOptionalRequirementStatus(req.query?.verificationStatus),
        includePreliminary,
      });

      res.json({ ok: true, ...payload });
    } catch (error: unknown) {
      res.status(error instanceof SecureError ? error.statusCode : 500).json(toSafeErrorResponse(error));
    }
  },
);

router.patch(
  '/api/admin/requirements/cases/:caseId/review',
  requireAuth,
  rateLimitByUser(50, 60_000),
  async (req, res) => {
    try {
      if (!req.authUser || req.authUser.role !== 'ADMIN') {
        res.status(403).json({ ok: false, error: 'Admin role required' });
        return;
      }

      const caseId = String(req.params.caseId || '').trim();
      const caseReviewStatus = parseOptionalRequirementCaseReviewStatus(req.body?.caseReviewStatus);
      const validatedBy = parseOptionalText(req.body?.validatedBy);
      const notes = parseOptionalText(req.body?.notes);

      if (!caseId || !caseReviewStatus) {
        res.status(400).json({ ok: false, error: 'caseId and caseReviewStatus are required' });
        return;
      }
      if (caseReviewStatus !== 'AUTO' && !validatedBy) {
        res
          .status(400)
          .json({ ok: false, error: 'validatedBy is required when setting a manual case review status' });
        return;
      }

      const updated = await updateRequirementCaseReview({
        caseId,
        organisationId: req.authUser.organisationId,
        caseReviewStatus,
        validatedBy,
        notes,
        actorKind: 'user',
      });

      await appendDomainAudit({
        entityType: 'RequirementCase',
        entityId: updated.id,
        action: 'REQUIREMENT_CASE_REVIEW',
        userId: req.authUser.id,
        payload: {
          caseId: updated.id,
          caseKey: updated.caseKey,
          caseReviewStatus: updated.caseReviewStatus,
          reviewStatus: updated.reviewStatus,
          validatedBy: updated.validatedBy,
        },
      });

      res.json({ ok: true, case: updated });
    } catch (error: unknown) {
      res.status(error instanceof SecureError ? error.statusCode : 500).json(toSafeErrorResponse(error));
    }
  },
);

router.patch(
  '/api/admin/requirements/rows/:requirementCode/verify',
  requireAuth,
  rateLimitByUser(50, 60_000),
  async (req, res) => {
    try {
      if (!req.authUser || req.authUser.role !== 'ADMIN') {
        res.status(403).json({ ok: false, error: 'Admin role required' });
        return;
      }

      const requirementCode = String(req.params.requirementCode || '').trim();
      const verificationStatus = parseOptionalRequirementStatus(req.body?.verificationStatus);
      const verifiedBy = parseOptionalText(req.body?.verifiedBy);
      const validationComment = parseOptionalText(req.body?.validationComment);
      const errorType = parseOptionalText(req.body?.errorType);

      if (!requirementCode || !verificationStatus) {
        res.status(400).json({ ok: false, error: 'requirementCode and verificationStatus are required' });
        return;
      }

      const before = await listRequirementRows({
        page: 1,
        pageSize: 1,
        organisationId: req.authUser.organisationId,
        requirementCode,
        includePreliminary: true,
      });
      const beforeRow = before.items?.[0] ?? null;

      const updated = await updateRequirementVerification({
        requirementCode,
        organisationId: req.authUser.organisationId,
        verificationStatus,
        verifiedBy,
        validationComment,
        errorType,
        actorKind: 'user',
      });

      await appendDomainAudit({
        entityType: 'RequirementRecord',
        entityId: updated.id,
        action: 'REQUIREMENT_VERIFY',
        userId: req.authUser.id,
        payload: {
          requirementCode: updated.requirementCode,
          verificationStatus: updated.verificationStatus,
          verifiedBy: updated.verifiedBy,
        },
      });

      if (beforeRow) {
        await auditRequirementChanged({
          requirementId: updated.id,
          projectId: String((updated as any).projectId || beforeRow.projectId || 'unknown'),
          userId: req.authUser.id,
          change: 'STATUS',
          before: { verificationStatus: (beforeRow as any).verificationStatus },
          after: { verificationStatus: updated.verificationStatus },
        }).catch(() => undefined);
      }

      res.json({ ok: true, row: updated });
    } catch (error: unknown) {
      res.status(error instanceof SecureError ? error.statusCode : 500).json(toSafeErrorResponse(error));
    }
  },
);

router.patch(
  '/api/admin/requirements/citations/:citationCode/verify',
  requireAuth,
  rateLimitByUser(50, 60_000),
  async (req, res) => {
    try {
      if (!req.authUser || req.authUser.role !== 'ADMIN') {
        res.status(403).json({ ok: false, error: 'Admin role required' });
        return;
      }

      const citationCode = String(req.params.citationCode || '').trim();
      const verificationStatus = parseOptionalRequirementStatus(req.body?.verificationStatus);
      const verifiedBy = parseOptionalText(req.body?.verifiedBy);
      const comment = parseOptionalText(req.body?.comment);
      const pageNumber =
        req.body?.pageNumber == null || req.body?.pageNumber === ''
          ? undefined
          : parsePositiveInt(req.body?.pageNumber, 1, 1, 10_000);

      if (!citationCode || !verificationStatus) {
        res.status(400).json({ ok: false, error: 'citationCode and verificationStatus are required' });
        return;
      }

      const updated = await updateCitationVerification({
        citationCode,
        organisationId: req.authUser.organisationId,
        verificationStatus,
        verifiedBy,
        comment,
        pageNumber,
        actorKind: 'user',
      });

      await appendDomainAudit({
        entityType: 'RequirementCitation',
        entityId: updated.id,
        action: 'CITATION_VERIFY',
        userId: req.authUser.id,
        payload: {
          citationCode: updated.citationCode,
          verificationStatus: updated.verificationStatus,
          verifiedBy: updated.verifiedBy,
        },
      });

      res.json({ ok: true, citation: updated });
    } catch (error: unknown) {
      res.status(error instanceof SecureError ? error.statusCode : 500).json(toSafeErrorResponse(error));
    }
  },
);

router.get(
  '/api/admin/requirements/documents/:documentId/view',
  requireAuth,
  rateLimitByUser(50, 60_000),
  async (req, res) => {
    try {
      if (!req.authUser || req.authUser.role !== 'ADMIN') {
        res.status(403).json({ ok: false, error: 'Admin role required' });
        return;
      }

      const documentId = String(req.params.documentId || '').trim();
      if (!documentId) {
        res.status(400).json({ ok: false, error: 'documentId is required' });
        return;
      }

      const document = await getSearchDocumentById(documentId);
      if (!document || !document.absolutePath) {
        res.status(404).json({ ok: false, error: 'Document not found' });
        return;
      }
      if (!(await storageFileExists(document.absolutePath))) {
        res.status(404).json({ ok: false, error: 'Document file missing on server' });
        return;
      }

      await appendDomainAudit({
        entityType: 'DocumentRecord',
        entityId: document.id,
        action: 'REQUIREMENT_DOCUMENT_VIEW',
        userId: req.authUser.id,
        payload: {
          documentId: document.id,
          mimeType: document.mimeType || 'application/pdf',
        },
      });

      const stream = createStorageReadStream(document.absolutePath);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader(
        'Content-Disposition',
        `inline; filename="${encodeURIComponent(document.originalName || 'document.pdf')}"`,
      );
      stream.pipe(res);
    } catch (error: unknown) {
      res.status(error instanceof SecureError ? error.statusCode : 500).json(toSafeErrorResponse(error));
    }
  },
);

router.get(
  '/api/admin/requirements/reports/summary',
  requireAuth,
  rateLimitByUser(30, 60_000),
  async (req, res) => {
    try {
      if (!req.authUser || req.authUser.role !== 'ADMIN') {
        res.status(403).json({ ok: false, error: 'Admin role required' });
        return;
      }

      const includePreliminary = parseBooleanFlag(req.query?.includePreliminary, false);
      const payload = await buildRequirementsReportSummary({
        organisationId: req.authUser.organisationId,
        includePreliminary,
      });
      res.json({ ok: true, summary: payload.summary });
    } catch (error: unknown) {
      res.status(error instanceof SecureError ? error.statusCode : 500).json(toSafeErrorResponse(error));
    }
  },
);

router.get(
  '/api/admin/requirements/reports/export.csv',
  requireAuth,
  rateLimitByUser(15, 60_000),
  async (req, res) => {
    try {
      if (!req.authUser || req.authUser.role !== 'ADMIN') {
        res.status(403).json({ ok: false, error: 'Admin role required' });
        return;
      }

      const includePreliminary = parseBooleanFlag(req.query?.includePreliminary, false);
      const stream = await buildRequirementsExportCsvZip({
        organisationId: req.authUser.organisationId,
        includePreliminary,
      });
      const filename = exportFilename('kravrapport', 'zip');

      await appendDomainAudit({
        entityType: 'RequirementReport',
        entityId: 'requirements-export-csv',
        action: 'REPORT_EXPORT_CSV',
        userId: req.authUser.id,
        payload: { includePreliminary, filename },
      });

      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      stream.pipe(res);
    } catch (error: unknown) {
      res.status(error instanceof SecureError ? error.statusCode : 500).json(toSafeErrorResponse(error));
    }
  },
);

router.post(
  '/api/admin/requirements/reports/export.docx',
  requireAuth,
  rateLimitByUser(15, 60_000),
  async (req, res) => {
    try {
      if (!req.authUser || req.authUser.role !== 'ADMIN') {
        res.status(403).json({ ok: false, error: 'Admin role required' });
        return;
      }

      const includePreliminary = parseBooleanFlag(req.body?.includePreliminary, false);
      const buffer = await buildRequirementsDocxBuffer({
        organisationId: req.authUser.organisationId,
        includePreliminary,
      });
      const filename = exportFilename('kravrapport', 'docx');

      await appendDomainAudit({
        entityType: 'RequirementReport',
        entityId: 'requirements-export-docx',
        action: 'REPORT_EXPORT_DOCX',
        userId: req.authUser.id,
        payload: { includePreliminary, filename },
      });

      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      );
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(buffer);
    } catch (error: unknown) {
      res.status(error instanceof SecureError ? error.statusCode : 500).json(toSafeErrorResponse(error));
    }
  },
);

router.post(
  '/api/admin/requirements/reports/export.pdf',
  requireAuth,
  rateLimitByUser(15, 60_000),
  async (req, res) => {
    try {
      if (!req.authUser || req.authUser.role !== 'ADMIN') {
        res.status(403).json({ ok: false, error: 'Admin role required' });
        return;
      }

      const includePreliminary = parseBooleanFlag(req.body?.includePreliminary, false);
      const buffer = await buildRequirementsReportPdfBuffer({
        organisationId: req.authUser.organisationId,
        includePreliminary,
      });
      const filename = exportFilename('kravrapport', 'pdf');

      await appendDomainAudit({
        entityType: 'RequirementReport',
        entityId: 'requirements-export-pdf',
        action: 'REPORT_EXPORT_PDF',
        userId: req.authUser.id,
        payload: { includePreliminary, filename },
      });

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(buffer);
    } catch (error: unknown) {
      res.status(error instanceof SecureError ? error.statusCode : 500).json(toSafeErrorResponse(error));
    }
  },
);

export default router;
