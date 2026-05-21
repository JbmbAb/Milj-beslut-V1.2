// Vertex AI används server-side via `server/services/vertexAiService.ts`.
// Klientsidan anropar plattformens egna /api/gemini-endpoint vilket i sin tur
// går mot Vertex. Direktanrop till Google GenerativeAI SDK är avvecklat i
// spår 10b (Vertex-migration).
import { CircuitBreaker } from '../server/utils/circuitBreaker';
import type { Permit, SpeciesObservation, Stakeholder, WeatherRisk } from '../types';
import type { ProtectedArea, GeologicalData, Monument, SiteAnalysis } from '../src/types/geo';

type HistoryItem = { role: 'user' | 'model'; content: string };
type GroundingSource = { web?: { uri: string; title?: string } };
type FigmaAiHistoryItem = { role: 'user' | 'model'; content: string };

type FigmaUiSection = {
  type: 'hero' | 'card' | 'list';
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
  precedent_strength: 'low' | 'medium' | 'high' | 'unknown';
  relevance_for_project: string;
  key_quotes: string[];
};

export type LabDataValidationResult = {
  status: 'PASS' | 'FAIL' | 'UNKNOWN';
  parameters_exceeding_limits: string[];
  applicable_guidelines: string;
  environmental_risk_level: 'low' | 'medium' | 'high' | 'unknown';
};

export type LogisticsComplianceResult = {
  storage_compliance: string;
  transport_requirements: string[];
  environmental_risks: string[];
  recommended_actions: string[];
};

const TOKEN_KEY = 'miljobeslut_admin_bearer';

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

const geminiCircuit = new CircuitBreaker('Vertex-AI', {
  failureThreshold: 3,
  recoveryTimeoutMs: 60000, // 1 minute
});

function isNodeRuntime(): boolean {
  return typeof process !== 'undefined' && Boolean(process.versions?.node);
}

function hasWindow(): boolean {
  return typeof window !== 'undefined' && !isNodeRuntime();
}

function isVertexConfigured(): boolean {
  if (typeof process === 'undefined' || !process.env) return false;
  return Boolean(String(process.env.VERTEX_PROJECT_ID || '').trim());
}

export async function serverGenerateText(prompt: string): Promise<string | null> {
  if (hasWindow() || !isVertexConfigured()) return null;

  return geminiCircuit
    .execute(async () => {
      const { generateTextWithVertex } = await import('../server/services/vertexAiService');
      const text = await generateTextWithVertex(prompt, {
        profile: 'fast',
        systemInstruction: GEMINI_SYSTEM_PROMPT,
      });
      return text.trim() || null;
    })
    .catch((error) => {
      console.error('Vertex Circuit Breaker caught error:', error.message);
      return null;
    });
}

async function serverGenerateFromParts(parts: unknown[]): Promise<string | null> {
  if (hasWindow() || !isVertexConfigured()) return null;

  return geminiCircuit
    .execute(async () => {
      const { generateTextWithVertex } = await import('../server/services/vertexAiService');
      const flattened = (parts as Array<{ text?: string }>)
        .map((part) => (typeof part?.text === 'string' ? part.text : ''))
        .filter(Boolean)
        .join('\n\n');
      if (!flattened) return null;
      const text = await generateTextWithVertex(flattened, {
        profile: 'fast',
        systemInstruction: GEMINI_SYSTEM_PROMPT,
      });
      return text.trim() || null;
    })
    .catch((error) => {
      console.error('Vertex Circuit Breaker caught error:', error.message);
      return null;
    });
}

