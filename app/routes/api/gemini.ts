import { json } from "@remix-run/node";
import type { ActionFunctionArgs } from "@remix-run/node";
import { getUserFromAccessToken } from "../../../server/security/auth";
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
} from "../../../services/geminiService";

// POST API route for server-side calls to Gemini service.
// Expects JSON: { method: string, payload: any }
const rateLimiter = new Map<string, { count: number; resetAt: number }>();

function isRateLimited(subject: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const bucket = rateLimiter.get(subject);
  const current = !bucket || bucket.resetAt <= now ? { count: 0, resetAt: now + windowMs } : bucket;
  current.count += 1;
  rateLimiter.set(subject, current);
  return current.count > max;
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  let userId = "anonymous";
  try {
    const user = getUserFromAccessToken(authHeader.slice("Bearer ".length));
    userId = user.id;
  } catch {
    return json({ ok: false, error: "Invalid token" }, { status: 401 });
  }

  if (isRateLimited(`gemini:${userId}`, 120, 60_000)) {
    return json({ ok: false, error: "Rate limit exceeded" }, { status: 429 });
  }

  const body = await request.json();
  const { method, payload } = body || {};

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
        throw new Error("Unknown method: " + String(method));
    }

    return json({ ok: true, result });
  } catch (e: any) {
    return json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
};

export const loader = async () => json({ ok: true, message: "Use POST to call methods." });
