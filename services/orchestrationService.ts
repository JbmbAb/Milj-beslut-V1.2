import {
  validateLabData,
  analyzeLogisticsCompliance,
  LabDataValidationResult,
  LogisticsComplianceResult,
} from './geminiService';
import {
  evaluateProjectCompliance,
  ComplianceMetrics,
  RuleEngineResult,
} from '../server/services/complianceRuleEngine';

/** Verifierbart steg i pipelinen — LLM/Vertex får inte ändra dessa, bara citera dem. */
export type ComplianceToolId = 'lab_validate' | 'rule_engine_evaluate' | 'logistics_analyze';

export type ComplianceToolTraceEntry = {
  toolId: ComplianceToolId;
  /** Röd: ingen rå labbtext (PII) — bara längd/stub. */
  input: Record<string, unknown>;
  output: unknown;
};

export type OrchestrationRequest = {
  wasteCode: string;
  volumeTons: number;
  hazardousClassification: boolean;
  groundwaterProximity: boolean;
  missingDocumentation: boolean;
  labData: string;
  storageDuration: string;
  location: string;
  receivingFacility: string;
};

export type OrchestrationResponse = {
  complianceScore: RuleEngineResult;
  labValidationResult: LabDataValidationResult | null;
  logisticsAnalysis: LogisticsComplianceResult | null;
  explainability: string[];
};

export type OrchestrationWithToolTrace = OrchestrationResponse & {
  toolTrace: ComplianceToolTraceEntry[];
};

/**
 * Kärna: samma steg som `runComplianceWorkflow`, plus strukturerat spår.
 * Ett svar "bättre än naken Gemini" = riskScore och krav ska härledas till
 * `toolTrace`-posten `rule_engine_evaluate`, inte till fri textgenerering.
 */
async function runComplianceWorkflowCore(
  req: OrchestrationRequest,
): Promise<{ response: OrchestrationResponse; toolTrace: ComplianceToolTraceEntry[] }> {
  const toolTrace: ComplianceToolTraceEntry[] = [];

  const labResult = await validateLabData(req.labData);
  const labExceedancesCount = labResult?.parameters_exceeding_limits?.length || 0;

  toolTrace.push({
    toolId: 'lab_validate',
    input: { labDataCharLength: req.labData.length },
    output: labResult,
  });

  const metrics: ComplianceMetrics = {
    volumeTons: req.volumeTons,
    hazardousClassification: req.hazardousClassification,
    groundwaterProximity: req.groundwaterProximity,
    missingDocumentation: req.missingDocumentation,
    labExceedancesCount: labExceedancesCount,
  };

  const scoreResult = evaluateProjectCompliance(metrics);
  toolTrace.push({
    toolId: 'rule_engine_evaluate',
    input: { metrics },
    output: scoreResult,
  });

  const logisticsInput = {
    wasteCode: req.wasteCode,
    volume: String(req.volumeTons),
    storageDuration: req.storageDuration,
    location: req.location,
    receivingFacility: req.receivingFacility,
  };
  const logisticsResult = await analyzeLogisticsCompliance(logisticsInput);

  toolTrace.push({
    toolId: 'logistics_analyze',
    input: logisticsInput,
    output: logisticsResult,
  });

  const explainabilityLogs = [
    `Initiated Multi-Stage Compliance Workflow for ${req.volumeTons} tons of ${req.wasteCode}`,
    `Rule Engine computed risk: ${scoreResult.riskScore}. Factors: ${scoreResult.riskFactors.join(', ')}`,
    `Agent 3 (Lab Validator) finished: ${labResult?.status} - ${labExceedancesCount} exceedances.`,
    `Agent 4 (Logistics Analyst) reviewed transport to ${req.receivingFacility}. Risk: ${logisticsResult?.environmental_risks.length}`,
  ];

  return {
    response: {
      complianceScore: scoreResult,
      labValidationResult: labResult,
      logisticsAnalysis: logisticsResult,
      explainability: explainabilityLogs,
    },
    toolTrace,
  };
}

/**
 * Agent Workflow Orchestrator:
 * Chains multiple AI Agents into a single verifiable compliance flow,
 * bypassing LLM hallucinations through the Hybrid Rule Engine.
 */
export const runComplianceWorkflow = async (req: OrchestrationRequest): Promise<OrchestrationResponse> => {
  const { response } = await runComplianceWorkflowCore(req);
  return response;
};

/**
 * Samma som `runComplianceWorkflow` med serialiserbart `toolTrace` för
 * granskning, audit och (valfritt) modellsammanfattning där *endast* spåret får citeras.
 */
export const runComplianceWorkflowWithToolTrace = async (
  req: OrchestrationRequest,
): Promise<OrchestrationWithToolTrace> => {
  const { response, toolTrace } = await runComplianceWorkflowCore(req);
  return { ...response, toolTrace };
};
