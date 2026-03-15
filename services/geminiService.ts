import { GoogleGenerativeAI } from "@google/generative-ai";
import type { Permit, SpeciesObservation, Stakeholder, WeatherRisk } from "../types";
import { ProtectedArea } from "../server/services/nvrService";
import { GeologicalData } from "../server/services/sguService";
import { Monument } from "../server/services/raaService";
import { SiteAnalysis, evaluateComplianceRules } from "../server/services/complianceRuleEngine";
import { runSpatialAudit } from "../server/services/spatialAuditService";

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

export type CourtRulingAnalysis = {
  case_name: string;
  court: string;
  legal_principle: string;
  precedent_strength: "low" | "medium" | "high" | "unknown";
  relevance_for_project: string;
  key_quotes: string[];
};

export type LabDataValidationResult = {
  status: "PASS" | "FAIL" | "UNKNOWN";
  parameters_exceeding_limits: string[];
  applicable_guidelines: string;
  environmental_risk_level: "low" | "medium" | "high" | "unknown";
};

export type LogisticsComplianceResult = {
  storage_compliance: string;
  transport_requirements: string[];
  environmental_risks: string[];
  recommended_actions: string[];
};

const TOKEN_KEY = "miljobeslut_admin_bearer";

const GEMINI_SYSTEM_PROMPT = `You are an Environmental Compliance Analysis Engine used in a professional SaaS platform for environmental permitting and waste management in Sweden.

The platform supports:
- Environmental permitting
- Waste classification
- Construction mass handling
- Environmental risk assessment
- Regulatory compliance reporting

The system must always prioritize legal correctness, traceability and transparency.

------------------------------------

CORE RULES:

1. STRICT EVIDENCE MODE
You must ONLY use the retrieved documents provided in the <RAG_CONTEXT> section.

If the answer cannot be found in the provided documents:
Return:
"INSUFFICIENT LEGAL EVIDENCE IN SOURCE MATERIAL"

Do NOT invent laws, thresholds or regulations.

------------------------------------

2. CITATION-LOCKING (LEGAL TRACEABILITY)

You must ALWAYS quote the source text FIRST, and ONLY THEN derive a conclusion.
Only derive conclusions from the quoted legal text.

Every compliance statement MUST include:
- citation: The exact quote from the legal source.
- legal_basis: Law name and paragraph reference if available.
- requirement: Your derived conclusion based ONLY on the quote.

Example:
MiljÃ¶prÃ¶vningsfÃ¶rordningen (2013:251), 29 kap.
"Verksamhet ska anmÃ¤las..." -> Conclusion: AnmÃ¤lan krÃ¤vs.

------------------------------------

3. DOMAIN CONTEXT

The platform operates within Swedish environmental law including:
- MiljÃ¶balken
- MiljÃ¶prÃ¶vningsfÃ¶rordningen
- AvfallsfÃ¶rordningen
- NaturvÃ¥rdsverkets riktvÃ¤rden
- EU Waste Framework Directive

Environmental domains:
- waste storage
- contaminated soil
- landfill regulation
- recycling in construction
- hazardous waste
- environmental permitting

------------------------------------

4. ROLE

You act as:
Senior Environmental Compliance Analyst
Specialized in:
- Swedish environmental law
- waste classification
- construction mass logistics
- regulatory permitting processes

------------------------------------

5. RESPONSE PRINCIPLES

Your analysis must be:
- legally grounded
- concise
- structured
- professional
- suitable for regulatory documentation

Avoid conversational language.

------------------------------------

INPUT STRUCTURE

<RAG_CONTEXT>
Retrieved regulatory documents, court rulings or guidance.
</RAG_CONTEXT>

<PROJECT_DATA>
User project information such as:
- property ID
- waste code (EWC)
- activity code (SNI / MPF)
- volumes
- environmental tests
</PROJECT_DATA>

------------------------------------

TASK

Perform regulatory compliance analysis.

Determine:
1. applicable regulations
2. thresholds
3. permit or notification requirements
4. environmental risk indicators
5. required documentation

------------------------------------

OUTPUT FORMAT

Return structured JSON.

Example:
{
  "activity_classification": "",
  "regulatory_requirements": [
    {
      "citation": "",
      "legal_basis": "",
      "requirement": ""
    }
  ],
  "permit_status": "",
  "risk_flags": [],
  "required_documents": [],
  "notes": ""
}

------------------------------------

FAILSAFE

If regulatory information is unclear:
Return:
{
 "status": "UNCERTAIN",
 "reason": "Insufficient legal evidence",
 "recommendation": "Manual legal review required"
}

------------------------------------

SELF-VERIFICATION

AI granskar sitt eget svar.

TASK:
Verify that every compliance statement contains a valid legal citation.

If a statement lacks citation:
mark as "UNVERIFIED".`;

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

