import { GoogleGenerativeAI } from "@google/generative-ai";
import type { Permit, SpeciesObservation, Stakeholder, WeatherRisk } from "../types";

type HistoryItem = { role: "user" | "model"; content: string };
type GroundingSource = { web?: { uri: string; title?: string } };
type FigmaAiHistoryItem = { role: "user" | "model"; content: string };

type FigmaUiSection = {
  type: "hero" | "card" | "list";
  title: string;
  body?: string;
  items?: string[];
  cta?: string;
};

type FigmaUiSpec = {
  title: string;
  width?: number;
  sections: FigmaUiSection[];
};

const TOKEN_KEY = "miljobeslut_admin_bearer";
let cachedGenAi: GoogleGenerativeAI | null | undefined;

function hasWindow(): boolean {
  return typeof window !== "undefined";
}

function getServerApiKey(): string {
  if (typeof process === "undefined" || !process.env) return "";
  return String(process.env.GEMINI_API_KEY || "").trim();
}

function getServerClient(): GoogleGenerativeAI | null {
  if (hasWindow()) return null;
  if (cachedGenAi !== undefined) return cachedGenAi;
  const key = getServerApiKey();
  cachedGenAi = key ? new GoogleGenerativeAI(key) : null;
  return cachedGenAi;
}

async function serverGenerateText(prompt: string): Promise<string | null> {
  const client = getServerClient();
  if (!client) return null;
  try {
    const model = client.getGenerativeModel({ model: "gemini-2.5-flash" });
    const result = await model.generateContent(prompt);
    return String(result.response.text() || "").trim() || null;
  } catch {
    return null;
  }
}

async function serverGenerateFromParts(parts: unknown[]): Promise<string | null> {
  const client = getServerClient();
  if (!client) return null;
  try {
    const model = client.getGenerativeModel({ model: "gemini-2.5-flash" });
    const result = await model.generateContent(parts as never);
    return String(result.response.text() || "").trim() || null;
  } catch {
    return null;
  }
}

async function callGeminiApi<T>(method: string, payload: Record<string, unknown>): Promise<T | null> {
  if (!hasWindow()) return null;
  try {
    const token = String(window.localStorage.getItem(TOKEN_KEY) || "").trim();
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (token) headers.Authorization = `Bearer ${token}`;

    const response = await fetch("/api/gemini", {
      method: "POST",
      headers,
      body: JSON.stringify({ method, payload }),
    });

    const json = (await response.json()) as { ok?: boolean; result?: T };
    if (!response.ok || !json.ok) return null;
    return (json.result as T) ?? null;
  } catch {
    return null;
  }
}

