import type { SpeciesObservation } from '../../types';
import { evaluateComplianceRules, type SiteAnalysis } from './complianceRuleEngine';
import type { ProtectedArea } from './nvrService';
import type { GeologicalData } from './sguService';
import type { Monument } from './raaService';
import { generateTextWithVertex } from './vertexAiService';
import { GEMINI_SYSTEM_PROMPT } from './geminiSystemPrompt';

export type BiodiversityAnalysisResult = {
  observations: SpeciesObservation[];
  protectedAreas: ProtectedArea[];
  geological?: GeologicalData;
  monuments?: Monument[];
  compliance?: SiteAnalysis;
  summary: string;
};

export async function analyzeBiodiversityWithCompliance(
  lat: number,
  lng: number,
  providedObservations?: SpeciesObservation[],
  protectedAreas?: ProtectedArea[],
  geologicalData?: GeologicalData,
  monuments?: Monument[],
): Promise<BiodiversityAnalysisResult> {
  const observations = providedObservations ?? [];
  const pAreas = protectedAreas ?? [];
  const geo = geologicalData ?? { soilType: 'Information saknas', groundwaterVulnerability: 'Ej bedömd' };
  const mons = monuments ?? [];

  const compliance = evaluateComplianceRules(observations, pAreas, geo, mons);

  const obsList = observations.map((o) => `${o.name} (${o.status})`).join(', ');
  const areaList = pAreas.map((a) => `${a.name} (${a.type})`).join(', ');
  const monList = mons.map((m) => `${m.name} (${m.type})`).join(', ');
  const ruleSummary = compliance.rules.map((r) => `- ${r.title}: ${r.risk}`).join('\n');

  const prompt = `FULL SPATIAL COMPLIANCE AUDIT vid lat ${lat}, lng ${lng}.

     BIOLOGI:
     Närliggande arter: ${obsList}.
     Skyddade områden: ${areaList || 'Inga funna i omedelbar närhet'}.

     GEOLOGI:
     Jordart: ${geo.soilType}.
     Grundvattensårbarhet: ${geo.groundwaterVulnerability}.

     KULTURMILJÖ (RAÄ):
     Fornlämningar/Monument: ${monList || 'Inga kända fynd vid platsen'}.

     SYSTEM-BEDÖMDA REGLER (MILJÖBALKEN & KML):
     ${ruleSummary || 'Inga direkta regelfel funna.'}

     TASK:
     Analysera geodataresultaten enligt Miljöbalken (MB) och Kulturmiljölagen (KML). Bedöm sannolikheten för tillstånd.
     Svara med en text som förklarar vilka kapitel i MB som berörs (t.ex. 2 kap, 3 kap, 7 kap, 9 kap) och varför.`;

  const summary = await generateTextWithVertex(prompt, {
    profile: 'fast',
    systemInstruction: GEMINI_SYSTEM_PROMPT,
  });

  if (!summary?.trim()) {
    throw new Error('Biodiversitetsanalys saknar verifierad AI-källa. Endast BankID får köras som demo/mock.');
  }

  return {
    summary: summary.trim(),
    observations,
    protectedAreas: pAreas,
    geological: geo,
    monuments: mons,
    compliance,
  };
}
