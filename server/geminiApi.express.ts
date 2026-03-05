import express from "express";
import bodyParser from "body-parser";
import { requireAuth } from "./security/auth";
import { rateLimitByUser } from "./security/rateLimit";
import { requestLogger } from "./security/requestLogging";
import {
  analyzePermitRisk,
  chatWithPermit,
  analyzeSiteImage,
  analyzeTechnicalDrawing,
  analyzeDrawingOCR,
  classifyAsset,
  suggestStakeholders,
  generatePlanDraft,
  analyzeBiodiversity,
  predictWeatherRisk,
  autoFillFormSection,
  fetchMunicipalityContext,
  performSpatialAudit,
  askGeneralAssistant,
  generateMarketingSummary,
  generateFigmaAiResponse,
  generateFigmaUiSpec
} from "../services/geminiService";

const router = express.Router();
router.use(bodyParser.json({ limit: "10mb" }));
router.use(requestLogger);

function isLoopbackRequest(req: express.Request): boolean {
  const ip = String(req.ip || "");
  return ip === "::1" || ip === "127.0.0.1" || ip.startsWith("::ffff:127.0.0.1");
}

function setFigmaCorsHeaders(res: express.Response) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
}

router.use((req, res, next) => {
  if (req.path !== "/api/figma/ai") {
    next();
    return;
  }

  setFigmaCorsHeaders(res);
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  next();
});

router.use((req, res, next) => {
  const isAnonymousLocalFigmaCall =
    req.path === "/api/figma/ai" &&
    isLoopbackRequest(req) &&
    !req.headers.authorization;
  const isAnonymousLocalChatCall =
    req.path === "/api/gemini" &&
    req.method === "POST" &&
    isLoopbackRequest(req) &&
    !req.headers.authorization &&
    req.body?.method === "askGeneralAssistant";

  if (isAnonymousLocalFigmaCall || isAnonymousLocalChatCall) {
    next();
    return;
  }

  requireAuth(req, res, next);
});
router.use(rateLimitByUser(120, 60_000));

router.post("/api/gemini", async (req, res) => {
  const { method, payload } = req.body || {};
  try {
    let result: any;
    switch (method) {
      case "analyzePermitRisk":
        result = await analyzePermitRisk(payload.permit);
        break;
      case "chatWithPermit":
        result = await chatWithPermit(payload.permit, payload.message, payload.history || []);
        break;
      case "analyzeSiteImage":
        result = await analyzeSiteImage(payload.base64, payload.mimeType);
        break;
      case "analyzeTechnicalDrawing":
        result = await analyzeTechnicalDrawing(payload.base64, payload.mimeType);
        break;
      case "analyzeDrawingOCR":
        result = await analyzeDrawingOCR(payload.base64, payload.mimeType);
        break;
      case "classifyAsset":
        result = await classifyAsset(payload.base64, payload.mimeType);
        break;
      case "suggestStakeholders":
        result = await suggestStakeholders(payload.location, payload.description);
        break;
      case "generatePlanDraft":
        result = await generatePlanDraft(payload.type, payload.context);
        break;
      case "analyzeBiodiversity":
        result = await analyzeBiodiversity(payload.lat, payload.lng);
        break;
      case "predictWeatherRisk":
        result = await predictWeatherRisk(payload.municipality);
        break;
      case "autoFillFormSection":
        result = await autoFillFormSection(payload.sectionTitle, payload.propertyData);
        break;
      case "fetchMunicipalityContext":
        result = await fetchMunicipalityContext(payload.municipality);
        break;
      case "performSpatialAudit":
        result = await performSpatialAudit(payload.lat, payload.lng);
        break;
      case "askGeneralAssistant":
        result = await askGeneralAssistant(payload.message, payload.history || []);
        break;
      case "generateMarketingSummary":
        result = await generateMarketingSummary(payload.permits || []);
        break;
      default:
        return res.status(400).json({ ok: false, error: "Unknown method" });
    }

    res.json({ ok: true, result });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

router.post("/api/figma/ai", async (req, res) => {
  const prompt = typeof req.body?.prompt === "string" ? req.body.prompt.trim() : "";
  const context = typeof req.body?.context === "string" ? req.body.context : "";
  const style = req.body?.style === "detailed" || req.body?.style === "bullet" ? req.body.style : "brief";
  const mode = req.body?.mode === "ui" ? "ui" : "text";
  const history = Array.isArray(req.body?.history)
    ? req.body.history.filter((item: any) => item && (item.role === "user" || item.role === "model") && typeof item.content === "string")
    : [];

  if (!prompt) {
    return res.status(400).json({ ok: false, error: "prompt is required" });
  }

  try {
    if (mode === "ui") {
      const spec = await generateFigmaUiSpec(prompt, { context, style });
      return res.json({ ok: true, mode: "ui", spec });
    }

    const text = await generateFigmaAiResponse(prompt, { context, style, history });
    if (!text) {
      return res.status(502).json({ ok: false, error: "Empty AI response" });
    }
    return res.json({ ok: true, mode: "text", text });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

export default router;
