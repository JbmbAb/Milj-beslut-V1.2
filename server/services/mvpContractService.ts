import { evaluateProjectCompliance } from '../../services/complianceRulesEngine';
import { renderCompliancePlanTemplate } from '../../services/documentTemplateEngine';
import { listRequirementRows } from '../repositories/requirementsRepository';
import {
  generatePermitDraftFromGemini,
  getVerificationSecondOpinionFromOpenAi,
  suggestRequirementsFromGemini,
} from './mvpAiGatewayService';
import type {
  ClassificationRequest,
  ClassificationResponse,
  ComplianceRequirementsRequest,
  ComplianceRequirementsResponse,
  LabValidateRequest,
  LabValidateResponse,
  MvpWorkflowRequest,
  MvpWorkflowResponse,
  PermitGenerateRequest,
  PermitGenerateResponse,
  RequirementItem,
  RiskAnalysisRequest,
  RiskAnalysisResponse,
  VerificationCheckRequest,
  VerificationCheckResponse,
} from '../schemas/mvpSchemas';

const ACTIVITY_CLASSIFICATIONS: Record<string, { classification: string; legal_basis: string }> = {
  '29.40': {
    classification: 'C-verksamhet',
    legal_basis: 'Miljöprövningsförordningen (2013:251), 29 kap. 40 §',
  },
  '29.50': {
    classification: 'B-verksamhet',
    legal_basis: 'Miljöprövningsförordningen (2013:251), 29 kap. 50 §',
  },
  '29.60': {
    classification: 'A-verksamhet',
    legal_basis: 'Miljöprövningsförordningen (2013:251), 29 kap. 60 §',
  },
};

const FALLBACK_REQUIREMENTS: RequirementItem[] = [
  {
    rule: 'Verksamhetsutövaren ska bedriva egenkontroll och dokumentera kontrollåtgärder.',
    law: 'Miljöbalken (1998:808)',
    citation: '26 kap. 19 §',
  },
  {
    rule: 'Avfall ska hanteras utan risk för skada på människors hälsa eller miljö.',
    law: 'Avfallsförordningen (2020:614)',
    citation: '2 kap. 1 §',
  },
];

const LAB_LIMITS: Record<string, { limit: number; unit: string }> = {
  arsenik: { limit: 10, unit: 'mg/kg TS' },
  bly: { limit: 80, unit: 'mg/kg TS' },
  kadmium: { limit: 0.8, unit: 'mg/kg TS' },
  krom: { limit: 120, unit: 'mg/kg TS' },
  koppar: { limit: 200, unit: 'mg/kg TS' },
  kvicksilver: { limit: 0.25, unit: 'mg/kg TS' },
  nickel: { limit: 35, unit: 'mg/kg TS' },
  zink: { limit: 500, unit: 'mg/kg TS' },
};

function normalize(input: unknown): string {
  return String(input ?? '').trim();
}

function uniqueRequirements(items: RequirementItem[]): RequirementItem[] {
  const seen = new Set<string>();
  const output: RequirementItem[] = [];
  for (const item of items) {
    const key = `${item.rule}|${item.law}|${item.citation}`;
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(item);
  }
  return output;
}

export function classifyActivity(input: ClassificationRequest, traceId: string): ClassificationResponse {
  const byCode = ACTIVITY_CLASSIFICATIONS[input.activity_code];
  if (byCode) {
    return {
      traceId,
      classification: byCode.classification,
      legal_basis: byCode.legal_basis,
      status: 'MATCHED',
      ewc_code: input.ewc_code,
      volume_tons: input.volume_tons,
    };
  }

  const fallback =
    input.volume_tons > 10000
      ? {
          classification: 'B-verksamhet',
          legal_basis: 'Miljöprövningsförordningen (2013:251), volymtröskel över 10 000 ton',
        }
      : {
          classification: 'C-verksamhet',
          legal_basis: 'Miljöprövningsförordningen (2013:251), 29 kap. 40 § (fallback)',
        };

  return {
    traceId,
    classification: fallback.classification,
    legal_basis: fallback.legal_basis,
    status: 'FALLBACK',
    ewc_code: input.ewc_code,
    volume_tons: input.volume_tons,
  };
}

