import express from "express";
import bodyParser from "body-parser";
import { assertSecurityEnv } from "./security/env";
import { requireAuth } from "./security/auth";
import { rateLimitByOrg, rateLimitByUser } from "./security/rateLimit";
import { requestLogger } from "./security/requestLogging";
import { exportAuditTrail, verifyAuditTrail } from "./security/auditTrail";
import { assertPermission } from "./security/projectAccess";
import { cancelBankIdAuth, collectBankIdAuth, generateAnimatedQrPayload, initiateBankIdAuth, refreshSession } from "./services/bankIdService";
import { getAuditExportRows } from "./repositories/auditRepository";
import { getLantmaterietOpenMapStatus, lookupPropertyByDesignation } from "./services/lantmaterietService";
import { SOURCE_CATALOG } from "./datasources/catalog";
import { fetchImmediateOpenSources } from "./services/openDataSourceService";
import { callSluProductApi, getSluProductStatus, pingSluProduct, searchSluObservations } from "./services/sluService";
import type { PropertyLookupInput } from "./security/types";

assertSecurityEnv();

const router = express.Router();
router.use(bodyParser.json({ limit: "1mb" }));
router.use(requestLogger);

router.post("/api/auth/bankid/init", rateLimitByUser(10, 60_000), async (req, res) => {
  try {
    const endUserIp = String(req.body?.endUserIp ?? req.ip);
    const orderTime = new Date();
    const order = await initiateBankIdAuth(endUserIp);
    const qrPayload = generateAnimatedQrPayload({
      qrStartToken: order.qrStartToken,
      qrStartSecret: order.qrStartSecret,
      orderTime,
    });
    res.json({ ok: true, ...order, orderTime: orderTime.toISOString(), qrPayload });
  } catch (error: unknown) {
    res.status(400).json({ ok: false, error: error instanceof Error ? error.message : "bankid init failed" });
  }
});

router.post("/api/auth/bankid/collect", rateLimitByUser(60, 60_000), async (req, res) => {
  try {
    const orderRef = String(req.body?.orderRef ?? "");
    const result = await collectBankIdAuth(orderRef);
    res.json({ ok: true, ...result });
  } catch (error: unknown) {
    res.status(400).json({ ok: false, error: error instanceof Error ? error.message : "collect failed" });
  }
});

router.post("/api/auth/bankid/cancel", rateLimitByUser(20, 60_000), async (req, res) => {
  try {
    const orderRef = String(req.body?.orderRef ?? "");
    const result = await cancelBankIdAuth(orderRef);
    res.json({ ok: true, ...result });
  } catch (error: unknown) {
    res.status(400).json({ ok: false, error: error instanceof Error ? error.message : "cancel failed" });
  }
});

router.post("/api/auth/refresh", rateLimitByUser(30, 60_000), (req, res) => {
  try {
    const token = String(req.body?.refreshToken ?? "");
    const rotated = refreshSession(token);
    res.json({ ok: true, ...rotated });
  } catch (error: unknown) {
    res.status(401).json({ ok: false, error: error instanceof Error ? error.message : "refresh failed" });
  }
});

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
    res.status(400).json({ ok: false, error: error instanceof Error ? error.message : "lookup failed" });
  }
});

router.get("/api/datasources/lantmateriet/open/status", requireAuth, rateLimitByUser(20, 60_000), async (req, res) => {
  try {
    if (!req.authUser) {
      res.status(401).json({ ok: false, error: "Unauthorized" });
      return;
    }
    assertPermission(req.authUser, "AUDIT_EXPORT");
    const result = await getLantmaterietOpenMapStatus();
    res.json({ ok: true, result });
  } catch (error: unknown) {
    res.status(400).json({
      ok: false,
      error: error instanceof Error ? error.message : "Lantmateriet open status failed",
    });
  }
});

router.get("/api/audit/export", requireAuth, rateLimitByUser(10, 60_000), async (req, res) => {
  try {
    if (!req.authUser) {
      res.status(401).json({ ok: false, error: "Unauthorized" });
      return;
    }
    assertPermission(req.authUser, "AUDIT_EXPORT");
    const integrity = verifyAuditTrail();
    const dbRecords = await getAuditExportRows();
    res.json({
      ok: true,
      integrity,
      memoryRecords: exportAuditTrail(),
      records: dbRecords,
    });
  } catch (error: unknown) {
    res.status(403).json({ ok: false, error: error instanceof Error ? error.message : "forbidden" });
  }
});

