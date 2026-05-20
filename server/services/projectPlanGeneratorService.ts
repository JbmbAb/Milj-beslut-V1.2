/**
 * Project Plan Generator Service
 * Uses Gemini AI + Prisma + PostGIS to generate comprehensive project plans
 */

import { prisma } from '../../db.server';
import { generateTextWithVertex } from './vertexAiService';
import { fetchGeologicalData } from './sguService';
import { tryFetchLocalPropertyGeometry } from './hybridGeoService';
import { logger } from '../logger';

export interface ProjectPlanRequest {
  projectId: string;
  propertyId: string; // Fastighetsbeteckning
  projectType: 'ENV_PERMIT' | 'REMEDIATION' | 'INFRA' | 'ENERGY' | 'VA';
  budget: number; // SEK
  timeframe: string; // e.g., "6 months", "1 year"
  description: string; // Free-text project description
  latitude?: number;
  longitude?: number;
}

export interface GeneratedProjectPlan {
  id: string;
  projectId: string;
  generatedAt: string;
  phases: Phase[];
  riskAnalysis: RiskAnalysis[];
  stakeholderAnalysis: StakeholderAnalysis[];
  budget: BudgetBreakdown;
  samplingPlan: SamplingPlan[];
  organizationStructure: OrganizationStructure;
  geodataFindings: GeodataFindings;
  externalSourcesUsed: string[];
}

export interface Phase {
  id: string;
  name: string;
  description: string;
  startDate: string;
  endDate: string;
  budget: number;
  resources: string[];
  predecessors: string[];
}

export interface RiskAnalysis {
  id: string;
  name: string;
  description: string;
  category: 'REGULATORY' | 'ENVIRONMENTAL' | 'FINANCIAL' | 'OPERATIONAL' | 'TECHNICAL';
  probability: 'LOW' | 'MEDIUM' | 'HIGH';
  impact: 'LOW' | 'MEDIUM' | 'HIGH';
  mitigation: string;
  owner: string;
}

export interface StakeholderAnalysis {
  id: string;
  name: string;
  role: string;
  interestLevel: 'HIGH' | 'MEDIUM' | 'LOW';
  powerLevel: 'HIGH' | 'MEDIUM' | 'LOW';
  communicationStrategy: string;
  responsibilities: string[];
}

export interface BudgetBreakdown {
  total: number;
  currency: string;
  categories: {
    labor: number;
    materials: number;
    equipment: number;
    contingency: number;
    other: number;
  };
  timeline: { quarter: string; amount: number }[];
}

export interface SamplingPlan {
  id: string;
  location: string;
  parameter: string;
  frequency: string;
  method: string;
  depth?: number;
}

export interface OrganizationStructure {
  projectManager: string;
  teams: {
    name: string;
    lead: string;
    members: number;
    responsibilities: string[];
  }[];
}

export interface GeodataFindings {
  waterBodies: string[];
  protectedNature: string[];
  soilTypes: string[];
  groundwaterRisk: string;
  slopeStability: string;
  proximity: {
    nearestWater: number; // meters
    nearestProtectedArea: number;
  };
}

/**
 * Generate comprehensive project plan using AI
 */
export async function generateProjectPlan(request: ProjectPlanRequest): Promise<GeneratedProjectPlan> {
  // 1. Fetch project from Prisma
  const project = await prisma.project.findUnique({
    where: { id: request.projectId },
  });

  if (!project) {
    throw new Error(`Project ${request.projectId} not found`);
  }

  if (!Number.isFinite(request.latitude) || !Number.isFinite(request.longitude)) {
    throw new Error(
      'Verifierade koordinater krävs för projektplangenerering. Ingen lokal standardposition används.',
    );
  }

  const latitude = Number(request.latitude);
  const longitude = Number(request.longitude);
  const geodataFindings = await fetchGeodataFindings(latitude, longitude, request.propertyId);

  // 3. Build Vertex prompt with all context
  const prompt = buildGeneratorPrompt(request, project, geodataFindings);

  console.log('[ProjectPlanGenerator] Sending prompt to Vertex AI...');

  try {
    const responseText = await generateTextWithVertex(prompt, { profile: 'fast' });

    console.log('[ProjectPlanGenerator] RECEIVED DATA FROM VERTEX, length:', responseText?.length);
    if (responseText) {
      console.log('[ProjectPlanGenerator] Data snippet:', responseText.substring(0, 200));
    }

    // 4. Parse AI response
    const parsedPlan = parseAIResponse(responseText, request.projectId);

    parsedPlan.externalSourcesUsed = [];

    return parsedPlan;
  } catch (error) {
    console.error('[ProjectPlanGenerator] Vertex AI error:', error);
    throw new Error(`Failed to generate project plan: ${String(error)}`);
  }
}

/**
 * Fetch geodata findings from PostGIS
 */
