/**
 * Permit Application Generator Service
 * Uses Gemini AI + Prisma + PostGIS + SNI database to generate comprehensive permit applications
 * Includes source tracking for all generated content
 */

import { prisma } from '../../db.server';
import { getAiProvider } from './aiProviderImplementation';
import { fetchGeologicalData } from './sguService';
import { tryFetchLocalPropertyGeometry } from './hybridGeoService';
import { logger } from '../logger';

export interface PermitApplicationRequest {
  projectId: string;
  propertyDesignation: string; // Fastighetsbeteckning
  sniCode: string; // SNI-kod (e.g., 38.21.10)
  sniDescription?: string; // Verksamhetsbeskrivning
  description: string; // Detaljerad verksamhetsbeskrivning
  budget?: number; // SEK (optional)
  latitude?: number;
  longitude?: number;
}

export interface SourceTracing {
  source: string; // 'GEMINI_AI', 'POSTGIS', 'SNI_REGISTRY', 'LANTMATERIET', etc.
  timestamp: string;
  version: string; // AI model version or data source version
  confidence?: number; // 0-100 for AI-generated data
}

export interface GeneratedPermitApplication {
  id: string;
  projectId: string;
  generatedAt: string;
  propertyDesignation: string;
  sniCode: string;
  applicationSummary: ApplicationSummary;
  riskAnalysis: RiskAnalysis[];
  stakeholderAnalysis: Stakeholder[];
  requiredDocuments: DocumentRequirement[];
  budgetEstimate: BudgetEstimate;
  environmentalImpact: EnvironmentalImpact;
  samplingAndLabPlan: SamplingPlan[];
  recommendedLaboratories: Laboratory[];
  complianceChecklist: ComplianceItem[];
  sourceTracking: SourceTracing[];
  externalSourcesUsed: string[];
}

export interface ApplicationSummary {
  title: string;
  operationType: string;
  location: string;
  duration: string;
  expectedEnvironmentalLoad: string;
  mainActivities: string[];
  sourceTracking: SourceTracing;
}

export interface RiskAnalysis {
  id: string;
  category: 'ENVIRONMENTAL' | 'REGULATORY' | 'OPERATIONAL' | 'HEALTH_SAFETY';
  riskName: string;
  description: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  mitigationMeasures: string[];
  sourceTracking: SourceTracing;
}

export interface Stakeholder {
  id: string;
  name: string;
  role: string; // Miljödom, grannar, kommun, region, etc.
  interestLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  powerLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  communicationNeeded: boolean;
  sourceTracking: SourceTracing;
}

export interface DocumentRequirement {
  id: string;
  documentType: string;
  description: string;
  mandatory: boolean;
  template?: string;
  relatedRisk?: string;
  sourceTracking: SourceTracing;
}

export interface BudgetEstimate {
  estimatedCost: number;
  currency: string;
  categories: {
    permittingFees: number;
    environmentalStudies: number;
    monitoring: number;
    contingency: number;
    other: number;
  };
  sourceTracking: SourceTracing;
}

export interface EnvironmentalImpact {
  airQuality: string;
  waterQuality: string;
  soilContamination: string;
  noiseEmissions: string;
  biodiversity: string;
  climateGHG: string;
  sourceTracking: SourceTracing;
}

export interface SamplingPlan {
  id: string;
  parameter: string;
  frequency: string;
  location: string;
  method: string;
  standardUsed: string;
  estimatedCost: number;
  sourceTracking: SourceTracing;
}

export interface Laboratory {
  id: string;
  name: string;
  accreditation: string; // SWEDAC, ISO/IEC 17025, etc.
  specialization: string[];
  location: string;
  contactEmail?: string;
  estimatedTurnaround: string; // e.g., "5-7 working days"
  sourceTracking: SourceTracing;
}

export interface ComplianceItem {
  id: string;
  requirement: string;
  relatedLaw: string;
  status: 'DRAFT' | 'REVIEW' | 'COMPLETED';
  notes: string;
  sourceTracking: SourceTracing;
}

/**
 * Generate comprehensive permit application using AI
 */