router.get("/api/datasources/catalog", requireAuth, rateLimitByUser(30, 60_000), (_req, res) => {
  res.json({ ok: true, sources: SOURCE_CATALOG });
});

router.post("/api/datasources/open/sync", requireAuth, rateLimitByUser(10, 60_000), async (req, res) => {
  try {
    if (!req.authUser) {
      res.status(401).json({ ok: false, error: "Unauthorized" });
      return;
    }
    assertPermission(req.authUser, "AUDIT_EXPORT");
    const results = await fetchImmediateOpenSources();
    res.json({ ok: true, results });
  } catch (error: unknown) {
    res.status(400).json({ ok: false, error: error instanceof Error ? error.message : "sync failed" });
  }
});

router.get("/api/datasources/slu/status", requireAuth, rateLimitByUser(10, 60_000), (req, res) => {
  try {
    if (!req.authUser) {
      res.status(401).json({ ok: false, error: "Unauthorized" });
      return;
    }
    assertPermission(req.authUser, "AUDIT_EXPORT");
    res.json({ ok: true, products: getSluProductStatus() });
  } catch (error: unknown) {
    res.status(400).json({ ok: false, error: error instanceof Error ? error.message : "SLU status failed" });
  }
});

router.get("/api/datasources/slu/ping/:product", requireAuth, rateLimitByUser(10, 60_000), async (req, res) => {
  try {
    if (!req.authUser) {
      res.status(401).json({ ok: false, error: "Unauthorized" });
      return;
    }
    assertPermission(req.authUser, "AUDIT_EXPORT");
    const product = String(req.params.product || "") as "species_observations" | "taxonomy" | "artfakta" | "metodkatalog";
    const result = await pingSluProduct(product);
    res.json({ ok: true, result });
  } catch (error: unknown) {
    res.status(400).json({ ok: false, error: error instanceof Error ? error.message : "SLU ping failed" });
  }
});

router.post("/api/datasources/slu/observations", requireAuth, rateLimitByUser(20, 60_000), async (req, res) => {
  try {
    if (!req.authUser) {
      res.status(401).json({ ok: false, error: "Unauthorized" });
      return;
    }
    const projectId = String(req.body?.projectId ?? "");
    const purpose = String(req.body?.purpose ?? "");
    const payload = (req.body?.payload ?? {}) as Record<string, unknown>;
    const result = await searchSluObservations({ projectId, purpose, payload, user: req.authUser });
    res.json({ ok: true, result });
  } catch (error: unknown) {
    res.status(400).json({ ok: false, error: error instanceof Error ? error.message : "SLU observation search failed" });
  }
});

router.post("/api/datasources/slu/proxy", requireAuth, rateLimitByUser(20, 60_000), async (req, res) => {
  try {
    if (!req.authUser) {
      res.status(401).json({ ok: false, error: "Unauthorized" });
      return;
    }

    const product = String(req.body?.product ?? "") as "species_observations" | "taxonomy" | "artfakta" | "metodkatalog";
    const method = String(req.body?.method ?? "GET").toUpperCase() as "GET" | "POST";
    const purpose = String(req.body?.purpose ?? "");
    const projectId = req.body?.projectId ? String(req.body.projectId) : undefined;
    const pathSuffix = req.body?.pathSuffix ? String(req.body.pathSuffix) : undefined;
    const payload = (req.body?.payload ?? {}) as Record<string, unknown>;
    const query = (req.body?.query ?? {}) as Record<string, string | number | boolean>;

    const result = await callSluProductApi({
      product,
      method,
      pathSuffix,
      payload,
      query,
      purpose,
      projectId,
      user: req.authUser,
    });
    res.json({ ok: true, result });
  } catch (error: unknown) {
    res.status(400).json({ ok: false, error: error instanceof Error ? error.message : "SLU proxy failed" });
  }
});

export default router;