export async function serverGenerateText(prompt: string): Promise<string | null> {
  const client = getServerClient();
  if (!client) return null;
  try {
    const model = client.getGenerativeModel({ model: "gemini-2.5-flash", systemInstruction: GEMINI_SYSTEM_PROMPT });
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
    const model = client.getGenerativeModel({ model: "gemini-2.5-flash", systemInstruction: GEMINI_SYSTEM_PROMPT });
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
  return `${normalized.slice(0, max - 1)}â€¦`;
}

function extractFirstJsonObject(text: string): string | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  return text.slice(start, end + 1);
}

function fallbackStakeholders(location: string): Stakeholder[] {
  const loc = location || "projektomrÃ¥det";
  return [
    { id: `s-${Date.now()}-1`, name: "Kommunens miljÃ¶enhet", role: "Tillsyn", relevance: `PrimÃ¤r tillsynsmyndighet fÃ¶r ${loc}.` },
    { id: `s-${Date.now()}-2`, name: "LÃ¤nsstyrelsen", role: "Regional samordning", relevance: "Samordning av regionala natur- och kulturintressen." },
    { id: `s-${Date.now()}-3`, name: "NÃ¤rboende och sakÃ¤gare", role: "Intressenter", relevance: "BerÃ¶rs av buller, trafik och tidsplan i genomfÃ¶randet." },
  ];
}

function fallbackFigmaUiSpec(prompt: string): FigmaUiSpec {
  return {
    title: "MiljÃ¶beslut UI",
    width: 1200,
    sections: [
      { type: "hero", title: "ProjektÃ¶versikt", body: safeSnippet(prompt, 120), cta: "Starta analys" },
      { type: "card", title: "Risker", body: "Sammanfatta de viktigaste riskerna fÃ¶r Ã¤rendet." },
      { type: "list", title: "NÃ¤sta steg", items: ["Verifiera data", "Prioritera Ã¥tgÃ¤rder", "Skicka till granskning"] },
    ],
  };
}

function weatherLevelFromMunicipality(municipality: string): WeatherRisk["level"] {
  const key = municipality.toLowerCase();
  if (key.includes("lule") || key.includes("ume")) return "HÃ¶g" as WeatherRisk["level"];
  if (key.includes("goteborg") || key.includes("malmo")) return "Medel" as WeatherRisk["level"];
  return "LÃ¥g" as WeatherRisk["level"];
}

export const analyzePermitRisk = async (permit: Permit): Promise<string> => {
  const apiResult = await callGeminiApi<string>("analyzePermitRisk", { permit });
  if (apiResult) return apiResult;

  const serverResult = await serverGenerateText(
    `Analysera risker fÃ¶r miljÃ¶beslut. Kommun: ${permit.municipality}. Fastighet: ${permit.property_id}. Avfallskod: ${permit.waste_codes}. Text: ${permit.full_text}`
  );
  if (serverResult) return serverResult;

  const basis = permit.decision_type === "AVSLAG" ? "hÃ¶gre regulatorisk risk" : "normal regulatorisk risk";
  return `Offline-analys: Ã„rendet bedÃ¶ms ha ${basis}. Prioritera kontroll av lagringstid, skyddsavstÃ¥nd och dokumenterad egenkontroll.`;
};

