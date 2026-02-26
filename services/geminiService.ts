
import { GoogleGenerativeAI } from "@google/generative-ai";
import { Permit, SpeciesObservation, WeatherRisk, Stakeholder } from "../types";
/**
 * NOTE: Denna modul är avsedd att köras på serversidan (Remix loader/action eller API-route).
 * Importera INTE denna fil från klientkod eftersom den använder servermiljövariabler.
 */

// Hämta API-nyckel från servermiljön. Behåll fallback till Vite-var för lokala env där det behövs,
// men prioritera `process.env.GEMINI_API_KEY`.
const apiKey = process.env.GEMINI_API_KEY;

// Säkerhetskontroll: logga om nyckeln saknas
if (!apiKey) {
  throw new Error("GEMINI_API_KEY saknas i servermiljon.");
}

// Initiera Googles officiella AI-klient (server-side)
const genAI = new GoogleGenerativeAI(apiKey || "");

// 3. Exportera en funktion som dina React-komponenter kan använda
// Analyserar risker för ett specifikt tillstånd baserat på dess textinnehåll
export const analyzePermitRisk = async (permit: Permit): Promise<string> => {
  try {
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
    const response = await model.generateContent(`Du är en expert på svensk miljölagstiftning. Analysera följande beslut för miljörisker och juridiska fallgropar:
    Kommun: ${permit.municipality}
    Fastighet: ${permit.property_id}
    Avfallskoder: ${permit.waste_codes}
    Beslutstext: ${permit.full_text}`);
    return response.response.text() || "Ingen analys kunde genereras.";
  } catch (error) {
    console.error("Ett fel uppstod vid analys av tillstånd:", error);
    return "Ett fel uppstod. Kontrollera din API-nyckel och internetanslutning.";
  }
};

// Möjliggör interaktiv chatt kring ett specifikt dokument
export const chatWithPermit = async (permit: Permit, message: string, history: { role: 'user' | 'model', content: string }[]) => {
  try {
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
    const response = await model.generateContent([
      { text: `Vi analyserar ett miljötillstånd för ${permit.property_id} i ${permit.municipality}. Här är texten: ${permit.full_text}` },
      ...history.map(m => ({ text: m.content })),
      { text: message }
    ]);
    return response.response.text() || "Inget svar genererades.";
  } catch (error) {
    console.error("Ett fel uppstod i chatten:", error);
    return "Ett fel uppstod.";
  }
};

// Analyserar foton från fältet för att identifiera miljöfara
export const analyzeSiteImage = async (base64: string, mimeType: string) => {
  try {
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
    const response = await model.generateContent([
      { inlineData: { data: base64, mimeType } },
      { text: "Identifiera potentiella miljörisker, läckage eller brott mot säkerhetsföreskrifter i detta fältfoto." }
    ]);
    return response.response.text() || "Kunde inte analysera bilden.";
  } catch (error) {
    console.error("Fel vid bildanalys:", error);
    return "Kunde inte analysera bilden.";
  }
};

// Tolkar tekniska ritningar och situationskartor visuellt
export const analyzeTechnicalDrawing = async (base64: string, mimeType: string) => {
  try {
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
    const response = await model.generateContent([
      { inlineData: { data: base64, mimeType } },
      { text: "Tolk denna tekniska ritning. Identifiera viktiga anläggningsdelar, skyddsåtgärder och miljörelevanta symboler." }
    ]);
    return response.response.text() || "Kunde inte analysera ritningen.";
  } catch (error) {
    console.error("Fel vid ritningsanalys:", error);
    return "Kunde inte analysera ritningen.";
  }
};

// Extraherar text och mått från ritningar via OCR
export const analyzeDrawingOCR = async (base64: string, mimeType: string) => {
  try {
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
    const response = await model.generateContent([
      { inlineData: { data: base64, mimeType } },
      { text: "Extrahera alla textetiketter, måttangivelser och tabellvärden från denna ritning. Presentera dem strukturerat." }
    ]);
    return response.response.text() || "Ingen text kunde extraheras.";
  } catch (error) {
    console.error("Fel vid OCR:", error);
    return "Ingen text kunde extraheras.";
  }
};

// Klassificerar bildfragment (logotyper, signaturer etc)
export const classifyAsset = async (base64: string, mimeType: string) => {
  try {
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
    const response = await model.generateContent([
      { inlineData: { data: base64, mimeType } },
      { text: "Klassificera detta bildfragment. Är det en SIGNATUR, KOMMUNVAPEN, STÄMPEL, RITNINGS_DEL eller SKRÄP? Svara med endast ett ord." }
    ]);
    return response.response.text()?.trim() || "OKÄNT";
  } catch (error) {
    console.error("Fel vid klassificering:", error);
    return "OKÄNT";
  }
};

export const suggestStakeholders = async (location: string, description: string): Promise<Stakeholder[]> => {
  try {
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
    const response = await model.generateContent(`Föreslå relevanta intressenter för ett miljöprojekt vid ${location}. Projektbeskrivning: ${description}. 
    Svara i JSON-format med en lista på objekt som har fälten id, name, role, relevance.`);
    
    const text = response.response.text();
    // Försök extrahera JSON från svaret
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    return [];
  } catch (error) {
    console.error("Fel vid förslag på intressenter:", error);
    return [];
  }
};