async function callGeminiApi<T>(method: string, payload: Record<string, unknown>): Promise<T | null> {
  if (!hasWindow()) return null;
  try {
    const token = String(window.localStorage.getItem(TOKEN_KEY) || '').trim();
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;

    const response = await fetch('/api/gemini', {
      method: 'POST',
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
  const normalized = String(text || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return '';
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max - 1)}â€¦`;
}

function extractFirstJsonObject(text: string): string | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  return text.slice(start, end + 1);
}

function unavailable<T>(feature: string): T {
  throw new Error(`${feature} saknar verifierad AI-källa. Endast BankID får köras som demo/mock.`);
}

export const analyzePermitRisk = async (permit: Permit): Promise<string> => {
  const apiResult = await callGeminiApi<string>('analyzePermitRisk', { permit });
  if (apiResult) return apiResult;

  const serverResult = await serverGenerateText(
    `Analysera risker fÃ¶r miljÃ¶beslut. Kommun: ${permit.municipality}. Fastighet: ${permit.property_id}. Avfallskod: ${permit.waste_codes}. Text: ${permit.full_text}`,
  );
  if (serverResult) return serverResult;

  return unavailable('Riskanalys');
};

export const chatWithPermit = async (
  permit: Permit,
  message: string,
  history: HistoryItem[],
): Promise<string> => {
  const apiResult = await callGeminiApi<string>('chatWithPermit', { permit, message, history });
  if (apiResult) return apiResult;

  const serverResult = await serverGenerateFromParts([
    { text: `Beslutstext fÃ¶r ${permit.property_id} i ${permit.municipality}: ${permit.full_text}` },
    ...history.map((item) => ({ text: `${item.role}: ${item.content}` })),
    { text: message },
  ]);
  if (serverResult) return serverResult;

  return unavailable('AI-chatt');
};

export const analyzeSiteImage = async (base64: string, mimeType: string): Promise<string> => {
  const apiResult = await callGeminiApi<string>('analyzeSiteImage', { base64, mimeType });
  if (apiResult) return apiResult;

  const serverResult = await serverGenerateFromParts([
    { inlineData: { data: base64, mimeType } },
    { text: 'Identifiera potentiella miljÃ¶risker i bilden.' },
  ]);
  if (serverResult) return serverResult;

  return unavailable('Bildanalys');
};

export const analyzeTechnicalDrawing = async (base64: string, mimeType: string): Promise<string> => {
  const apiResult = await callGeminiApi<string>('analyzeTechnicalDrawing', { base64, mimeType });
  if (apiResult) return apiResult;

  const serverResult = await serverGenerateFromParts([
    { inlineData: { data: base64, mimeType } },
    { text: 'TolkningsstÃ¶d fÃ¶r teknisk ritning.' },
  ]);
  if (serverResult) return serverResult;

  return unavailable('Ritningsanalys');
};

export const analyzeDrawingOCR = async (base64: string, mimeType: string): Promise<string> => {
  const apiResult = await callGeminiApi<string>('analyzeDrawingOCR', { base64, mimeType });
  if (apiResult) return apiResult;

  const serverResult = await serverGenerateFromParts([
    { inlineData: { data: base64, mimeType } },
    { text: 'Extrahera text och mÃ¥tt ur ritningen.' },
  ]);
  if (serverResult) return serverResult;

  return unavailable('Ritnings-OCR');
};

export const classifyAsset = async (base64: string, mimeType: string): Promise<string> => {
  const apiResult = await callGeminiApi<string>('classifyAsset', { base64, mimeType });
  if (apiResult) return apiResult;

  const serverResult = await serverGenerateFromParts([
    { inlineData: { data: base64, mimeType } },
    { text: 'Klassificera fragmentet som SIGNATUR, KOMMUNVAPEN, STÃ„MPEL, RITNINGS_DEL eller SKRÃ„P.' },
  ]);
  if (serverResult) return serverResult.trim().toUpperCase();

  return unavailable('Asset-klassificering');
};

export const suggestStakeholders = async (location: string, description: string): Promise<Stakeholder[]> => {
  const apiResult = await callGeminiApi<Stakeholder[]>('suggestStakeholders', { location, description });
  if (apiResult && Array.isArray(apiResult) && apiResult.length > 0) return apiResult;

  const serverResult = await serverGenerateText(
    `FÃ¶reslÃ¥ intressenter fÃ¶r projekt vid ${location}. Beskrivning: ${description}. Svara i JSON-array med id, name, role, relevance.`,
  );
  if (serverResult) {
    try {
      const jsonMatch = serverResult.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]) as Stakeholder[];
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {
      // fall through to empty result
    }
  }

  return [];
};

export const generatePlanDraft = async (
  type: 'background' | 'goals' | 'description',
  context: string,
): Promise<string> => {
  const apiResult = await callGeminiApi<string>('generatePlanDraft', { type, context });
  if (apiResult) return apiResult;

  const serverResult = await serverGenerateText(`Generera utkast fÃ¶r ${type}. Kontext: ${context}.`);
  if (serverResult) return serverResult;

  return unavailable('Planutkast');
};

export const analyzeBiodiversity = async (
  lat: number,
  lng: number,
  providedObservations?: SpeciesObservation[],
  protectedAreas?: ProtectedArea[],
  geologicalData?: GeologicalData,
  monuments?: Monument[],
): Promise<{
  observations: SpeciesObservation[];
  protectedAreas: ProtectedArea[];
  geological?: GeologicalData;
  monuments?: Monument[];
  compliance?: SiteAnalysis;
  summary: string;
}> => {
  const apiResult = await callGeminiApi<{
    observations: SpeciesObservation[];
    protectedAreas: ProtectedArea[];
    geological?: GeologicalData;
    monuments?: Monument[];
    compliance?: SiteAnalysis;
    summary: string;
  }>('analyzeBiodiversity', {
    lat,
    lng,
    providedObservations,
    protectedAreas,
    geologicalData,
    monuments,
  });
  if (apiResult && Array.isArray(apiResult.observations)) return apiResult;

  return unavailable('Biodiversitetsanalys');
};

export const predictWeatherRisk = async (municipality: string): Promise<WeatherRisk> => {
  const apiResult = await callGeminiApi<WeatherRisk>('predictWeatherRisk', { municipality });
  if (apiResult?.level) return apiResult;

  const serverResult = await serverGenerateText(`Väderrisk för schakt i ${municipality}.`);
  if (serverResult) {
    const level = serverResult.includes('Hög')
      ? ('Hög' as WeatherRisk['level'])
      : serverResult.includes('Medel')
        ? ('Medel' as WeatherRisk['level'])
        : ('Låg' as WeatherRisk['level']);
    return {
      level,
      description: safeSnippet(serverResult, 180),
      action: 'Planera erosionsskydd och uppföljning av nederbörd.',
      source: 'Gemini AI',
      fetchedAt: new Date().toISOString(),
    };
  }

  return unavailable('Väderrisk');
};

export const autoFillFormSection = async (sectionTitle: string, propertyData: unknown): Promise<string> => {
  const apiResult = await callGeminiApi<string>('autoFillFormSection', {
    sectionTitle,
    propertyData: propertyData as Record<string, unknown>,
  });
  if (apiResult) return apiResult;

  const serverResult = await serverGenerateText(
    `Skapa textutkast fÃ¶r formulÃ¤rdel "${sectionTitle}" med data: ${JSON.stringify(propertyData)}.`,
  );
  if (serverResult) return serverResult;

  return unavailable('Formulärförslag');
};

export const fetchMunicipalityContext = async (
  municipality: string,
): Promise<{ text: string; sources: GroundingSource[] }> => {
  const apiResult = await callGeminiApi<{ text: string; sources: GroundingSource[] }>(
    'fetchMunicipalityContext',
    { municipality },
  );
  if (apiResult?.text) return apiResult;

  const serverResult = await serverGenerateText(`MiljÃ¶- och tillsynskontext fÃ¶r ${municipality}.`);
  if (serverResult) return { text: serverResult, sources: [] };

  return unavailable('Kommunkontext');
};

export const performSpatialAudit = async (
  lat: number,
  lng: number,
): Promise<{ text: string; sources: GroundingSource[] }> => {
  const apiResult = await callGeminiApi<{ text: string; sources: GroundingSource[] }>('performSpatialAudit', {
    lat,
    lng,
  });
  if (apiResult?.text) return apiResult;

  if (!hasWindow()) {
    try {
      const serverModulePath = '../server/services/spatialAuditService';
      const { runSpatialAudit } = await import(/* @vite-ignore */ serverModulePath);
      const localAudit = await runSpatialAudit(lat, lng);
      return { text: localAudit.text, sources: localAudit.sources };
    } catch {
      // fall through to unavailable result
    }
  }

  const serverResult = await serverGenerateText(
    `Kort spatial riskbedomning for koordinat lat ${lat}, lng ${lng}, fokus pa vatten, skyddszoner och geoteknisk screening.`,
  );
  if (serverResult) return { text: serverResult, sources: [] };

  return unavailable('Spatial audit');
};

export const askGeneralAssistant = async (message: string, history: HistoryItem[] = []): Promise<string> => {
  const apiResult = await callGeminiApi<string>('askGeneralAssistant', { message, history });
  if (apiResult) return apiResult;

  const serverResult = await serverGenerateFromParts([
    ...history.map((item) => ({ text: `${item.role}: ${item.content}` })),
    { text: message },
  ]);
  if (serverResult) return serverResult;

  return unavailable('Allmän AI-assistent');
};

export const generateFigmaAiResponse = async (
  prompt: string,
  options: { context?: string; style?: 'brief' | 'detailed' | 'bullet'; history?: FigmaAiHistoryItem[] } = {},
): Promise<string> => {
  const style = options.style || 'brief';
  const context = (options.context || '').trim();
  const history = options.history || [];

  const serverResult = await serverGenerateFromParts([
    { text: 'You are Miljöbeslut AI design copilot for Swedish environmental workflows.' },
    ...(context ? [{ text: `Context: ${context}` }] : []),
    ...history.map((item) => ({ text: `${item.role}: ${item.content}` })),
    { text: `Style: ${style}` },
    { text: `Prompt: ${prompt}` },
  ]);
  if (serverResult) return serverResult;

  return unavailable('Figma AI-svar');
};

export const generateFigmaUiSpec = async (
  prompt: string,
  options: { context?: string; style?: 'brief' | 'detailed' | 'bullet' } = {},
): Promise<FigmaUiSpec> => {
  const context = (options.context || '').trim();
  const style = options.style || 'brief';

  const serverResult = await serverGenerateText(
    `Generate JSON only with schema {title,width,sections[]}. Prompt: ${prompt}. Context: ${context}. Style: ${style}.`,
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

  return unavailable('Figma UI-specifikation');
};

export const processDocumentOCR = async (
  _base64: string,
  _type: string,
): Promise<{ property_id: string; municipality: string }> => {
  return unavailable('Dokument-OCR');
};

export const generateMarketingSummary = async (
  permits: Permit[],
): Promise<{ text: string; sources: GroundingSource[] }> => {
  const apiResult = await callGeminiApi<{ text: string; sources: GroundingSource[] }>(
    'generateMarketingSummary',
    { permits },
  );
  if (apiResult?.text) return apiResult;

  const serverResult = await serverGenerateText(
    `Analysera marknadstrender fÃ¶r tillstÃ¥ndsdata: ${JSON.stringify(
      permits.slice(0, 40).map((item) => ({
        municipality: item.municipality,
        waste: item.waste_codes,
        decision: item.decision_type,
      })),
    )}`,
  );
  if (serverResult) return { text: serverResult, sources: [] };

  return unavailable('Marknadssammanfattning');
};

export const analyzeCourtRuling = async (rulingText: string): Promise<CourtRulingAnalysis | null> => {
  const apiResult = await callGeminiApi<CourtRulingAnalysis>('analyzeCourtRuling', { rulingText });
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
        if (parsed && typeof parsed.legal_principle === 'string') {
          return parsed;
        }
      }
    } catch {
      // fall through
    }
  }

  return unavailable('Domstolsanalys');
};

export const validateLabData = async (labData: string): Promise<LabDataValidationResult | null> => {
  const apiResult = await callGeminiApi<LabDataValidationResult>('validateLabData', { labData });
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
        if (parsed && typeof parsed.status === 'string') {
          return parsed;
        }
      }
    } catch {
      // fall through
    }
  }

  return unavailable('Labdatavalidering');
};

export const analyzeLogisticsCompliance = async (params: {
  wasteCode: string;
  volume: string;
  storageDuration: string;
  location: string;
  receivingFacility: string;
}): Promise<LogisticsComplianceResult | null> => {
  const apiResult = await callGeminiApi<LogisticsComplianceResult>('analyzeLogisticsCompliance', params);
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
        if (parsed && typeof parsed.storage_compliance === 'string') {
          return parsed;
        }
      }
    } catch {
      // fall through
    }
  }

  return unavailable('Logistikcompliance');
};
