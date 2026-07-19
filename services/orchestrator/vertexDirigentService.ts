import { GoogleGenerativeAI } from '@google/generative-ai';
import fs from 'fs';
import path from 'path';

export interface EnvironmentalDataInput {
    propertyId: string; // Endast anonymiserat ID/Pseudonym, ingen PII!
    geometry: any; // Fastighetsgräns (GeoJSON)
    sgu: {
        soilTypes: string[];
        bedrockTypes: string[];
        distanceToNearestWellMeters: number | null;
    };
    hydrography: {
        distanceToSurfaceWaterMeters: number | null;
        isWaterProtectionArea: boolean;
    };
    ebh: {
        contaminatedAreasWithin500m: number;
    };
    slu?: {
        observations: any[];
        message?: string;
    };
    smhi?: any;
    boverket?: {
        relevantRegulations: string[];
    };
    bolagsverket?: {
        status: string;
        message: string;
    };
    trafikverket?: {
        status: string;
        message: string;
        mockData?: any;
        roads?: any[];
    };
    requestType: 'ENSKILT_AVLOPP' | 'BYGGLOV' | 'GENERELL_DOSSIER';
}

export interface DirigentResponse {
    summary: string;
    riskClass: 'LÅG' | 'MEDEL' | 'HÖG';
    recommendations: Array<{
        text: string;
        citation: {
            lawChapter: string;
            sourceText: string;
            sourceLink?: string;
        };
    }>;
}

/**
 * VertexDirigentService ("Dirigenten")
 * 
 * Detta är hjärnan i systemet. Den tar emot tvättad och strukturerad miljödata
 * och applicerar juridiskt ramverk från vår lokala kunskapsbas för att generera
 * spårbara rekommendationer utan att läcka PII.
 */
export class VertexDirigentService {
    private getModel(): any {
        if (!process.env.GEMINI_API_KEY) {
            throw new Error("GEMINI_API_KEY saknas i .env.local!");
        }

        // Initiera vanliga Gemini-klienten för lokal utveckling (gratisnyckeln)
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

        // Vi använder Gemini 1.5 Flash för snabba och effektiva juridiska svar
        return genAI.getGenerativeModel({
            model: 'gemini-1.5-flash',
            generationConfig: {
                temperature: 0.1, // Låg temperatur för konsekventa, juridiska svar
                responseMimeType: 'application/json', // Tvinga JSON-utdata
            }
        });
    }

    /**
     * Laddar in regelverk (HVMFS, MIFO, BBR) i promptens kontext
     */
    private loadKnowledgeBaseContext(requestType: string): string {
        let context = "Tillämpliga Regelverk och Handböcker:\n\n";
        const kbPath = path.join(process.cwd(), 'dossiers', 'knowledge_base');
        
        try {
            if (requestType === 'ENSKILT_AVLOPP') {
                const havPath = path.join(kbPath, 'hav', 'enskilt_avlopp_hvmfs_2016_17.md');
                if (fs.existsSync(havPath)) {
                    context += fs.readFileSync(havPath, 'utf8') + "\n\n";
                }
            }
            
            // Alltid ladda MIFO för potentiellt förorenade områden
            const mifoPath = path.join(kbPath, 'naturvardsverket', 'mifo_metodik.md');
            if (fs.existsSync(mifoPath)) {
                context += fs.readFileSync(mifoPath, 'utf8') + "\n\n";
            }
        } catch (e) {
            console.error("Kunde inte läsa kunskapsbasen:", e);
        }

        return context;
    }

    /**
     * Huvudmetod för att generera en miljöbedömning ("Dossier")
     */
    async generateDossier(data: EnvironmentalDataInput): Promise<DirigentResponse> {
        console.log(`🎵 Dirigenten komponerar dossier för ${data.propertyId} (${data.requestType})...`);

        // 1. Bygg kontext (Regelverk)
        const knowledgeContext = this.loadKnowledgeBaseContext(data.requestType);

        // 2. Bygg prompt (Säkerställ att ingen PII finns i 'data' objektet)
        const prompt = `
            Du är 'Dirigenten', en AI-assistent för svenska miljöbeslut och bygglov.
            Din uppgift är att analysera de geografiska och geologiska förutsättningarna för en fastighet 
            och matcha dessa mot gällande svensk lagstiftning och myndighetsråd (t.ex. HaV, Boverket, Naturvårdsverket).
            
            Fakta om fastigheten (PII-tvättad):
            ${JSON.stringify(data, null, 2)}
            
            ${knowledgeContext}
            
            INSTRUKTIONER:
            1. Analysera datan utifrån regelverken ovan.
            2. Identifiera eventuella miljörisker (t.ex. närhet till brunn, lera).
            3. Skapa rekommendationer för handläggaren.
            4. Varje rekommendation MÅSTE ha en källhänvisning (citation) till en specifik del av regelverket.
            5. Svara ENDAST i strikt JSON-format enligt följande schema:
            {
                "summary": "En övergripande sammanfattning (2-3 meningar)",
                "riskClass": "LÅG", "MEDEL" eller "HÖG",
                "recommendations": [
                    {
                        "text": "Själva rådet eller varningen...",
                        "citation": {
                            "lawChapter": "t.ex. HVMFS 2016:17",
                            "sourceText": "Citat eller sammanfattning från regeln",
                            "sourceLink": "eventuell URL"
                        }
                    }
                ]
            }
        `;

        try {
            const chatResponse = await this.getModel().generateContent(prompt);

            const resultText = chatResponse.response.text();
            
            if (!resultText) {
                throw new Error("Gemini returnerade inget svar.");
            }

            // Vertex/Gemini returnerar ofta json inbäddat i markdown block ```json ... ```
            const cleanJson = resultText.replace(/```json\n?|```/g, '').trim();
            const parsedData = JSON.parse(cleanJson) as DirigentResponse;

            console.log("✅ Dirigenten är klar. JSON-strukturerad dossier genererad med källhänvisningar.");
            return parsedData;

        } catch (error: any) {
            console.error("❌ Fel i Gemini Dirigent:", error.message);
            throw error;
        }
    }
}

export const vertexDirigent = new VertexDirigentService();
