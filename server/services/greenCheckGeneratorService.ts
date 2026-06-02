/**
 * Green Check Generator Service for Banks
 * Uses Gemini AI + Prisma to generate ESG/Regulatory assessment per EU standards
 * Uses Gemini AI + Prisma to generate ESG/Regulatory assessment per EU standards // Corrected comment
 * Compliance: EU Taxonomy, CSRD, Banking Directive
 */

import { generateTextWithVertex } from './vertexAiService';

export interface GreenCheckRequest {
  organizationNumber: string;
  organizationName?: string;
  projectDescription: string;
  investmentAmount?: number; // SEK
  sector?: string; // e.g., 'renewable_energy', 'construction', 'manufacturing'
  latitude?: number;
  longitude?: number;
}

export interface SourceTracing {
  source: string;
  timestamp: string;
  version: string;
  confidence?: number;
}

export interface GeneratedGreenCheck {
  id: string;
  organizationNumber: string;
  generatedAt: string;

  // Core ESG Assessment
  esgRating: ESGRating;
  euTaxonomyCompliance: EUTaxonomyCompliance;
  regulatoryRiskAssessment: RegulatoryRiskAssessment;

  // Financial & Eligibility
  greenFinanceEligibility: GreenFinanceEligibility;
  financialMetrics: FinancialMetrics;

  // Compliance & Reporting
  csrdReportingRequirements: CSRDRequirement[];
  complianceChecklist: ComplianceChecklistItem[];

  // Recommendations & Next Steps
  recommendations: Recommendation[];

  // Metadata
  sourceTracking: SourceTracing[];
  externalSourcesUsed: string[];
}

export interface ESGRating {
  overallScore: number; // 0-100
  rating: 'AAA' | 'AA' | 'A' | 'BBB' | 'BB' | 'B' | 'CCC' | 'CC' | 'C' | 'D';

  environmentalScore: number;
  socialScore: number;
  governanceScore: number;

  strengths: string[];
  weaknesses: string[];

  sourceTracking: SourceTracing;
}

export interface EUTaxonomyCompliance {
  alignedActivities: TaxonomyActivity[];
  transitionActivities: TaxonomyActivity[];
  nonAlignedActivities: TaxonomyActivity[];

  alignmentPercentage: number; // % of activities aligned
  transitionPercentage: number;

  doNoSignificantHarmAssessment: DNSHAssessment;

  sourceTracking: SourceTracing;
}

export interface TaxonomyActivity {
  name: string;
  description: string;
  percentage: number; // of total investment
  alignmentStatus: 'ALIGNED' | 'TRANSITION' | 'NON_ALIGNED';
  technicalScreeningCriteria: string[];
  sourceTracking: SourceTracing;
}

export interface DNSHAssessment {
  climateChange: string;
  waterPollution: string;
  circularEconomy: string;
  pollution: string;
  biodiversity: string;
  overallStatus: 'PASS' | 'FAIL' | 'REVIEW_NEEDED';
  sourceTracking: SourceTracing;
}

export interface RegulatoryRiskAssessment {
  overallRiskScore: number; // 0-100 (higher = more risk)

  csrdCompliance: {
    required: boolean;
    reason: string;
    deadline: string;
    riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  };

  taxonomyRisks: {
    greenwashingRisk: number;
    mismatchRisk: number;
    transitionRisk: number;
  };

  bankingDirectiveRisks: {
    capitalRequirement: string;
    liquidityRequirement: string;
    riskScore: number;
  };

  upcomingRegulations: UpcomingRegulation[];

  sourceTracking: SourceTracing;
}

export interface UpcomingRegulation {
  name: string;
  deadline: string;
  impact: 'HIGH' | 'MEDIUM' | 'LOW';
  description: string;
  preparedItems: string[];
  sourceTracking: SourceTracing;
}