async function fetchGeodataFindings(
  lat: number,
  lng: number,
  propertyId: string,
): Promise<GeodataFindings> {
  const findings: GeodataFindings = {
    waterBodies: [],
    protectedNature: [],
    soilTypes: [],
    groundwaterRisk: 'Ej verifierad',
    slopeStability: 'Ej verifierad',
    proximity: { nearestWater: 0, nearestProtectedArea: 0 },
  };

  try {
    // 1. Hämta geologisk data från SGU (Jordarter & Sårbarhet)
    if (lat && lng) {
      const geoData = await fetchGeologicalData(lat, lng);
      if (geoData.soilType) {
        findings.soilTypes = [geoData.soilType];
      }
      findings.groundwaterRisk = geoData.groundwaterVulnerability || 'Ej verifierad';
    }

    // 2. Försök hitta lokal fastighetsgeometri (Lantmäteriet)
    const localProp = await tryFetchLocalPropertyGeometry(propertyId);
    if (localProp) {
      logger.info(`[ProjectPlanGenerator] Hittade lokal geometri för ${propertyId}`);
      // Här kan vi i framtiden köra ST_Distance mot vattenlager i PostGIS
    }

  } catch (err) {
    logger.error('[ProjectPlanGenerator] Fel vid hämtning av orkesterdata:', err);
  }

  return findings;
}

/**
 * Build comprehensive prompt for Gemini
 */
function buildGeneratorPrompt(request: ProjectPlanRequest, project: any, geodata: GeodataFindings): string {
  return `Du är en expert på miljöprojektplanering i Sverige. Generera en komplett projektplan utifrån följande information:

PROJEKTINFORMATION:
- Namn: ${project.propertyDesignation || 'Okänt'}
- Typ: ${request.projectType}
- Budget: ${request.budget} SEK
- Tidsram: ${request.timeframe}
- Fastighetsbeteckning: ${request.propertyId}
- Beskrivning: ${request.description}

GEODATA-FYND:
- Vattendrag: ${geodata.waterBodies.join(', ') || 'Inga kända'}
- Skyddad natur: ${geodata.protectedNature.join(', ') || 'Ingen'}
- Jordtyper: ${geodata.soilTypes.join(', ')}
- Grundvattensäkerhet: ${geodata.groundwaterRisk}
- Sluttabilitet: ${geodata.slopeStability}

KRAV (Be extremely concise!):
1. Generera endast 2-3 viktiga projektfaser.
2. Identifiera endast 2-3 kritiska risker.
3. Fokusera på korrekta datum och budgetar.
4. Håll svaret under 3000 tecken totalt.

SVAR I JSON-FORMAT:
{
  "phases": [...],
  "risks": [...],
  "stakeholders": [...],
  "budget": {...},
  "samplingPlan": [...],
  "organizationStructure": {...}
}`;
}

/**
 * Parse AI response and structure it
 */
function parseAIResponse(responseText: string, projectId: string): GeneratedProjectPlan {
  try {
    // Robust parsing: Find the first '{' and the last '}' to isolate JSON
    const firstBrace = responseText.indexOf('{');
    const lastBrace = responseText.lastIndexOf('}');
    
    if (firstBrace === -1 || lastBrace === -1) {
      throw new Error('No JSON object found in response');
    }
    
    const jsonStr = responseText.substring(firstBrace, lastBrace + 1);
    const parsed = JSON.parse(jsonStr);

    return {
      id: `plan-${projectId}-${Date.now()}`,
      projectId,
      generatedAt: new Date().toISOString(),
      phases: (parsed.phases || []).map((p: any, idx: number) => ({
        id: `phase-${idx}`,
        name: p.name || (typeof p === 'string' ? p : `Fas ${idx + 1}`),
        description: p.description || '',
        startDate: p.startDate || '',
        endDate: p.endDate || '',
        budget: p.budget || 0,
        resources: p.resources || [],
        predecessors: p.predecessors || [],
      })),
      riskAnalysis: (parsed.risks || parsed.riskAnalysis || []).map((r: any, idx: number) => ({
        id: `risk-${idx}`,
        name: r.name || (typeof r === 'string' ? r : `Risk ${idx + 1}`),
        description: r.description || (typeof r === 'string' ? r : ''),
        category: r.category || 'OPERATIONAL',
        probability: r.probability || 'MEDIUM',
        impact: r.impact || 'MEDIUM',
        mitigation: r.mitigation || '',
        owner: r.owner || 'Projektledare',
      })),
      stakeholderAnalysis: (parsed.stakeholders || parsed.stakeholderAnalysis || []).map((s: any, idx: number) => ({
        id: `stakeholder-${idx}`,
        name: s.name || (typeof s === 'string' ? s : `Intressent ${idx + 1}`),
        role: s.role || (typeof s === 'string' ? s : ''),
        interestLevel: s.interestLevel || 'MEDIUM',
        powerLevel: s.powerLevel || 'MEDIUM',
        communicationStrategy: s.communicationStrategy || '',
        responsibilities: s.responsibilities || [],
      })),
      budget: parsed.budget || {
        total: 0,
        currency: 'SEK',
        categories: { labor: 0, materials: 0, equipment: 0, contingency: 0, other: 0 },
        timeline: [],
      },
      samplingPlan: (parsed.samplingPlan || []).map((s: any, idx: number) => ({
        id: `sampling-${idx}`,
        location: s.location || (typeof s === 'string' ? s : ''),
        parameter: s.parameter || '',
        frequency: s.frequency || '',
        method: s.method || '',
        depth: s.depth,
      })),
      organizationStructure: parsed.organizationStructure || {
        projectManager: 'Ej angiven',
        teams: [],
      },
      geodataFindings: {} as GeodataFindings,
      externalSourcesUsed: [],
    };
  } catch (error) {
    console.error('[ProjectPlanGenerator] Failed to parse AI response. Raw text length:', responseText?.length);
    console.error('Raw text snippet:', responseText?.substring(0, 500));
    throw new Error(`Failed to parse AI response: ${String(error)}`);
  }
}