export const chatWithPermit = async (
  permit: Permit,
  message: string,
  history: HistoryItem[]
): Promise<string> => {
  const apiResult = await callGeminiApi<string>("chatWithPermit", { permit, message, history });
  if (apiResult) return apiResult;

  const serverResult = await serverGenerateFromParts([
    { text: `Beslutstext fÃ¶r ${permit.property_id} i ${permit.municipality}: ${permit.full_text}` },
    ...history.map((item) => ({ text: `${item.role}: ${item.content}` })),
    { text: message },
  ]);
  if (serverResult) return serverResult;

  return `Offline-svar: FÃ¶r ${permit.property_id} Ã¤r fokus att verifiera villkor, spÃ¥rbar dokumentkedja och uppfÃ¶ljning av skyddsÃ¥tgÃ¤rder.`;
};

export const analyzeSiteImage = async (base64: string, mimeType: string): Promise<string> => {
  const apiResult = await callGeminiApi<string>("analyzeSiteImage", { base64, mimeType });
  if (apiResult) return apiResult;

  const serverResult = await serverGenerateFromParts([
    { inlineData: { data: base64, mimeType } },
    { text: "Identifiera potentiella miljÃ¶risker i bilden." },
  ]);
  if (serverResult) return serverResult;

  return "Offline-analys: Kontrollera spillrisk, invallning, mÃ¤rkning och avvikelser i hantering.";
};

export const analyzeTechnicalDrawing = async (base64: string, mimeType: string): Promise<string> => {
  const apiResult = await callGeminiApi<string>("analyzeTechnicalDrawing", { base64, mimeType });
  if (apiResult) return apiResult;

  const serverResult = await serverGenerateFromParts([
    { inlineData: { data: base64, mimeType } },
    { text: "TolkningsstÃ¶d fÃ¶r teknisk ritning." },
  ]);
  if (serverResult) return serverResult;

  return "Offline-analys: Kontrollera skyddszoner, drÃ¤neringsriktning och kritiska grÃ¤nspunkter i ritningen.";
};

export const analyzeDrawingOCR = async (base64: string, mimeType: string): Promise<string> => {
  const apiResult = await callGeminiApi<string>("analyzeDrawingOCR", { base64, mimeType });
  if (apiResult) return apiResult;

  const serverResult = await serverGenerateFromParts([
    { inlineData: { data: base64, mimeType } },
    { text: "Extrahera text och mÃ¥tt ur ritningen." },
  ]);
  if (serverResult) return serverResult;

  return "Offline OCR: Ingen automatisk texttolkning tillgÃ¤nglig. Kontrollera manuellt ritningens mÃ¥tt och etiketter.";
};

export const classifyAsset = async (base64: string, mimeType: string): Promise<string> => {
  const apiResult = await callGeminiApi<string>("classifyAsset", { base64, mimeType });
  if (apiResult) return apiResult;

  const serverResult = await serverGenerateFromParts([
    { inlineData: { data: base64, mimeType } },
    { text: "Klassificera fragmentet som SIGNATUR, KOMMUNVAPEN, STÃ„MPEL, RITNINGS_DEL eller SKRÃ„P." },
  ]);
  if (serverResult) return serverResult.trim().toUpperCase();

  const hint = `${base64.slice(0, 24)}${mimeType}`;
  const options = ["SIGNATUR", "KOMMUNVAPEN", "STÃ„MPEL", "RITNINGS_DEL", "SKRÃ„P"];
  let hash = 0;
  for (let i = 0; i < hint.length; i += 1) hash = (hash * 31 + hint.charCodeAt(i)) % 100000;
  return options[hash % options.length];
};