export async function generatePermitApplication(
  request: PermitApplicationRequest,
): Promise<GeneratedPermitApplication> {
  // 1. Fetch project from Prisma
  const project = await prisma.project.findUnique({
    where: { id: request.projectId },
  });

  if (!project) {
    throw new Error(`Project ${request.projectId} not found`);
  }

  if (!Number.isFinite(request.latitude) || !Number.isFinite(request.longitude)) {
    throw new Error(
      'Verifierade koordinater krävs för ansökningsgenerering. Ingen lokal standardposition används.',
    );
  }

  const latitude = Number(request.latitude);
  const longitude = Number(request.longitude);
  const geodataFindings = await fetchGeodataFindings(latitude, longitude, request.propertyDesignation);

  // 3. Fetch SNI data
  const sniData = await fetchSNIData(request.sniCode, request.sniDescription);

  // 4. Build Vertex prompt with all context
  const prompt = buildPermitPrompt(request, sniData, geodataFindings);

  console.log('[PermitApplicationGenerator] Sending prompt to Vertex AI...');

  try {
    const aiProvider = getAiProvider();
    const response = await aiProvider.generateText(prompt, { profile: 'fast' });
    const responseText = response.text;

    console.log('[PermitApplicationGenerator] Received response from AI');

    // 5. Parse AI response
    const parsedApplication = parseAIResponse(
      responseText,
      request.projectId,
      request.propertyDesignation,
      request.sniCode,
    );

    parsedApplication.sourceTracking = [
      {
        source: 'GEMINI_AI',
        timestamp: new Date().toISOString(),
        version: 'gemini-1.5-flash',
        confidence: 85,
      },
    ];

    parsedApplication.externalSourcesUsed = [];

    parsedApplication.recommendedLaboratories = [];

    return parsedApplication;
  } catch (error) {
    console.error('[PermitApplicationGenerator] Gemini API error:', error);
    throw new Error(`Failed to generate permit application: ${String(error)}`);
  }
}

/**
 * Fetch geodata findings from PostGIS
 */
async function fetchGeodataFindings(lat: number, lng: number, propertyDesignation: string): Promise<any> {
  const result: any = {
    waterBodies: [],
    protectedNature: [],
    soilTypes: [],
    groundwaterRisk: 'Ej verifierad',
    proximity: { nearestWater: 0, nearestProtectedArea: 0 },
  };

  try {
    // 1. SGU Data
    if (lat && lng) {
      const geoData = await fetchGeologicalData(lat, lng);
      result.soilTypes = geoData.soilType ? [geoData.soilType] : [];
      result.groundwaterRisk = geoData.groundwaterVulnerability || 'Ej verifierad';
    }

    // 2. Lokal fastighetsdata
    const localProp = await tryFetchLocalPropertyGeometry(propertyDesignation);
    if (localProp) {
      logger.info(`[PermitApplicationGenerator] Använder lokal geometri för ${propertyDesignation}`);
    }
  } catch (err) {
    logger.error('[PermitApplicationGenerator] Fel vid orkester-hämtning:', err);
  }

  return result;
}

/**
 * Fetch SNI (Standard för Näringsgrensindelning) data
 */
async function fetchSNIData(sniCode: string, description?: string): Promise<any> {
  return {
    code: sniCode,
    description: description || 'Ej verifierad SNI-beskrivning',
    environmentalRisks: [],
    requiredPermits: [],
    commonStakeholders: [],
  };
}

/**
 * Build comprehensive prompt for Gemini
 */
function buildPermitPrompt(request: PermitApplicationRequest, sniData: any, geodata: any): string {
  return `Du är expert på svenska miljötillståndsansökningar. Generera en komplett tillståndsansökan baserat på:

VERKSAMHET:
- Fastighetsbeteckning: ${request.propertyDesignation}
- SNI-kod: ${request.sniCode}
- SNI-beskrivning: ${sniData.description}
- Verksamhetsbeskrivning: ${request.description}

GEOGRAFISK DATA:
- Vattendrag: ${geodata.waterBodies?.join(', ')}
- Skyddad natur: ${geodata.protectedNature?.join(', ')}
- Jordtyper: ${geodata.soilTypes?.join(', ')}

KRAV (Be extremely concise!):
1. Sammanfattning av ansökan (max 3 meningar).
2. Max 3 miljörisker.
3. Max 3 viktiga intressenter.
4. Minimal miljöpåverkansanalys.
5. Håll svaret under 3000 tecken totalt.

SVAR I JSON-FORMAT:
{
  "applicationSummary": {...},
  "riskAnalysis": [...],
  "stakeholderAnalysis": [...],
  "requiredDocuments": [...],
  "budgetEstimate": {...},
  "environmentalImpact": {...},
  "samplingAndLabPlan": [...],
  "complianceChecklist": [...]
}`;
}

/**
 * Parse AI response and structure it
 */
