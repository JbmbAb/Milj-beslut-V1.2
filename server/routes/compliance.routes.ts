import express from "express";
import { requireAuth } from "../security/auth";
import { rateLimitByUser, rateLimitByOrg } from "../security/rateLimit";
import { toSafeErrorResponse } from "../security/secureErrors";
import { submitPermitToAuthority, getSubmission } from "../services/permitAuthorityService";
import { signDocumentEidas } from "../services/eidasSignatureService";
import { autoFetchLimsReports } from "../services/limsAutoFetchService";
import { assertPermission } from "../security/projectAccess";
import { routeParam } from "../utils/routeUtils";

const router = express.Router();

// Permits
router.post("/api/projects/:projectId/permit/authority-submit", requireAuth, rateLimitByUser(10, 60_000), rateLimitByOrg(50, 60 * 60_000), async (req, res) => {
  try {
    if (!req.authUser) { res.status(401).json({ ok: false, error: "Unauthorized" }); return; }
    await assertPermission(req.authUser, routeParam(req.params.projectId));

    const { permitType, applicantName, propertyDesignation, documentIds, authorityName } =
      req.body as {
        permitType?: string;
        applicantName?: string;
        propertyDesignation?: string;
        documentIds?: string[];
        authorityName?: string;
      };

    if (!permitType || !applicantName || !propertyDesignation) {
      res.status(400).json({ ok: false, error: "permitType, applicantName och propertyDesignation krävs" });
      return;
    }

    const submission = await submitPermitToAuthority({
      projectId: routeParam(req.params.projectId),
      orgId: req.authUser.organisationId,
      actingUserId: req.authUser.id,
      permitType,
      applicantName,
      propertyDesignation,
      documentIds: Array.isArray(documentIds) ? documentIds : [],
      authorityName,
    });

    res.json({ ok: true, submission });
  } catch (error: unknown) {
    res.status(400).json(toSafeErrorResponse(error));
  }
});

router.get("/api/projects/:projectId/permit/submissions/:referenceId", requireAuth, rateLimitByUser(30, 60_000), async (req, res) => {
  try {
    if (!req.authUser) { res.status(401).json({ ok: false, error: "Unauthorized" }); return; }
    const submission = getSubmission(routeParam(req.params.referenceId));
    if (!submission) { res.status(404).json({ ok: false, error: "Inlämning hittades inte" }); return; }
    res.json({ ok: true, submission });
  } catch (error: unknown) {
    res.status(400).json(toSafeErrorResponse(error));
  }
});

// Digital Signature
router.post("/api/documents/:documentId/sign/eidas", requireAuth, rateLimitByUser(20, 60_000), async (req, res) => {
  try {
    if (!req.authUser) { res.status(401).json({ ok: false, error: "Unauthorized" }); return; }
    const { signerPersonalNumber, signerName, signatureText, format, level } =
      req.body as {
        signerPersonalNumber?: string;
        signerName?: string;
        signatureText?: string;
        format?: "PAdES" | "XAdES" | "CAdES";
        level?: "ADVANCED" | "QUALIFIED";
      };

    if (!signerPersonalNumber || !signerName) {
      res.status(400).json({ ok: false, error: "signerPersonalNumber och signerName krävs" });
      return;
    }

    const result = await signDocumentEidas(
      {
        documentId: routeParam(req.params.documentId),
        signerPersonalNumber,
        signerName,
        signatureText,
        format,
        level,
      },
      req.authUser.id,
    );
    res.json({ ok: true, signature: result });
  } catch (error: unknown) {
    res.status(400).json(toSafeErrorResponse(error));
  }
});

// LIMS Auto-fetch
router.post("/api/projects/:projectId/lims/auto-fetch", requireAuth, rateLimitByUser(20, 60_000), async (req, res) => {
  try {
    if (!req.authUser) { res.status(401).json({ ok: false, error: "Unauthorized" }); return; }
    await assertPermission(req.authUser, routeParam(req.params.projectId));
    const { since } = req.body as { since?: string };
    const result = await autoFetchLimsReports({
      projectId: routeParam(req.params.projectId),
      actingUserId: req.authUser.id,
      since,
    });
    res.json({ ok: true, result });
  } catch (error: unknown) {
    res.status(400).json(toSafeErrorResponse(error));
  }
});

export default router;