export const suggestStakeholders = async (location: string, description: string): Promise<Stakeholder[]> => {
  const apiResult = await callGeminiApi<Stakeholder[]>("suggestStakeholders", { location, description });
  if (apiResult && Array.isArray(apiResult) && apiResult.length > 0) return apiResult;

  const serverResult = await serverGenerateText(
    `FÃ¶reslÃ¥ intressenter fÃ¶r projekt vid ${location}. Beskrivning: ${description}. Svara i JSON-array med id, name, role, relevance.`
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

  const serverResult = await serverGenerateText(`Generera utkast fÃ¶r ${type}. Kontext: ${context}.`);
  if (serverResult) return serverResult;

  if (type === "background") {
    return `Projektet avser ${context || "angiven verksamhet"} och syftar till att uppfylla myndighetskrav med tydlig styrning, kontroll och uppfÃ¶ljning.`;
  }
  if (type === "description") {
    return `GenomfÃ¶rande sker etappvis med fokus pÃ¥ riskminimering, verifierad dokumentation och spÃ¥rbar leverans mot stage-gates.`;
  }
  return "1. KvalitetssÃ¤krad datainsamling. 2. Riskbaserad prioritering. 3. SpÃ¥rbar rapportering till berÃ¶rda intressenter.";
};

export const analyzeBiodiversity = async (
  lat: number,
  lng: number,
  providedObservations?: SpeciesObservation[],
  protectedAreas?: ProtectedArea[],
  geologicalData?: GeologicalData,
  monuments?: Monument[]
): Promise<{
  observations: SpeciesObservation[];
  protectedAreas: ProtectedArea[];
  geological?: GeologicalData;
  monuments?: Monument[];
  compliance?: SiteAnalysis;
  summary: string
}> => {
  const apiResult = await callGeminiApi<{
    observations: SpeciesObservation[];
    protectedAreas: ProtectedArea[];
    geological?: GeologicalData;
    monuments?: Monument[];
    compliance?: SiteAnalysis;
    summary: string
  }>("analyzeBiodiversity", {
    lat,
    lng,
    providedObservations,
    protectedAreas,
    geologicalData,
    monuments,
  });
  if (apiResult && Array.isArray(apiResult.observations)) return apiResult;

  const observations = providedObservations || [];

  const pAreas = protectedAreas || [];
  const geo = geologicalData || { soilType: "Information saknas", groundwaterVulnerability: "Ej bedÃ¶md" };
  const mons = monuments || [];

  // Calculate Hard Rules
  const compliance = evaluateComplianceRules(observations, pAreas, geo, mons);

  const obsList = observations.map(o => `${o.name} (${o.status})`).join(", ");
  const areaList = pAreas.map(a => `${a.name} (${a.type})`).join(", ");
  const monList = mons.map(m => `${m.name} (${m.type})`).join(", ");
  const ruleSummary = compliance.rules.map(r => `- ${r.title}: ${r.risk}`).join("\n");

  const serverResult = await serverGenerateText(
    `FULL SPATIAL COMPLIANCE AUDIT vid lat ${lat}, lng ${lng}. 

     BIOLOGI:
     NÃ¤rliggande arter: ${obsList}. 
     Skyddade omrÃ¥den: ${areaList || "Inga funna i omedelbar nÃ¤rhet"}. 

     GEOLOGI:
     Jordart: ${geo.soilType}.
     GrundvattensÃ¥rbarhet: ${geo.groundwaterVulnerability}.

     KULTURMILJÃ– (RAÃ„):
     FornlÃ¤mningar/Monument: ${monList || "Inga kÃ¤nda fynd vid platsen"}.

     SYSTEM-BEDÃ–MDA REGLER (MILJÃ–BALKEN & KML):
     ${ruleSummary || "Inga direkta regelfel funna."}

     TASK:
     Analysera geodataresultaten enligt MiljÃ¶balken (MB) och KulturmiljÃ¶lagen (KML). BedÃ¶m sannolikheten fÃ¶r tillstÃ¥nd. 
     Svara med en text som fÃ¶rklarar vilka kapitel i MB som berÃ¶rs (t.ex. 2 kap, 3 kap, 7 kap, 9 kap) och varfÃ¶r.`
  );

  if (serverResult) {
    return {
      summary: serverResult,
      observations,
      protectedAreas: pAreas,
      geological: geo,
      monuments: mons,
      compliance
    };
  }

  return {
    summary: "Offline-analys: OmrÃ¥det bÃ¶r screenas mot Natura 2000, fornlÃ¤mningar (FornsÃ¶k), kÃ¤nda observationer och SGU:s sÃ¥rbarhetskartor.",
    observations,
    protectedAreas: pAreas,
    geological: geo,
    monuments: mons,
    compliance
  };
};

export const predictWeatherRisk = async (municipality: string): Promise<WeatherRisk> => {
  const apiResult = await callGeminiApi<WeatherRisk>("predictWeatherRisk", { municipality });
  if (apiResult?.level) return apiResult;

  const serverResult = await serverGenerateText(`VÃ¤derrisk fÃ¶r schakt i ${municipality}.`);
  if (serverResult) {
    const level = serverResult.includes("HÃ¶g")
      ? ("HÃ¶g" as WeatherRisk["level"])
      : serverResult.includes("Medel")
        ? ("Medel" as WeatherRisk["level"])
        : ("LÃ¥g" as WeatherRisk["level"]);
    return { level, description: safeSnippet(serverResult, 180), action: "Planera erosionsskydd och uppfÃ¶ljning av nederbÃ¶rd." };
  }

  const level = weatherLevelFromMunicipality(municipality);
  return {
    level,
    description: `Offline-prognos fÃ¶r ${municipality}: normal drift med behov av daglig kontroll av nederbÃ¶rd och avrinning.`,
    action: "SÃ¤kerstÃ¤ll avvattning, invallning och uppdaterad vÃ¤derrutin i arbetsberedning.",
  };
};

export const autoFillFormSection = async (sectionTitle: string, propertyData: unknown): Promise<string> => {
  const apiResult = await callGeminiApi<string>("autoFillFormSection", { sectionTitle, propertyData: propertyData as Record<string, unknown> });
  if (apiResult) return apiResult;

  const serverResult = await serverGenerateText(
    `Skapa textutkast fÃ¶r formulÃ¤rdel "${sectionTitle}" med data: ${JSON.stringify(propertyData)}.`
  );
  if (serverResult) return serverResult;

  return `Offline-utkast fÃ¶r "${sectionTitle}": komplettera med verksamhetsbeskrivning, platsfÃ¶rutsÃ¤ttningar och kontrollrutiner.`;
};

export const fetchMunicipalityContext = async (
  municipality: string
): Promise<{ text: string; sources: GroundingSource[] }> => {
  const apiResult = await callGeminiApi<{ text: string; sources: GroundingSource[] }>("fetchMunicipalityContext", { municipality });
  if (apiResult?.text) return apiResult;

  const serverResult = await serverGenerateText(`MiljÃ¶- och tillsynskontext fÃ¶r ${municipality}.`);
  if (serverResult) return { text: serverResult, sources: [] };

  return {
    text: `Offline-kontext: ${municipality} har kommunal tillsyn med behov av tydlig C-anmÃ¤lan, kontrollprogram och dokumenterad riskhantering.`,
    sources: [],
  };
};

export const performSpatialAudit = async (
  lat: number,
  lng: number
): Promise<{ text: string; sources: GroundingSource[] }> => {
  const apiResult = await callGeminiApi<{ text: string; sources: GroundingSource[] }>("performSpatialAudit", { lat, lng });
  if (apiResult?.text) return apiResult;

  if (!hasWindow()) {
    try {
      const localAudit = await runSpatialAudit(lat, lng);
      return { text: localAudit.text, sources: localAudit.sources };
    } catch {
      // fall through to generic fallback
    }
  }

  const serverResult = await serverGenerateText(
    `Kort spatial riskbedomning for koordinat lat ${lat}, lng ${lng}, fokus pa vatten, skyddszoner och geoteknisk screening.`
  );
  if (serverResult) return { text: serverResult, sources: [] };

  return {
    text: "Offline spatial audit: kontrollera skyddade omraden, vattenrisker och geotekniska indikatorer manuellt innan projektering.",
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

  return `Offline-assistent: Jag kan ge generell vÃ¤gledning om tillstÃ¥nd, risk och dokumentstruktur. FrÃ¥ga mer specifikt sÃ¥ ger jag en konkret checklista.`;
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
    return `- Fokus: tydlig informationshierarki\n- Prioritera data Ã¶ver dekoration\n- Visa risk, gate-status och nÃ¤sta steg tidigt`;
  }
  if (style === "detailed") {
    return `FÃ¶reslagen riktning: bygg en tydlig top-down-layout med statusrad, handlingskort och sammanhangspanel. Placera riskindikatorer tidigt, och hÃ¥ll textnivÃ¥er konsekventa fÃ¶r snabb scanning.`;
  }
  return `Bygg en tydlig vy med status fÃ¶rst, handlingar sedan och detaljer sist.`;
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
    `Analysera marknadstrender fÃ¶r tillstÃ¥ndsdata: ${JSON.stringify(
      permits.slice(0, 40).map((item) => ({ municipality: item.municipality, waste: item.waste_codes, decision: item.decision_type }))
    )}`
  );
  if (serverResult) return { text: serverResult, sources: [] };

  const total = permits.length;
  const bifall = permits.filter((permit) => permit.decision_type === "BIFALL").length;
  const avslag = permits.filter((permit) => permit.decision_type === "AVSLAG").length;
  const topMunicipalities = [...new Set(permits.map((permit) => permit.municipality))].slice(0, 3).join(", ");

  return {
    text: `Offline-marknadsrapport: ${total} Ã¤renden analyserade. Bifall ${bifall}, avslag ${avslag}. Prioritera kommuner med hÃ¶g frekvens och tydlig dokumentkvalitet (${topMunicipalities || "inga kommuner"}).`,
    sources: [],
  };
};

