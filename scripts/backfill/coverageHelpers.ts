export interface CoverageInputs {
  totalDocuments: number;
  failedDocuments: number;
  municipalityCount: number;
  diarieCount: number;
  decisionTypeCount: number;
  activityCodeCount: number;
  wasteTypeCount: number;
  caseCandidates: number;
  materializedCases: number;
  requirementRecords: number;
  requirementCitations: number;
  evidenceRows: number;
  openReviewItems: number;
  openDisagreements: number;
  thresholds?: {
    municipality?: number;
    diarie?: number;
  };
}

function pct(count: number, total: number): string {
  return total > 0 ? `${((count / total) * 100).toFixed(1)}%` : "N/A";
}

function ratio(count: number, total: number): number {
  return total > 0 ? count / total : 0;
}

export function buildCoverageReport(input: CoverageInputs) {
  const eligibleDocuments = Math.max(0, input.totalDocuments - input.failedDocuments);
  const municipalityThreshold = input.thresholds?.municipality ?? 0.9;
  const diarieThreshold = input.thresholds?.diarie ?? 0.9;

  const municipalityPrecision = ratio(input.municipalityCount, eligibleDocuments);
  const diariePrecision = ratio(input.diarieCount, eligibleDocuments);
  const passed = municipalityPrecision >= municipalityThreshold && diariePrecision >= diarieThreshold;

  return {
    generatedAt: new Date().toISOString(),
    failGate: {
      passed,
      municipalityPrecision: municipalityPrecision.toFixed(3),
      diariePrecision: diariePrecision.toFixed(3),
      thresholds: {
        municipality: municipalityThreshold,
        diarie: diarieThreshold,
      },
      precisionBasis: {
        excludesFailedDocuments: true,
        eligibleDocuments,
      },
    },
    documents: {
      total: input.totalDocuments,
      failed: input.failedDocuments,
      eligible: eligibleDocuments,
    },
    metadataCoverage: {
      municipalityNormalized: {
        count: input.municipalityCount,
        countBasis: "eligibleDocuments",
        pctOfAllDocuments: pct(input.municipalityCount, input.totalDocuments),
        pctOfEligibleDocuments: pct(input.municipalityCount, eligibleDocuments),
      },
      legalStatus_diarie: {
        count: input.diarieCount,
        countBasis: "eligibleDocuments",
        pctOfAllDocuments: pct(input.diarieCount, input.totalDocuments),
        pctOfEligibleDocuments: pct(input.diarieCount, eligibleDocuments),
      },
      decisionType: {
        count: input.decisionTypeCount,
        countBasis: "eligibleDocuments",
        pctOfAllDocuments: pct(input.decisionTypeCount, input.totalDocuments),
        pctOfEligibleDocuments: pct(input.decisionTypeCount, eligibleDocuments),
      },
      activityCode: {
        count: input.activityCodeCount,
        countBasis: "eligibleDocuments",
        pctOfAllDocuments: pct(input.activityCodeCount, input.totalDocuments),
        pctOfEligibleDocuments: pct(input.activityCodeCount, eligibleDocuments),
      },
      wasteType: {
        count: input.wasteTypeCount,
        countBasis: "eligibleDocuments",
        pctOfAllDocuments: pct(input.wasteTypeCount, input.totalDocuments),
        pctOfEligibleDocuments: pct(input.wasteTypeCount, eligibleDocuments),
      },
    },
    cases: {
      caseCandidates: input.caseCandidates,
      materializedCases: input.materializedCases,
      requirementRecords: input.requirementRecords,
      requirementCitations: input.requirementCitations,
    },
    pipeline: {
      evidenceRows: input.evidenceRows,
      openReviewItems: input.openReviewItems,
      openDisagreements: input.openDisagreements,
    },
  };
}
