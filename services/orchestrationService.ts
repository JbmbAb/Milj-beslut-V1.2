import { validateLabData, analyzeLogisticsCompliance, LabDataValidationResult, LogisticsComplianceResult } from "./geminiService";
import { evaluateProjectCompliance, ComplianceMetrics, RuleEngineResult } from "../server/services/complianceRuleEngine";

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

/**
 * Agent Workflow Orchestrator:
 * Chains multiple AI Agents into a single verifiable compliance flow,
 * bypassing LLM hallucinations through the Hybrid Rule Engine.
 */
export const runComplianceWorkflow = async (req: OrchestrationRequest): Promise<OrchestrationResponse> => {
    // Pass 1: Run AI Lab Validator (Agent 3)
    const labResult = await validateLabData(req.labData);
    const labExceedancesCount = labResult?.parameters_exceeding_limits?.length || 0;

    // Pass 2: Hybrid Rules Engine calculation for Risk Score
    const metrics: ComplianceMetrics = {
        volumeTons: req.volumeTons,
        hazardousClassification: req.hazardousClassification,
        groundwaterProximity: req.groundwaterProximity,
        missingDocumentation: req.missingDocumentation,
        labExceedancesCount: labExceedancesCount,
    };

    const scoreResult = evaluateProjectCompliance(metrics);

    // Pass 3: Logistics Agent run (Agent 4)
    const logisticsResult = await analyzeLogisticsCompliance({
        wasteCode: req.wasteCode,
        volume: String(req.volumeTons),
        storageDuration: req.storageDuration,
        location: req.location,
        receivingFacility: req.receivingFacility,
    });

    // Explainability log (Audit Trace)
    const explainabilityLogs = [
        `Initiated Multi-Stage Compliance Workflow for ${req.volumeTons} tons of ${req.wasteCode}`,
        `Rule Engine computed risk: ${scoreResult.riskScore}. Factors: ${scoreResult.riskFactors.join(", ")}`,
        `Agent 3 (Lab Validator) finished: ${labResult?.status} - ${labExceedancesCount} exceedances.`,
        `Agent 4 (Logistics Analyst) reviewed transport to ${req.receivingFacility}. Risk: ${logisticsResult?.environmental_risks.length}`,
    ];

    return {
        complianceScore: scoreResult,
        labValidationResult: labResult,
        logisticsAnalysis: logisticsResult,
        explainability: explainabilityLogs,
    };
};