export const analyzeCourtRuling = async (
  rulingText: string
): Promise<CourtRulingAnalysis | null> => {
  const apiResult = await callGeminiApi<CourtRulingAnalysis>("analyzeCourtRuling", { rulingText });
  if (apiResult) return apiResult;

  const prompt = `SYSTEM ROLE:
Environmental Legal Research Analyst

RULES:
1. STRICT EVIDENCE MODE. Only use the provided ruling text.
2. CITATION-LOCKING. Extract exact quotes from the ruling for key principles.

DOMAIN CONTEXT:
Swedish Land and Environment Court (Mark- och miljÃ¶domstolen) practice concerning environmental permits and waste handling.

TASK:
Analyze the following court ruling.
Determine:
1. legal principle
2. precedent value
3. relevance for waste handling projects
4. impact on permitting decisions

INPUT (RULING TEXT):
${rulingText}

OUTPUT FORMAT:
{
 "case_name": "",
 "court": "",
 "legal_principle": "",
 "precedent_strength": "low / medium / high",
 "relevance_for_project": "",
 "key_quotes": []
}

FAILSAFE:
If the ruling text is ambiguous, mark precedent_strength as "unknown" and state "Insufficient information".
`;

  const serverResult = await serverGenerateText(prompt);
  if (serverResult) {
    try {
      const jsonText = extractFirstJsonObject(serverResult);
      if (jsonText) {
        const parsed = JSON.parse(jsonText) as CourtRulingAnalysis;
        if (parsed && typeof parsed.legal_principle === "string") {
          return parsed;
        }
      }
    } catch {
      // fall through
    }
  }

  return {
    case_name: "OkÃ¤nt mÃ¥l (Offline Fallback)",
    court: "Mark- och miljÃ¶domstolen",
    legal_principle: "Kan ej faststÃ¤llas offline",
    precedent_strength: "unknown",
    relevance_for_project: "Systemet saknar anslutning till Gemini fÃ¶r att utvÃ¤rdera domstolsutslag.",
    key_quotes: []
  };
};