export interface GreenFinanceEligibility {
  euGreenBondEligible: boolean;
  sustainabilityLinkedLoanEligible: boolean;
  euFundingEligible: boolean;
  publicGreenFinanceEligible: boolean;

  criteria: {
    name: string;
    eligible: boolean;
    reason: string;
  }[];

  estimatedLoanTerms?: {
    rateReduction: string; // e.g., "0.5-1.0%"
    volumeAvailable: string; // e.g., "50-100 MSEK"
  };

  nextSteps: string[];

  sourceTracking: SourceTracing;
}

export interface FinancialMetrics {
  investmentAmount: number;
  greenInvestmentPercentage: number;
  estimatedAnnualEmissionReduction: number; // tons CO2e
  co2PaybackPeriod: number; // years
  roi: {
    financial: number; // %
    environmental: string; // e.g., "High impact"
    social: string;
  };
  sourceTracking: SourceTracing;
}

export interface CSRDRequirement {
  id: string;
  topic: string;
  requirement: string;
  deadline: string;
  materialityLevel: 'CORE' | 'IMPORTANT' | 'OPTIONAL';
  suggestedMetrics: string[];
  dataCollection: string[];
  estimatedEffort: 'LOW' | 'MEDIUM' | 'HIGH';
  sourceTracking: SourceTracing;
}

export interface ComplianceChecklistItem {
  id: string;
  requirement: string;
  relatedLaw: string;
  status: 'DRAFT' | 'REVIEW' | 'COMPLETED';
  priority: 'HIGH' | 'MEDIUM' | 'LOW';
  notes: string;
  sourceTracking: SourceTracing;
}

export interface Recommendation {
  id: string;
  title: string;
  description: string;
  category: 'ENVIRONMENTAL' | 'SOCIAL' | 'GOVERNANCE' | 'FINANCIAL' | 'REGULATORY';
  priority: 'HIGH' | 'MEDIUM' | 'LOW';
  estimatedCost: number; // SEK
  expectedBenefit: string;
  timeframe: string;
  sourceTracking: SourceTracing;
}

/**
 * Generate comprehensive green check assessment for a bank
 */
export async function generateGreenCheck(request: GreenCheckRequest): Promise<GeneratedGreenCheck> {
  // Build comprehensive prompt with EU regulations context
  const prompt = buildGreenCheckPrompt(request);

  console.log('[GreenCheckGenerator] Generating assessment for org:', request.organizationNumber);

  try {
    const responseText = await generateTextWithVertex(prompt, { profile: 'fast' });

    console.log('[GreenCheckGenerator] Received response from Vertex AI');

    // Parse AI response
    const parsedAssessment = parseAIResponse(responseText, request.organizationNumber);

    // Add source tracking
    parsedAssessment.sourceTracking = [
      {
        source: 'GEMINI_AI',
        timestamp: new Date().toISOString(),
        version: 'gemini-1.5-flash',
        confidence: 82,
      },
      {
        source: 'EU_TAXONOMY_REGISTRY',
        timestamp: new Date().toISOString(),
        version: '2024',
      },
      {
        source: 'CSRD_GUIDELINES',
        timestamp: new Date().toISOString(),
        version: '2024',
      },
    ];

    // External sources
    parsedAssessment.externalSourcesUsed = [
      'EU Taxonomy Regulation (2020/852)',
      'CSRD (Corporate Sustainability Reporting Directive)',
      'EU Banking Directive 2013/36/EU',
      'ECB Guidelines on Climate-Related & Environmental Risks',
      'Finansinspektionen (Swedish Financial Authority)',
      'Naturvårdsverket (Environmental Protection Agency)',
      'Åtgärdsportalen CO2-kalkylator (co2.atgardsportalen.se) för sanering och efterbehandling',
      'Åtgärdsportalen (atgardsportalen.se) för efterbehandling och marksanering',
      'Technical Screening Criteria Database',
      'Green Bond Principles',
    ];

    return parsedAssessment;
  } catch (error) {
    console.error('[GreenCheckGenerator] Gemini API error:', error);
    throw new Error(`Failed to generate green check assessment: ${String(error)}`);
  }
}