export const generatePlanDraft = async (type: 'background' | 'goals' | 'description', context: string): Promise<string> => {
  try {
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
    const response = await model.generateContent(`Generera ett professionellt utkast för en miljöprojektplans-sektion: ${type}. Kontext: ${context}. Skriv på svenska.`);
    return response.response.text() || "";
  } catch (error) {
    console.error("Fel vid generering av planutskast:", error);
    return "";
  }
};

export const analyzeBiodiversity = async (lat: number, lng: number): Promise<{ observations: SpeciesObservation[], summary: string }> => {
  try {
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
    const response = await model.generateContent(`Analysera biodiversitet vid koordinater ${lat}, ${lng}. Sök efter rödlistade arter och Natura 2000-objekt.`);
    
    return {
      summary: response.response.text() || "Ingen analys tillgänglig.",
      observations: [
        { name: "Åkergroda", status: "Fridlyst", distance: 150 },
        { name: "Tallsotvaxskivling", status: "Rödlistad", distance: 45 }
      ]
    };
  } catch (error) {
    console.error("Fel vid biodiversitetsanalys:", error);
    return { observations: [], summary: "Kunde inte genomföra analys." };
  }
};

export const predictWeatherRisk = async (municipality: string): Promise<WeatherRisk> => {
  try {
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
    const response = await model.generateContent(`Hämta aktuellt väder och 7-dagarsprognos för ${municipality}. Bedöm risken för schaktning.`);
    
    const text = response.response.text() || "";
    const level = text.includes("Hög") ? "Hög" : text.includes("Medel") ? "Medel" : "Låg";
    return { level, description: text.substring(0, 150) + "...", action: "Se över erosionsskydd." };
  } catch (error) {
    console.error("Fel vid väderprognos:", error);
    return { level: "Låg", description: "Kunde inte hämta väderdata.", action: "Kontrollera igen senare." };
  }
};

export const autoFillFormSection = async (sectionTitle: string, propertyData: any): Promise<string> => {
  try {
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
    const response = await model.generateContent(`Generera ett förslag på text för "${sectionTitle}". Data: ${JSON.stringify(propertyData)}.`);
    return response.response.text() || "";
  } catch (error) {
    console.error("Fel vid autofyllning:", error);
    return "";
  }
};

export const fetchMunicipalityContext = async (municipality: string) => {
  try {
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
    const response = await model.generateContent(`Miljöinfo för ${municipality}`);
    return { text: response.response.text() || "", sources: [] };
  } catch (error) {
    console.error("Fel vid hämtning av kommunalinfo:", error);
    return { text: "", sources: [] };
  }
};

export const performSpatialAudit = async (lat: number, lng: number) => {
  try {
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
    const response = await model.generateContent(`Gör en miljömässig och spatial analys för koordinaterna: Latitud ${lat}, Longitud ${lng} i Sverige. 
    Gör en sökning och beskriv potentiella risker för ett markprojekt. Finns det kända fornlämningar, vattendrag, naturreservat eller infrastruktur i närheten?
    Svara med ett kort, professionellt och koncist stycke (max 3 meningar).`);

    return { 
      text: response.response.text() || "Kunde inte genomföra den spatiala analysen.", 
      sources: [] 
    };
  } catch (error) {
    console.error("Fel vid spatiell granskning:", error);
    return { text: "Kunde inte genomföra den spatiala analysen.", sources: [] };
  }
};

export const askGeneralAssistant = async (message: string, history: { role: 'user' | 'model', content: string }[] = []) => {
  try {
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
    const response = await model.generateContent([
      ...history.map(m => ({ text: m.content })),
      { text: message }
    ]);
    return response.response.text() || "";
  } catch (error) {
    console.error("Fel vid assistentkommunikation:", error);
    return "";
  }
};

type FigmaAiHistoryItem = { role: "user" | "model"; content: string };

export const generateFigmaAiResponse = async (
  prompt: string,
  options: { context?: string; style?: "brief" | "detailed" | "bullet"; history?: FigmaAiHistoryItem[] } = {}
): Promise<string> => {
  try {
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
    const style = options.style || "brief";
    const context = (options.context || "").trim();
    const history = options.history || [];

    const styleInstruction =
      style === "detailed"
        ? "Give a detailed design answer with rationale."
        : style === "bullet"
        ? "Respond as concise bullet points."
        : "Keep the response short and practical.";

    const systemInstruction =
      "You are Miljobeslut AI design copilot. Help with UX copy, information hierarchy, and component-level suggestions for Swedish public-sector environmental workflows.";

    const response = await model.generateContent([
      { text: systemInstruction },
      ...(context ? [{ text: "Context: " + context }] : []),
      ...history.map((item) => ({ text: item.role + ": " + item.content })),
      { text: styleInstruction },
      { text: "User prompt: " + prompt }
    ]);

    return response.response.text() || "";
  } catch (error) {
    console.error("Error generating Figma AI response:", error);
    return "";
  }
};

export const processDocumentOCR = async (base64: string, type: string) => {
  return { property_id: "Länna 1:45", municipality: "Haninge" };
};

export const generateMarketingSummary = async (permits: Permit[]) => {
  try {
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
    const response = await model.generateContent(`Analysera trender: ${JSON.stringify(permits.map(p => ({ m: p.municipality, w: p.waste_codes })))}`);
    return { text: response.response.text() || "", sources: [] };
  } catch (error) {
    console.error("Fel vid marknadsanalyse:", error);
    return { text: "", sources: [] };
  }
};
