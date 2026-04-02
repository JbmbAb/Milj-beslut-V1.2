export type ComplianceMetrics = {
    volumeTons: number;
    hazardousClassification: boolean;
    groundwaterProximity: boolean;
    missingDocumentation: boolean;
    labExceedancesCount: number;
};

export type RuleEngineResult = {
    riskScore: "LOW" | "MEDIUM" | "HIGH";
    riskFactors: string[];
    requiresPermitOrNotification: "NONE" | "NOTIFICATION" | "PERMIT";
    requirements: string[];
};

/**
 * Hybrid AI + Rule Engine:
 * Evaluates strict thresholds to decide compliance requirements,
 * offloading the hard numeric logic from the LLM.
 */
export const evaluateProjectCompliance = (metrics: ComplianceMetrics): RuleEngineResult => {
    const result: RuleEngineResult = {
        riskScore: "LOW",
        riskFactors: [],
        requiresPermitOrNotification: "NONE",
        requirements: []
    };

    // 1. Hard Thresholds (Miljöprövningsförordningen)
    if (metrics.volumeTons > 10000 || metrics.hazardousClassification) {
        result.requiresPermitOrNotification = "PERMIT";
        result.requirements.push("Tillstånd (B-anläggning) krävs enligt Miljöprövningsförordningen (2013:251).");
    } else if (metrics.volumeTons > 10) {
        result.requiresPermitOrNotification = "NOTIFICATION";
        result.requirements.push("Anmälan (C-anläggning) krävs. Undantag för ringa risk kan prövas, volymen (" + metrics.volumeTons + " ton) är över anmälningsplikt.");
    }

    // 2. Risk Score Model
    let rawScore = 0;

    // Volume factor
    if (metrics.volumeTons > 50000) rawScore += 3;
    else if (metrics.volumeTons > 1000) rawScore += 2;
    else if (metrics.volumeTons > 100) rawScore += 1;

    // Hazard factor
    if (metrics.hazardousClassification) {
        rawScore += 5;
        result.riskFactors.push("Farligt avfall (HW) identifierat.");
    }

    // Groundwater factor
    if (metrics.groundwaterProximity) {
        rawScore += 3;
        result.riskFactors.push("Platsen ligger inom eller nära vattenskyddsområde/grundvattenmagasin.");
    }

    // Documentation factor
    if (metrics.missingDocumentation) {
        rawScore += 2;
        result.riskFactors.push("Saknar formell spårbarhetsdokumentation eller egenkontroll.");
    }

    // Lab testing
    if (metrics.labExceedancesCount > 0) {
        rawScore += 4;
        result.riskFactors.push(`Riktvärdesöverskridande på ${metrics.labExceedancesCount} parameter/parametrar.`);
    }

    // Final tiering
    if (rawScore >= 7) {
        result.riskScore = "HIGH";
    } else if (rawScore >= 3) {
        result.riskScore = "MEDIUM";
    } else {
        result.riskScore = "LOW";
    }

    return result;
};