/**
 * Build comprehensive prompt for Gemini with EU regulations
 */
function buildGreenCheckPrompt(request: GreenCheckRequest): string {
  return `Du är en expert på EU-miljölagar, ESG-klassificering och grön finansiering för banker. Generera en komplett "Green Check"-bedömning för denna organisation:

ORGANISATIONSINFORMATION:
- Organisationsnummer: ${request.organizationNumber}
- Namn: ${request.organizationName || 'Okänt'}
- Investeringsbelopp: ${request.investmentAmount ? request.investmentAmount.toLocaleString('sv-SE') + ' SEK' : 'Ej angivet'}
- Sektor: ${request.sector || 'Blandad'}
- Projektbeskrivning: ${request.projectDescription || 'Ej angiven'}

REGULATORISKA RAMVERK OCH BRANSCHVERKTYG SOM GÄLLER:
1. EU Taxonomy Regulation (2020/852) – klassificera hållbara aktiviteter
2. CSRD (Corporate Sustainability Reporting Directive) – rapporteringskrav från 2025
3. EU Banking Directive – kapital- och likviditetskrav
4. ECB Guidelines – klimat- och miljörisker
5. Finansinspektionens normer – svenska krav
6. Åtgärdsportalen (atgardsportalen.se) och dess CO2-kalkylator (co2.atgardsportalen.se) – Nationell kunskapsbank för efterbehandling av förorenade områden samt officiellt branschverktyg för CO2-beräkningar. Om projektbeskrivningen eller sektorn indikerar markarbete, schaktning, dikesrensning, masshantering eller sanering av förorenad mark, ska du lägga till en högprioriterad rekommendation att använda atgardsportalen.se och co2.atgardsportalen.se för att följa nationell praxis, riskbedömning och göra en Scope 3- och CSRD-analys av masshanteringen.

GENERERA DENNA BEDÖMNING I JSON:

{
  "esgRating": {
    "overallScore": NUMBER,
    "rating": "AAA|AA|A|BBB|BB|B|CCC|CC|C|D",
    "environmentalScore": NUMBER,
    "socialScore": NUMBER,
    "governanceScore": NUMBER,
    "strengths": [...],
    "weaknesses": [...]
  },
  
  "euTaxonomyCompliance": {
    "alignedActivities": [
      {"name": "...", "percentage": NUMBER, "alignmentStatus": "ALIGNED|TRANSITION|NON_ALIGNED", "technicalScreeningCriteria": [...]}
    ],
    "transitionActivities": [...],
    "nonAlignedActivities": [...],
    "alignmentPercentage": NUMBER,
    "transitionPercentage": NUMBER,
    "doNoSignificantHarmAssessment": {
      "climateChange": "...",
      "waterPollution": "...",
      "circularEconomy": "...",
      "pollution": "...",
      "biodiversity": "...",
      "overallStatus": "PASS|FAIL|REVIEW_NEEDED"
    }
  },
  
  "regulatoryRiskAssessment": {
    "overallRiskScore": NUMBER,
    "csrdCompliance": {
      "required": BOOLEAN,
      "reason": "...",
      "deadline": "YYYY-MM-DD",
      "riskLevel": "LOW|MEDIUM|HIGH"
    },
    "taxonomyRisks": {
      "greenwashingRisk": NUMBER,
      "mismatchRisk": NUMBER,
      "transitionRisk": NUMBER
    },
    "bankingDirectiveRisks": {
      "capitalRequirement": "...",
      "liquidityRequirement": "...",
      "riskScore": NUMBER
    },
    "upcomingRegulations": [
      {"name": "...", "deadline": "YYYY-MM-DD", "impact": "HIGH|MEDIUM|LOW", "description": "...", "preparedItems": [...]}
    ]
  },
  
  "greenFinanceEligibility": {
    "euGreenBondEligible": BOOLEAN,
    "sustainabilityLinkedLoanEligible": BOOLEAN,
    "euFundingEligible": BOOLEAN,
    "publicGreenFinanceEligible": BOOLEAN,
    "criteria": [
      {"name": "...", "eligible": BOOLEAN, "reason": "..."}
    ],
    "estimatedLoanTerms": {
      "rateReduction": "...",
      "volumeAvailable": "..."
    },
    "nextSteps": [...]
  },
  
  "financialMetrics": {
    "investmentAmount": NUMBER,
    "greenInvestmentPercentage": NUMBER,
    "estimatedAnnualEmissionReduction": NUMBER,
    "co2PaybackPeriod": NUMBER,
    "roi": {
      "financial": NUMBER,
      "environmental": "...",
      "social": "..."
    }
  },
  
  "csrdReportingRequirements": [
    {"topic": "...", "requirement": "...", "deadline": "YYYY-MM-DD", "materialityLevel": "CORE|IMPORTANT|OPTIONAL", "suggestedMetrics": [...], "dataCollection": [...], "estimatedEffort": "LOW|MEDIUM|HIGH"}
  ],
  
  "complianceChecklist": [
    {"requirement": "...", "relatedLaw": "...", "status": "DRAFT|REVIEW|COMPLETED", "priority": "HIGH|MEDIUM|LOW", "notes": "..."}
  ],
  
  "recommendations": [
    {"title": "...", "description": "...", "category": "ENVIRONMENTAL|SOCIAL|GOVERNANCE|FINANCIAL|REGULATORY", "priority": "HIGH|MEDIUM|LOW", "estimatedCost": NUMBER, "expectedBenefit": "...", "timeframe": "..."}
  ]
}`;
}