export const validateLabData = async (
  labData: string
): Promise<LabDataValidationResult | null> => {
  const apiResult = await callGeminiApi<LabDataValidationResult>("validateLabData", { labData });
  if (apiResult) return apiResult;

  const prompt = `SYSTEM ROLE:
Environmental Laboratory Data Validator

RULES:
1. STRICT EVIDENCE MODE. Evaluate only the provided laboratory data.
2. COMPARE AGAINST THRESHOLDS. Use Swedish environmental guideline values.

DOMAIN CONTEXT:
Swedish Environmental Protection Agency (NaturvÃ¥rdsverket) guidelines for contaminated soil and waste classification.

TASK:
Validate laboratory results against environmental guideline values.

INPUT:
<LAB_DATA>
${labData}
</LAB_DATA>

OUTPUT FORMAT:
{
 "status": "PASS / FAIL",
 "parameters_exceeding_limits": [],
 "applicable_guidelines": "",
 "environmental_risk_level": "low / medium / high"
}

FAILSAFE:
If the lab data is unreadable or guidelines are missing, set status to "UNKNOWN".
`;

  const serverResult = await serverGenerateText(prompt);
  if (serverResult) {
    try {
      const jsonText = extractFirstJsonObject(serverResult);
      if (jsonText) {
        const parsed = JSON.parse(jsonText) as LabDataValidationResult;
        if (parsed && typeof parsed.status === "string") {
          return parsed;
        }
      }
    } catch {
      // fall through
    }
  }

  return {
    status: "UNKNOWN",
    parameters_exceeding_limits: [],
    applicable_guidelines: "Systemet saknar anslutning till Gemini fÃ¶r att utvÃ¤rdera labdata.",
    environmental_risk_level: "unknown"
  };
};