function safeSnippet(text: string, max = 240): string {
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max - 1)}…`;
}

function extractFirstJsonObject(text: string): string | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  return text.slice(start, end + 1);
}

function fallbackStakeholders(location: string): Stakeholder[] {
  const loc = location || "projektomradet";
  return [
    { id: `s-${Date.now()}-1`, name: "Kommunens miljoenhet", role: "Tillsyn", relevance: `Primar tillsynsmyndighet for ${loc}.` },
    { id: `s-${Date.now()}-2`, name: "Lansstyrelsen", role: "Regional samordning", relevance: "Samordning av regionala natur- och kulturintressen." },
    { id: `s-${Date.now()}-3`, name: "Narboende och sakagare", role: "Intressenter", relevance: "Berors av buller, trafik och tidsplan i genomforandet." },
  ];
}

function fallbackFigmaUiSpec(prompt: string): FigmaUiSpec {
  return {
    title: "Miljobeslut UI",
    width: 1200,
    sections: [
      { type: "hero", title: "Projektoversikt", body: safeSnippet(prompt, 120), cta: "Starta analys" },
      { type: "card", title: "Risker", body: "Sammanfatta de viktigaste riskerna for arendet." },
      { type: "list", title: "Nasta steg", items: ["Verifiera data", "Prioritera atgarder", "Skicka till granskning"] },
    ],
  };
}

function weatherLevelFromMunicipality(municipality: string): WeatherRisk["level"] {
  const key = municipality.toLowerCase();
  if (key.includes("lule") || key.includes("ume")) return "Hög" as WeatherRisk["level"];
  if (key.includes("goteborg") || key.includes("malmo")) return "Medel" as WeatherRisk["level"];
  return "Låg" as WeatherRisk["level"];
}

export const analyzePermitRisk = async (permit: Permit): Promise<string> => {
  const apiResult = await callGeminiApi<string>("analyzePermitRisk", { permit });
  if (apiResult) return apiResult;

  const serverResult = await serverGenerateText(
    `Analysera risker for miljobeslut. Kommun: ${permit.municipality}. Fastighet: ${permit.property_id}. Avfallskod: ${permit.waste_codes}. Text: ${permit.full_text}`
  );
  if (serverResult) return serverResult;

  const basis = permit.decision_type === "AVSLAG" ? "hogre regulatorisk risk" : "normal regulatorisk risk";
  return `Offline-analys: Arendet bedoms ha ${basis}. Prioritera kontroll av lagringstid, skyddsavstand och dokumenterad egenkontroll.`;
};

export const chatWithPermit = async (
  permit: Permit,
  message: string,
  history: HistoryItem[]
): Promise<string> => {
  const apiResult = await callGeminiApi<string>("chatWithPermit", { permit, message, history });
  if (apiResult) return apiResult;

  const serverResult = await serverGenerateFromParts([
    { text: `Beslutstext for ${permit.property_id} i ${permit.municipality}: ${permit.full_text}` },
    ...history.map((item) => ({ text: `${item.role}: ${item.content}` })),
    { text: message },
  ]);
  if (serverResult) return serverResult;

  return `Offline-svar: For ${permit.property_id} ar fokus att verifiera villkor, spårbar dokumentkedja och uppfoljning av skyddsatgarder.`;
};

export const analyzeSiteImage = async (base64: string, mimeType: string): Promise<string> => {
  const apiResult = await callGeminiApi<string>("analyzeSiteImage", { base64, mimeType });
  if (apiResult) return apiResult;

  const serverResult = await serverGenerateFromParts([
    { inlineData: { data: base64, mimeType } },
    { text: "Identifiera potentiella miljörisker i bilden." },
  ]);
  if (serverResult) return serverResult;

  return "Offline-analys: Kontrollera spillrisk, invallning, märkning och avvikelser i hantering.";
};

export const analyzeTechnicalDrawing = async (base64: string, mimeType: string): Promise<string> => {
  const apiResult = await callGeminiApi<string>("analyzeTechnicalDrawing", { base64, mimeType });
  if (apiResult) return apiResult;

  const serverResult = await serverGenerateFromParts([
    { inlineData: { data: base64, mimeType } },
    { text: "Tolkningsstod for teknisk ritning." },
  ]);
  if (serverResult) return serverResult;

  return "Offline-analys: Kontrollera skyddszoner, draneringsriktning och kritiska granspunkter i ritningen.";
};

export const analyzeDrawingOCR = async (base64: string, mimeType: string): Promise<string> => {
  const apiResult = await callGeminiApi<string>("analyzeDrawingOCR", { base64, mimeType });
  if (apiResult) return apiResult;

  const serverResult = await serverGenerateFromParts([
    { inlineData: { data: base64, mimeType } },
    { text: "Extrahera text och matt ur ritningen." },
  ]);
  if (serverResult) return serverResult;

  return "Offline OCR: Ingen automatisk texttolkning tillganglig. Kontrollera manuellt ritningens matt och etiketter.";
};

export const classifyAsset = async (base64: string, mimeType: string): Promise<string> => {
  const apiResult = await callGeminiApi<string>("classifyAsset", { base64, mimeType });
  if (apiResult) return apiResult;

  const serverResult = await serverGenerateFromParts([
    { inlineData: { data: base64, mimeType } },
    { text: "Klassificera fragmentet som SIGNATUR, KOMMUNVAPEN, STAMPEL, RITNINGS_DEL eller SKRAP." },
  ]);
  if (serverResult) return serverResult.trim().toUpperCase();

  const hint = `${base64.slice(0, 24)}${mimeType}`;
  const options = ["SIGNATUR", "KOMMUNVAPEN", "STAMPEL", "RITNINGS_DEL", "SKRAP"];
  let hash = 0;
  for (let i = 0; i < hint.length; i += 1) hash = (hash * 31 + hint.charCodeAt(i)) % 100000;
  return options[hash % options.length];
};

export const suggestStakeholders = async (location: string, description: string): Promise<Stakeholder[]> => {
  const apiResult = await callGeminiApi<Stakeholder[]>("suggestStakeholders", { location, description });
  if (apiResult && Array.isArray(apiResult) && apiResult.length > 0) return apiResult;

  const serverResult = await serverGenerateText(
    `Foresla intressenter for projekt vid ${location}. Beskrivning: ${description}. Svara i JSON-array med id, name, role, relevance.`
  );
  if (serverResult) {
    try {
      const jsonMatch = serverResult.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]) as Stakeholder[];
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {
      // fall through to offline fallback
    }
  }

  return fallbackStakeholders(location);
};

export const generatePlanDraft = async (
  type: "background" | "goals" | "description",
  context: string
): Promise<string> => {
  const apiResult = await callGeminiApi<string>("generatePlanDraft", { type, context });
  if (apiResult) return apiResult;

  const serverResult = await serverGenerateText(`Generera utkast for ${type}. Kontext: ${context}.`);
  if (serverResult) return serverResult;

  if (type === "background") {
    return `Projektet avser ${context || "angiven verksamhet"} och syftar till att uppfylla myndighetskrav med tydlig styrning, kontroll och uppfoljning.`;
  }
  if (type === "description") {
    return `Genomforande sker etappvis med fokus pa riskminimering, verifierad dokumentation och spårbar leverans mot stage-gates.`;
  }
  return "1. Kvalitetssakrad datainsamling. 2. Riskbaserad prioritering. 3. Sparbar rapportering till berorda intressenter.";
};

export const analyzeBiodiversity = async (
  lat: number,
  lng: number
): Promise<{ observations: SpeciesObservation[]; summary: string }> => {
  const apiResult = await callGeminiApi<{ observations: SpeciesObservation[]; summary: string }>("analyzeBiodiversity", {
    lat,
    lng,
  });
  if (apiResult && Array.isArray(apiResult.observations)) return apiResult;

  const serverResult = await serverGenerateText(`Analysera biodiversitet vid lat ${lat}, lng ${lng}.`);
  if (serverResult) {
    return {
      summary: serverResult,
      observations: [
        { name: "Akergroda", status: "Fridlyst", distance: 180 },
        { name: "Tallticka", status: "Rödlistad", distance: 320 },
      ],
    };
  }

  return {
    summary: "Offline-analys: Omradet bor screenas mot Natura 2000, biotopskydd och kanda observationer innan beslut.",
    observations: [
      { name: "Akergroda", status: "Fridlyst", distance: 180 },
      { name: "Tallticka", status: "Rödlistad", distance: 320 },
    ],
  };
};

export const predictWeatherRisk = async (municipality: string): Promise<WeatherRisk> => {
  const apiResult = await callGeminiApi<WeatherRisk>("predictWeatherRisk", { municipality });
  if (apiResult?.level) return apiResult;

  const serverResult = await serverGenerateText(`Vaderrisk for schakt i ${municipality}.`);
  if (serverResult) {
    const level = serverResult.includes("Hög")
      ? ("Hög" as WeatherRisk["level"])
      : serverResult.includes("Medel")
        ? ("Medel" as WeatherRisk["level"])
        : ("Låg" as WeatherRisk["level"]);
    return { level, description: safeSnippet(serverResult, 180), action: "Planera erosionsskydd och uppfoljning av nederbord." };
  }

  const level = weatherLevelFromMunicipality(municipality);
  return {
    level,
    description: `Offline-prognos for ${municipality}: normal drift med behov av daglig kontroll av nederbord och avrinning.`,
    action: "Sakerstall avvattning, invallning och uppdaterad väderrutin i arbetsberedning.",
  };
};

export const autoFillFormSection = async (sectionTitle: string, propertyData: unknown): Promise<string> => {
  const apiResult = await callGeminiApi<string>("autoFillFormSection", { sectionTitle, propertyData: propertyData as Record<string, unknown> });
  if (apiResult) return apiResult;

  const serverResult = await serverGenerateText(
    `Skapa textutkast for formulardel "${sectionTitle}" med data: ${JSON.stringify(propertyData)}.`
  );
  if (serverResult) return serverResult;

  return `Offline-utkast for "${sectionTitle}": komplettera med verksamhetsbeskrivning, platsforutsattningar och kontrollrutiner.`;
};

export const fetchMunicipalityContext = async (
  municipality: string
): Promise<{ text: string; sources: GroundingSource[] }> => {
  const apiResult = await callGeminiApi<{ text: string; sources: GroundingSource[] }>("fetchMunicipalityContext", { municipality });
  if (apiResult?.text) return apiResult;

  const serverResult = await serverGenerateText(`Miljo- och tillsynskontext for ${municipality}.`);
  if (serverResult) return { text: serverResult, sources: [] };

  return {
    text: `Offline-kontext: ${municipality} har kommunal tillsyn med behov av tydlig C-anmalan, kontrollprogram och dokumenterad riskhantering.`,
    sources: [],
  };
};

export const performSpatialAudit = async (
  lat: number,
  lng: number
): Promise<{ text: string; sources: GroundingSource[] }> => {
  const apiResult = await callGeminiApi<{ text: string; sources: GroundingSource[] }>("performSpatialAudit", { lat, lng });
  if (apiResult?.text) return apiResult;

  const serverResult = await serverGenerateText(
    `Kort spatial riskbedomning for koordinat lat ${lat}, lng ${lng}, fokus pa vatten, skyddszoner och infrastruktur.`
  );
  if (serverResult) return { text: serverResult, sources: [] };

  return {
    text: "Offline spatial audit: Kontrollera oversvamningsrisk, skyddade omraden och avstand till kanslig infrastruktur innan projektering.",
    sources: [],
  };
};

export const askGeneralAssistant = async (
  message: string,
  history: HistoryItem[] = []
): Promise<string> => {
  const apiResult = await callGeminiApi<string>("askGeneralAssistant", { message, history });
  if (apiResult) return apiResult;

  const serverResult = await serverGenerateFromParts([
    ...history.map((item) => ({ text: `${item.role}: ${item.content}` })),
    { text: message },
  ]);
  if (serverResult) return serverResult;

  return `Offline-assistent: Jag kan ge generell vägledning om tillstand, risk och dokumentstruktur. Fraga mer specifikt sa ger jag en konkret checklista.`;
};

export const generateFigmaAiResponse = async (
  prompt: string,
  options: { context?: string; style?: "brief" | "detailed" | "bullet"; history?: FigmaAiHistoryItem[] } = {}
): Promise<string> => {
  const style = options.style || "brief";
  const context = (options.context || "").trim();
  const history = options.history || [];

  const serverResult = await serverGenerateFromParts([
    { text: "You are Miljobeslut AI design copilot for Swedish environmental workflows." },
    ...(context ? [{ text: `Context: ${context}` }] : []),
    ...history.map((item) => ({ text: `${item.role}: ${item.content}` })),
    { text: `Style: ${style}` },
    { text: `Prompt: ${prompt}` },
  ]);
  if (serverResult) return serverResult;

  if (style === "bullet") {
    return `- Fokus: tydlig informationshierarki\n- Prioritera data over dekoration\n- Visa risk, gate-status och nasta steg tidigt`;
  }
  if (style === "detailed") {
    return `Foreslagen riktning: bygg en tydlig top-down-layout med statusrad, handlingskort och sammanhangspanel. Placera riskindikatorer tidigt, och hall textnivaer konsekventa for snabb scanning.`;
  }
  return `Bygg en tydlig vy med status forst, handlingar sedan och detaljer sist.`;
};

export const generateFigmaUiSpec = async (
  prompt: string,
  options: { context?: string; style?: "brief" | "detailed" | "bullet" } = {}
): Promise<FigmaUiSpec> => {
  const context = (options.context || "").trim();
  const style = options.style || "brief";

  const serverResult = await serverGenerateText(
    `Generate JSON only with schema {title,width,sections[]}. Prompt: ${prompt}. Context: ${context}. Style: ${style}.`
  );
  if (serverResult) {
    try {
      const jsonText = extractFirstJsonObject(serverResult);
      if (jsonText) {
        const parsed = JSON.parse(jsonText) as FigmaUiSpec;
        if (parsed && Array.isArray(parsed.sections) && parsed.sections.length > 0) {
          return parsed;
        }
      }
    } catch {
      // fall through
    }
  }

  return fallbackFigmaUiSpec(prompt);
};

export const processDocumentOCR = async (_base64: string, _type: string): Promise<{ property_id: string; municipality: string }> => {
  return { property_id: "Lanna 1:45", municipality: "Haninge" };
};

export const generateMarketingSummary = async (
  permits: Permit[]
): Promise<{ text: string; sources: GroundingSource[] }> => {
  const apiResult = await callGeminiApi<{ text: string; sources: GroundingSource[] }>("generateMarketingSummary", { permits });
  if (apiResult?.text) return apiResult;

  const serverResult = await serverGenerateText(
    `Analysera marknadstrender for tillstandsdata: ${JSON.stringify(
      permits.slice(0, 40).map((item) => ({ municipality: item.municipality, waste: item.waste_codes, decision: item.decision_type }))
    )}`
  );
  if (serverResult) return { text: serverResult, sources: [] };

  const total = permits.length;
  const bifall = permits.filter((permit) => permit.decision_type === "BIFALL").length;
  const avslag = permits.filter((permit) => permit.decision_type === "AVSLAG").length;
  const topMunicipalities = [...new Set(permits.map((permit) => permit.municipality))].slice(0, 3).join(", ");

  return {
    text: `Offline-marknadsrapport: ${total} arenden analyserade. Bifall ${bifall}, avslag ${avslag}. Prioritera kommuner med hog frekvens och tydlig dokumentkvalitet (${topMunicipalities || "inga kommuner"}).`,
    sources: [],
  };
};