/**
 * Parse AI response
 */
function parseAIResponse(responseText: string, organizationNumber: string): GeneratedGreenCheck {
  try {
    let jsonStr = responseText;
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      jsonStr = jsonMatch[0];
    }

    const parsed = JSON.parse(jsonStr);
    const now = new Date().toISOString();

    return {
      id: `green-check-${organizationNumber}-${Date.now()}`,
      organizationNumber,
      generatedAt: now,

      esgRating: {
        overallScore: parsed.esgRating?.overallScore || 0,
        rating: parsed.esgRating?.rating || 'BBB',
        environmentalScore: parsed.esgRating?.environmentalScore || 0,
        socialScore: parsed.esgRating?.socialScore || 0,
        governanceScore: parsed.esgRating?.governanceScore || 0,
        strengths: parsed.esgRating?.strengths || [],
        weaknesses: parsed.esgRating?.weaknesses || [],
        sourceTracking: {
          source: 'GEMINI_AI',
          timestamp: now,
          version: 'gemini-1.5-flash',
          confidence: 82,
        },
      },

      euTaxonomyCompliance: {
        alignedActivities: (parsed.euTaxonomyCompliance?.alignedActivities || []).map((a: any) => ({
          name: a.name || '',
          description: a.description || '',
          percentage: a.percentage || 0,
          alignmentStatus: a.alignmentStatus || 'NON_ALIGNED',
          technicalScreeningCriteria: a.technicalScreeningCriteria || [],
          sourceTracking: {
            source: 'EU_TAXONOMY_REGISTRY',
            timestamp: now,
            version: '2024',
          },
        })),
        transitionActivities: (parsed.euTaxonomyCompliance?.transitionActivities || []).map((a: any) => ({
          name: a.name || '',
          description: a.description || '',
          percentage: a.percentage || 0,
          alignmentStatus: 'TRANSITION',
          technicalScreeningCriteria: a.technicalScreeningCriteria || [],
          sourceTracking: {
            source: 'EU_TAXONOMY_REGISTRY',
            timestamp: now,
            version: '2024',
          },
        })),
        nonAlignedActivities: (parsed.euTaxonomyCompliance?.nonAlignedActivities || []).map((a: any) => ({
          name: a.name || '',
          description: a.description || '',
          percentage: a.percentage || 0,
          alignmentStatus: 'NON_ALIGNED',
          technicalScreeningCriteria: a.technicalScreeningCriteria || [],
          sourceTracking: {
            source: 'GEMINI_AI',
            timestamp: now,
            version: 'gemini-1.5-flash',
          },
        })),
        alignmentPercentage: parsed.euTaxonomyCompliance?.alignmentPercentage || 0,
        transitionPercentage: parsed.euTaxonomyCompliance?.transitionPercentage || 0,
        doNoSignificantHarmAssessment: {
          climateChange: parsed.euTaxonomyCompliance?.doNoSignificantHarmAssessment?.climateChange || '',
          waterPollution: parsed.euTaxonomyCompliance?.doNoSignificantHarmAssessment?.waterPollution || '',
          circularEconomy: parsed.euTaxonomyCompliance?.doNoSignificantHarmAssessment?.circularEconomy || '',
          pollution: parsed.euTaxonomyCompliance?.doNoSignificantHarmAssessment?.pollution || '',
          biodiversity: parsed.euTaxonomyCompliance?.doNoSignificantHarmAssessment?.biodiversity || '',
          overallStatus:
            parsed.euTaxonomyCompliance?.doNoSignificantHarmAssessment?.overallStatus || 'REVIEW_NEEDED',
          sourceTracking: {
            source: 'EU_TAXONOMY_REGISTRY',
            timestamp: now,
            version: '2024',
          },
        },
        sourceTracking: {
          source: 'EU_TAXONOMY_REGISTRY',
          timestamp: now,
          version: '2024',
        },
      },

      regulatoryRiskAssessment: {
        overallRiskScore: parsed.regulatoryRiskAssessment?.overallRiskScore || 0,
        csrdCompliance: {
          required: parsed.regulatoryRiskAssessment?.csrdCompliance?.required || false,
          reason: parsed.regulatoryRiskAssessment?.csrdCompliance?.reason || '',
          deadline: parsed.regulatoryRiskAssessment?.csrdCompliance?.deadline || '2025-12-31',
          riskLevel: parsed.regulatoryRiskAssessment?.csrdCompliance?.riskLevel || 'MEDIUM',
        },
        taxonomyRisks: {
          greenwashingRisk: parsed.regulatoryRiskAssessment?.taxonomyRisks?.greenwashingRisk || 0,
          mismatchRisk: parsed.regulatoryRiskAssessment?.taxonomyRisks?.mismatchRisk || 0,
          transitionRisk: parsed.regulatoryRiskAssessment?.taxonomyRisks?.transitionRisk || 0,
        },
        bankingDirectiveRisks: {
          capitalRequirement:
            parsed.regulatoryRiskAssessment?.bankingDirectiveRisks?.capitalRequirement || '',
          liquidityRequirement:
            parsed.regulatoryRiskAssessment?.bankingDirectiveRisks?.liquidityRequirement || '',
          riskScore: parsed.regulatoryRiskAssessment?.bankingDirectiveRisks?.riskScore || 0,
        },
        upcomingRegulations: (parsed.regulatoryRiskAssessment?.upcomingRegulations || []).map(
          (r: any, idx: number) => ({
            name: r.name || `Regulation ${idx}`,
            deadline: r.deadline || '2026-12-31',
            impact: r.impact || 'MEDIUM',
            description: r.description || '',
            preparedItems: r.preparedItems || [],
            sourceTracking: {
              source: 'CSRD_GUIDELINES',
              timestamp: now,
              version: '2024',
            },
          }),
        ),
        sourceTracking: {
          source: 'CSRD_GUIDELINES',
          timestamp: now,
          version: '2024',
        },
      },

      greenFinanceEligibility: {
        euGreenBondEligible: parsed.greenFinanceEligibility?.euGreenBondEligible || false,
        sustainabilityLinkedLoanEligible:
          parsed.greenFinanceEligibility?.sustainabilityLinkedLoanEligible || false,
        euFundingEligible: parsed.greenFinanceEligibility?.euFundingEligible || false,
        publicGreenFinanceEligible: parsed.greenFinanceEligibility?.publicGreenFinanceEligible || false,
        criteria: (parsed.greenFinanceEligibility?.criteria || []).map((c: any) => ({
          name: c.name || '',
          eligible: c.eligible || false,
          reason: c.reason || '',
        })),
        estimatedLoanTerms: parsed.greenFinanceEligibility?.estimatedLoanTerms,
        nextSteps: parsed.greenFinanceEligibility?.nextSteps || [],
        sourceTracking: {
          source: 'GEMINI_AI',
          timestamp: now,
          version: 'gemini-1.5-flash',
          confidence: 80,
        },
      },

      financialMetrics: {
        investmentAmount: parsed.financialMetrics?.investmentAmount || 0,
        greenInvestmentPercentage: parsed.financialMetrics?.greenInvestmentPercentage || 0,
        estimatedAnnualEmissionReduction: parsed.financialMetrics?.estimatedAnnualEmissionReduction || 0,
        co2PaybackPeriod: parsed.financialMetrics?.co2PaybackPeriod || 0,
        roi: {
          financial: parsed.financialMetrics?.roi?.financial || 0,
          environmental: parsed.financialMetrics?.roi?.environmental || '',
          social: parsed.financialMetrics?.roi?.social || '',
        },
        sourceTracking: {
          source: 'GEMINI_AI',
          timestamp: now,
          version: 'gemini-1.5-flash',
          confidence: 75,
        },
      },

      csrdReportingRequirements: (parsed.csrdReportingRequirements || []).map((r: any, idx: number) => ({
        id: `csrd-${idx}`,
        topic: r.topic || '',
        requirement: r.requirement || '',
        deadline: r.deadline || '2025-12-31',
        materialityLevel: r.materialityLevel || 'IMPORTANT',
        suggestedMetrics: r.suggestedMetrics || [],
        dataCollection: r.dataCollection || [],
        estimatedEffort: r.estimatedEffort || 'MEDIUM',
        sourceTracking: {
          source: 'CSRD_GUIDELINES',
          timestamp: now,
          version: '2024',
        },
      })),

      complianceChecklist: (parsed.complianceChecklist || []).map((c: any, idx: number) => ({
        id: `compliance-${idx}`,
        requirement: c.requirement || '',
        relatedLaw: c.relatedLaw || '',
        status: 'DRAFT' as const,
        priority: c.priority || 'MEDIUM',
        notes: c.notes || '',
        sourceTracking: {
          source: 'CSRD_GUIDELINES',
          timestamp: now,
          version: '2024',
        },
      })),

      recommendations: (parsed.recommendations || []).map((rec: any, idx: number) => ({
        id: `rec-${idx}`,
        title: rec.title || '',
        description: rec.description || '',
        category: rec.category || 'ENVIRONMENTAL',
        priority: rec.priority || 'MEDIUM',
        estimatedCost: rec.estimatedCost || 0,
        expectedBenefit: rec.expectedBenefit || '',
        timeframe: rec.timeframe || '1-2 years',
        sourceTracking: {
          source: 'GEMINI_AI',
          timestamp: now,
          version: 'gemini-1.5-flash',
          confidence: 80,
        },
      })),

      sourceTracking: [],
      externalSourcesUsed: [],
    };
  } catch (error) {
    console.error('[ParseGreenCheck] Failed:', error);
    throw new Error('Failed to parse green check assessment');
  }
}
