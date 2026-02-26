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
  generateMarketingSummary
} from "../services/geminiService";

const router = express.Router();
router.use(bodyParser.json({ limit: "10mb" }));
router.use(requestLogger);
router.use(requireAuth);
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

export default router;