export const analyzeLogisticsCompliance = async (
  params: {
    wasteCode: string;
    volume: string;
    storageDuration: string;
    location: string;
    receivingFacility: string;
  }
): Promise<LogisticsComplianceResult | null> => {
  const apiResult = await callGeminiApi<LogisticsComplianceResult>("analyzeLogisticsCompliance", params);
  if (apiResult) return apiResult;

  const prompt = `SYSTEM ROLE:
Environmental Mass Logistics Analyst

RULES:
1. STRICT EVIDENCE MODE. Assess only the provided logistics parameters.
2. REGULATORY FOCUS. Ensure transport and storage align with Swedish Waste chapters.

DOMAIN CONTEXT:
Swedish Environmental Code (MiljÃ¶balken) and Waste Ordinance (AvfallsfÃ¶rordningen) regarding logistics, intermediate storage, and transport of masses.

TASK:
Evaluate whether the proposed transport and storage of waste complies with regulations.

INPUT:
- waste code: ${params.wasteCode}
- volume: ${params.volume}
- storage duration: ${params.storageDuration}
- location: ${params.location}
- receiving facility: ${params.receivingFacility}

OUTPUT FORMAT:
{
 "storage_compliance": "",
 "transport_requirements": [],
 "environmental_risks": [],
 "recommended_actions": []
}

FAILSAFE:
If logistics data is incomplete, list "OkÃ¤nd risk" in environmental_risks and request clarification.
`;

  const serverResult = await serverGenerateText(prompt);
  if (serverResult) {
    try {
      const jsonText = extractFirstJsonObject(serverResult);
      if (jsonText) {
        const parsed = JSON.parse(jsonText) as LogisticsComplianceResult;
        if (parsed && typeof parsed.storage_compliance === "string") {
          return parsed;
        }
      }
    } catch {
      // fall through
    }
  }

  return {
    storage_compliance: "Kan ej faststÃ¤llas offline. Systemet saknar anslutning till Gemini.",
    transport_requirements: [],
    environmental_risks: ["OkÃ¤nd risk (Offline)"],
    recommended_actions: ["LÃ¶s nÃ¤tverksproblem fÃ¶r komplett bedÃ¶mning."]
  };
};