export async function getComplianceRequirements(
  input: ComplianceRequirementsRequest,
  traceId: string,
  organisationId?: string
): Promise<ComplianceRequirementsResponse> {
  if (organisationId) {
    const result = await listRequirementRows({
      page: 1,
      pageSize: 100,
      verificationStatus: 'VERIFIED',
      includePreliminary: false,
      ewcCode: input.ewc_code,
      organisationId,
    });

    const fromIndex: RequirementItem[] = result.items
      .map((row) => {
        const rule = normalize(row.interpretedRequirement) || normalize(row.requirementTextQuote);
        const citation = normalize(row.legalReference) || 'Manuell juridisk kontroll krävs';
        const law = normalize(row.legalReference) || 'Svensk miljölagstiftning';
        if (!rule) return null;
        return { rule, law, citation };
      })
      .filter((item): item is RequirementItem => Boolean(item));

    if (fromIndex.length > 0) {
      return {
        traceId,
        requirements: uniqueRequirements(fromIndex),
        source: 'INDEX',
      };
    }
  }

  const aiRequirements = await suggestRequirementsFromGemini({
    activityCode: input.activity_code,
    ewcCode: input.ewc_code,
  });
  if (aiRequirements && aiRequirements.length > 0) {
    return {
      traceId,
      requirements: uniqueRequirements(aiRequirements),
      source: 'AI',
    };
  }

  return {
    traceId,
    requirements: FALLBACK_REQUIREMENTS,
    source: 'FALLBACK',
  };
}

export function analyzeRisk(input: RiskAnalysisRequest, traceId: string): RiskAnalysisResponse {
  const ewc = normalize(input.ewc_code);
  const location = normalize(input.location).toLowerCase();
  const hazardous = ewc.includes('*') || ewc.startsWith('17 09');
  const nearGroundWater =
    location.includes('vatten') || location.includes('grundvatten') || location.includes('brunn');

  const baseline = evaluateProjectCompliance({
    volumeTons: input.volume_tons,
    hazardousClassification: hazardous,
    groundwaterProximity: nearGroundWater,
    missingDocumentation: false,
    labExceedancesCount: 0,
  });

  const riskFlags = [...baseline.riskFactors];
  if (input.volume_tons >= 10000) {
    riskFlags.push('Large volume storage');
  }
  if (nearGroundWater) {
    riskFlags.push('Potential groundwater impact');
  }

  return {
    traceId,
    risk_flags: Array.from(new Set(riskFlags)),
    risk_score: baseline.riskScore,
  };
}

export function validateLabResults(input: LabValidateRequest, traceId: string): LabValidateResponse {
  const exceedances = input.sample_results
    .map((sample) => {
      const key = normalize(sample.parameter).toLowerCase();
      const limit = LAB_LIMITS[key];
      if (!limit) return null;
      if (sample.value <= limit.limit) return null;
      return {
        parameter: sample.parameter,
        value: sample.value,
        limit: limit.limit,
        unit: sample.unit || limit.unit,
      };
    })
    .filter((row): row is NonNullable<typeof row> => Boolean(row));

  return {
    traceId,
    status: exceedances.length > 0 ? 'FAIL' : 'PASS',
    exceedances,
  };
}

function resolveDocumentType(projectData: Record<string, unknown>): string {
  const classification = normalize(projectData.classification).toUpperCase();
  const volume = Number(projectData.volume_tons || 0);

  if (classification.startsWith('B') || volume > 10000) return 'B-tillstand';
  return 'C-anmalan';
}

function buildRequirementsAppendix(requirements: RequirementItem[]): string {
  if (!requirements.length) return 'Inga kravposter tillgangliga.';
  return requirements
    .map((item, index) => `${index + 1}. ${item.rule}\n   Rattskalla: ${item.law}\n   Citat: ${item.citation}`)
    .join('\n\n');
}