function parseAIResponse(
  responseText: string,
  projectId: string,
  propertyDesignation: string,
  sniCode: string,
): GeneratedPermitApplication {
  const now = new Date().toISOString();
  try {
    // Robust isolation of JSON
    const firstBrace = responseText.indexOf('{');
    const lastBrace = responseText.lastIndexOf('}');
    if (firstBrace === -1 || lastBrace === -1) {
      throw new Error('No JSON object found in response');
    }
    const jsonStr = responseText.substring(firstBrace, lastBrace + 1);
    const parsed = JSON.parse(jsonStr);

    return {
      id: `permit-${projectId}-${Date.now()}`,
      projectId,
      generatedAt: now,
      propertyDesignation,
      sniCode,
      applicationSummary: {
        title: parsed.applicationSummary?.title || `Tillståndsansökan för ${propertyDesignation}`,
        operationType: parsed.applicationSummary?.operationType || 'Miljöfarlig verksamhet',
        location: parsed.applicationSummary?.location || propertyDesignation,
        duration: parsed.applicationSummary?.duration || 'Obegränsad',
        expectedEnvironmentalLoad: parsed.applicationSummary?.expectedEnvironmentalLoad || 'Medel',
        mainActivities: parsed.applicationSummary?.mainActivities || [],
        sourceTracking: {
          source: 'GEMINI_AI',
          timestamp: now,
          version: 'gemini-2.5-flash',
        },
      },
      riskAnalysis: (parsed.riskAnalysis || []).map((r: any, idx: number) => ({
        id: `risk-${idx}`,
        category: r.category || 'ENVIRONMENTAL',
        riskName: r.riskName || (typeof r === 'string' ? r : `Risk ${idx + 1}`),
        description: r.description || (typeof r === 'string' ? r : ''),
        severity: r.severity || 'MEDIUM',
        mitigationMeasures: Array.isArray(r.mitigationMeasures) ? r.mitigationMeasures : (r.mitigation ? [r.mitigation] : []),
        sourceTracking: {
          source: 'GEMINI_AI',
          timestamp: now,
          version: 'gemini-2.5-flash',
        },
      })),
      stakeholderAnalysis: (parsed.stakeholderAnalysis || []).map((s: any, idx: number) => ({
        id: `stakeholder-${idx}`,
        name: s.name || (typeof s === 'string' ? s : `Intressent ${idx + 1}`),
        role: s.role || '',
        interestLevel: s.interestLevel || 'MEDIUM',
        powerLevel: s.powerLevel || 'MEDIUM',
        communicationNeeded: true,
        sourceTracking: {
          source: 'GEMINI_AI',
          timestamp: now,
          version: 'gemini-2.5-flash',
        },
      })),
      requiredDocuments: (parsed.requiredDocuments || []).map((doc: any, idx: number) => ({
        id: `document-${idx}`,
        documentType: doc.documentType || doc.title || (typeof doc === 'string' ? doc : `Dokument ${idx + 1}`),
        description: doc.description || '',
        mandatory: doc.mandatory ?? true,
        template: doc.template,
        relatedRisk: doc.relatedRisk,
        sourceTracking: {
          source: 'GEMINI_AI',
          timestamp: now,
          version: 'gemini-2.5-flash',
        },
      })),
      budgetEstimate: {
        estimatedCost: parsed.budgetEstimate?.estimatedCost || 0,
        currency: 'SEK',
        categories: parsed.budgetEstimate?.categories || {
          permittingFees: 0,
          environmentalStudies: 0,
          monitoring: 0,
          contingency: 0,
          other: 0,
        },
        sourceTracking: {
          source: 'GEMINI_AI',
          timestamp: now,
          version: 'gemini-2.5-flash',
        },
      },
      environmentalImpact: {
        airQuality: parsed.environmentalImpact?.airQuality || 'TBD',
        waterQuality: parsed.environmentalImpact?.waterQuality || 'TBD',
        soilContamination: parsed.environmentalImpact?.soilContamination || 'TBD',
        noiseEmissions: parsed.environmentalImpact?.noiseEmissions || 'TBD',
        biodiversity: parsed.environmentalImpact?.biodiversity || 'TBD',
        climateGHG: parsed.environmentalImpact?.climateGHG || 'TBD',
        sourceTracking: {
          source: 'GEMINI_AI',
          timestamp: now,
          version: 'gemini-2.5-flash',
        },
      },
      samplingAndLabPlan: (parsed.samplingAndLabPlan || []).map((s: any, idx: number) => ({
        id: `sampling-${idx}`,
        parameter: s.parameter || (typeof s === 'string' ? s : ''),
        frequency: s.frequency || '',
        location: s.location || '',
        method: s.method || '',
        standardUsed: 'ISO/EN',
        estimatedCost: 0,
        sourceTracking: {
          source: 'GEMINI_AI',
          timestamp: now,
          version: 'gemini-2.5-flash',
        },
      })),
      recommendedLaboratories: [],
      complianceChecklist: (parsed.complianceChecklist || []).map((c: any, idx: number) => ({
        id: `compliance-${idx}`,
        requirement: c.requirement || (typeof c === 'string' ? c : ''),
        relatedLaw: c.relatedLaw || '',
        status: 'DRAFT' as const,
        notes: '',
        sourceTracking: {
          source: 'GEMINI_AI',
          timestamp: now,
          version: 'gemini-2.5-flash',
        },
      })),
      sourceTracking: [],
      externalSourcesUsed: [],
    };
  } catch (error) {
    console.error('[ParsePermitResponse] Failed:', error);
    throw new Error(`Failed to parse permit application: ${String(error)}`);
  }
}
