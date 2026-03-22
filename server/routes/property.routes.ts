import express from "express";
import { requireAuth } from "../security/auth";
import { rateLimitByUser, rateLimitByOrg } from "../security/rateLimit";
import { toSafeErrorResponse } from "../security/secureErrors";
import { lookupPropertyByDesignation } from "../services/lantmaterietService";
import { lookupPropertyByDesignationFromPostgis } from "../services/propertyUnitService";
import type { PropertyLookupInput } from "../security/types";

const router = express.Router();

router.post("/api/property/lookup", requireAuth, rateLimitByUser(30, 5 * 60_000), rateLimitByOrg(200, 60 * 60_000), async (req, res) => {
  try {
    const input = req.body as PropertyLookupInput;
    if (!req.authUser) {
      res.status(401).json({ ok: false, error: "Unauthorized" });
      return;
    }
    const result = await lookupPropertyByDesignation(input, req.authUser);
    res.json({ ok: true, result });
  } catch (error: unknown) {
    res.status(400).json(toSafeErrorResponse(error));
  }
});

router.post("/api/property/lookup/postgis", requireAuth, rateLimitByUser(30, 5 * 60_000), rateLimitByOrg(200, 60 * 60_000), async (req, res) => {
  try {
    const input = req.body as PropertyLookupInput;
    if (!req.authUser) {
      res.status(401).json({ ok: false, error: "Unauthorized" });
      return;
    }
    const result = await lookupPropertyByDesignationFromPostgis(input, req.authUser);
    res.json({ ok: true, result });
  } catch (error: unknown) {
    res.status(400).json(toSafeErrorResponse(error));
  }
});

export default router;
