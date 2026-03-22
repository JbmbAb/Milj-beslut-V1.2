import express from "express";
import fs from "node:fs";
import { requireAuth } from "../security/auth";
import { rateLimitByUser } from "../security/rateLimit";
import { toSafeErrorResponse } from "../security/secureErrors";
import { uploadDocumentToProject } from "../services/documentUploadService";
import { getDocumentById as getSearchDocumentById, deleteDocumentById } from "../repositories/searchRepository";
import { assertProjectMembership } from "../repositories/projectAccessRepository";
import { appendDomainAudit } from "../security/auditTrail";
import { parseOptionalText } from "../utils/routeUtils";

const router = express.Router();

router.post(
  "/api/documents/upload",
  requireAuth,
  express.raw({ limit: "25mb", type: () => true }),
  rateLimitByUser(20, 60_000),
  async (req, res) => {
    try {
      if (!req.authUser) {
        res.status(401).json({ ok: false, error: "Unauthorized" });
        return;
      }

      const projectId = String(req.query?.projectId ?? "").trim();
      const originalName = String(req.query?.originalName ?? "").trim();
      const subject = parseOptionalText(req.query?.subject);
      const buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      const mimeType = parseOptionalText(req.header("content-type"));

      if (!projectId) {
        res.status(400).json({ ok: false, error: "projectId is required" });
        return;
      }
      if (!originalName) {
        res.status(400).json({ ok: false, error: "originalName is required" });
        return;
      }
      if (buffer.length === 0) {
        res.status(400).json({ ok: false, error: "file body is required" });
        return;
      }

      await assertProjectMembership({
        projectId,
        userId: req.authUser.id,
        organisationId: req.authUser.organisationId,
        role: req.authUser.role,
      });

      const uploaded = await uploadDocumentToProject({
        projectId,
        organisationId: req.authUser.organisationId,
        actingUserId: req.authUser.id,
        buffer,
        originalName,
        subject,
        mimeType,
      });

      res.status(201).json({
        ok: true,
        document: uploaded.document,
        searchJobId: uploaded.searchJobId,
        auditId: uploaded.auditId,
      });
    } catch (error: unknown) {
      res.status(400).json(toSafeErrorResponse(error));
    }
  }
);

router.get("/api/documents/:documentId/view", requireAuth, rateLimitByUser(50, 60_000), async (req, res) => {
  try {
    if (!req.authUser) {
      res.status(401).json({ ok: false, error: "Unauthorized" });
      return;
    }

    const documentId = String(req.params.documentId || "").trim();
    if (!documentId) {
      res.status(400).json({ ok: false, error: "documentId is required" });
      return;
    }

    const document = await getSearchDocumentById(documentId);
    if (!document || !document.absolutePath) {
      res.status(404).json({ ok: false, error: "Document not found" });
      return;
    }
    if (!fs.existsSync(document.absolutePath)) {
      res.status(404).json({ ok: false, error: "Document file missing on server" });
      return;
    }

    await assertProjectMembership({
      projectId: String(document.projectId),
      userId: req.authUser.id,
      organisationId: req.authUser.organisationId,
      role: req.authUser.role,
    });

    await appendDomainAudit({
      entityType: "DocumentRecord",
      entityId: String(document.id),
      action: "DOCUMENT_VIEW",
      userId: req.authUser.id,
      payload: {
        documentId: String(document.id),
        projectId: String(document.projectId),
        mimeType: document.mimeType || "application/octet-stream",
      },
    });

    const stream = fs.createReadStream(document.absolutePath);
    res.setHeader("Content-Type", document.mimeType || "application/octet-stream");
    res.setHeader(
      "Content-Disposition",
      `inline; filename="${encodeURIComponent(String(document.originalName || "document"))}"`
    );
    stream.pipe(res);
  } catch (error: unknown) {
    res.status(400).json(toSafeErrorResponse(error));
  }
});

router.get("/api/documents/:documentId/download", requireAuth, rateLimitByUser(50, 60_000), async (req, res) => {
  try {
    if (!req.authUser) {
      res.status(401).json({ ok: false, error: "Unauthorized" });
      return;
    }

    const documentId = String(req.params.documentId || "").trim();
    if (!documentId) {
      res.status(400).json({ ok: false, error: "documentId is required" });
      return;
    }

    const document = await getSearchDocumentById(documentId);
    if (!document || !document.absolutePath) {
      res.status(404).json({ ok: false, error: "Document not found" });
      return;
    }
    if (!fs.existsSync(document.absolutePath)) {
      res.status(404).json({ ok: false, error: "Document file missing on server" });
      return;
    }

    await assertProjectMembership({
      projectId: String(document.projectId),
      userId: req.authUser.id,
      organisationId: req.authUser.organisationId,
      role: req.authUser.role,
    });

    await appendDomainAudit({
      entityType: "DocumentRecord",
      entityId: String(document.id),
      action: "DOCUMENT_DOWNLOAD",
      userId: req.authUser.id,
      payload: {
        documentId: String(document.id),
        projectId: String(document.projectId),
        mimeType: document.mimeType || "application/octet-stream",
      },
    });

    const stream = fs.createReadStream(document.absolutePath);
    res.setHeader("Content-Type", document.mimeType || "application/octet-stream");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${encodeURIComponent(String(document.originalName || "document"))}"`
    );
    stream.pipe(res);
  } catch (error: unknown) {
    res.status(400).json(toSafeErrorResponse(error));
  }
});

router.delete("/api/documents/:documentId", requireAuth, rateLimitByUser(20, 60_000), async (req, res) => {
  try {
    if (!req.authUser) {
      res.status(401).json({ ok: false, error: "Unauthorized" });
      return;
    }

    const documentId = String(req.params.documentId || "").trim();
    if (!documentId) {
      res.status(400).json({ ok: false, error: "documentId is required" });
      return;
    }

    const document = await getSearchDocumentById(documentId);
    if (!document) {
      res.status(404).json({ ok: false, error: "Document not found" });
      return;
    }

    await assertProjectMembership({
      projectId: String(document.projectId),
      userId: req.authUser.id,
      organisationId: req.authUser.organisationId,
      role: req.authUser.role,
    });

    const deleted = await deleteDocumentById(documentId);
    if (!deleted) {
      res.status(404).json({ ok: false, error: "Document not found" });
      return;
    }

    let fileDeleted = false;
    if (deleted.absolutePath && fs.existsSync(deleted.absolutePath)) {
      fs.unlinkSync(deleted.absolutePath);
      fileDeleted = true;
    }

    await appendDomainAudit({
      entityType: "DocumentRecord",
      entityId: String(deleted.id),
      action: "DOCUMENT_DELETE",
      userId: req.authUser.id,
      payload: {
        documentId: String(deleted.id),
        projectId: String(deleted.projectId),
        deletedSearchJobs: deleted.deletedSearchJobs,
        fileDeleted,
      },
    });

    res.json({
      ok: true,
      documentId: String(deleted.id),
      deletedSearchJobs: Number(deleted.deletedSearchJobs || 0),
      fileDeleted,
    });
  } catch (error: unknown) {
    res.status(400).json(toSafeErrorResponse(error));
  }
});

export default router;