export async function generatePermitDraft(input: PermitGenerateRequest, traceId: string): Promise<PermitGenerateResponse> {
  const projectData = input.project_data;
  const documentType = resolveDocumentType(projectData);
  const projectName = normalize(projectData.name) || normalize(projectData.property_id) || 'Projekt';
  const municipality = normalize(projectData.municipality) || 'Okand kommun';
  const ewcCode = normalize(projectData.ewc_code) || 'okand EWC-kod';
  const volume = Number(projectData.volume_tons || 0);

  const baseText = renderCompliancePlanTemplate({
    projectName,
    municipality,
    wasteTypes: [ewcCode],
    totalVolumeTons: Number.isFinite(volume) ? volume : 0,
    riskScore: input.risk_flags.length ? 'MEDIUM' : 'LOW',
    riskFactors: input.risk_flags,
    aiMitigationAdvice:
      'Denna analys är framtagen av Miljöbeslut.se. Manuell juridisk kontroll ska genomföras före slutlig inlämning till tillsynsmyndighet.',
  });

  const requirementsBlock = buildRequirementsAppendix(input.requirements);
  const draftText = `${baseText}\n\n5. JURIDISKA KRAV (MVP)\n${requirementsBlock}\n`;

  const aiDraft = await generatePermitDraftFromGemini({
    projectData,
    requirements: input.requirements,
    riskFlags: input.risk_flags,
    defaultDocumentType: documentType,
  });

  if (aiDraft && aiDraft.document_type && aiDraft.draft_text) {
    return {
      traceId,
      document_type: aiDraft.document_type,
      draft_text: aiDraft.draft_text,
    };
  }

  return {
    traceId,
    document_type: documentType,
    draft_text: draftText,
  };
}

export async function verifyAnalysis(
  input: VerificationCheckRequest,
  traceId: string
): Promise<VerificationCheckResponse> {
  const text = typeof input.analysis === 'string' ? input.analysis : JSON.stringify(input.analysis || {});
  const deterministicMissing: string[] = [];

  if (!text || text === '{}') {
    deterministicMissing.push('Analys saknas.');
  }

  const hasLawName =
    /(milj(?:o|\u00f6)balken|avfallsf(?:o|\u00f6)rordningen|milj(?:o|\u00f6)provningsf(?:o|\u00f6)rordningen)/i.test(
      text
    ) || /\bSFS\s*\d{4}:\d+/i.test(text);
  if (!hasLawName) {
    deterministicMissing.push('Saknar lag- eller forordningsnamn (eller SFS-nummer).');
  }

  const hasChapterAndParagraph = /\b\d+\s*kap\.\s*\d+\s*[a-z]?\s*(?:\u00a7|paragraf)\b/i.test(text);
  if (!hasChapterAndParagraph) {
    deterministicMissing.push('Saknar kapitel/paragraf-hanvisning (ex. 26 kap. paragraf 19).');
  }

  const secondOpinion = await getVerificationSecondOpinionFromOpenAi({ analysis: text });
  const aiMissing = secondOpinion?.missing_citations || [];
  const missing = Array.from(new Set([...deterministicMissing, ...aiMissing]));

  const status =
    deterministicMissing.length > 0 || secondOpinion?.status === 'UNVERIFIED' ? 'UNVERIFIED' : 'VERIFIED';

  return {
    traceId,
    status,
    missing_citations: missing,
  };
}

export async function runMvpWorkflow(input: MvpWorkflowRequest, traceId: string): Promise<MvpWorkflowResponse> {
  const classification = classifyActivity(
    {
      activity_code: input.activity_code,
      ewc_code: input.ewc_code,
      volume_tons: input.volume_tons,
    },
    traceId
  );
  const requirements = await getComplianceRequirements(
    {
      activity_code: input.activity_code,
      ewc_code: input.ewc_code,
    },
    traceId
  );
  const risk = analyzeRisk(
    {
      ewc_code: input.ewc_code,
      volume_tons: input.volume_tons,
      location: input.location,
    },
    traceId
  );
  const permit = await generatePermitDraft(
    {
      project_data: {
        ...input.project_data,
        volume_tons: input.volume_tons,
        ewc_code: input.ewc_code,
        classification: classification.classification,
      },
      requirements: requirements.requirements,
      risk_flags: risk.risk_flags,
    },
    traceId
  );
  const verification = await verifyAnalysis(
    {
      analysis: permit.draft_text,
    },
    traceId
  );

  return {
    traceId,
    classification: {
      classification: classification.classification,
      legal_basis: classification.legal_basis,
      status: classification.status,
      ewc_code: classification.ewc_code,
      volume_tons: classification.volume_tons,
    },
    requirements: {
      requirements: requirements.requirements,
      source: requirements.source,
    },
    risk: {
      risk_flags: risk.risk_flags,
      risk_score: risk.risk_score,
    },
    permit: {
      document_type: permit.document_type,
      draft_text: permit.draft_text,
    },
    verification: {
      status: verification.status,
      missing_citations: verification.missing_citations,
    },
  };
}
