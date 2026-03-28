export interface ExamSnapshotInput {
  snapshotDir: string;
  files: {
    cases: string;
    requirements: string;
    citations: string;
    summary: string;
  };
}

export interface ExamVerifiedDataset {
  datasetDir: string;
  totals: {
    cases: number;
    requirements: number;
    citations: number;
  };
  passedQualityGate: boolean;
  qualityGateReportPath: string;
  frozenManifestPath?: string;
}

export interface ExamReportArtifacts {
  releaseDir: string;
  files: {
    tableA: string;
    tableB: string;
    tableC: string;
    tableD: string;
    evidenceIndex: string;
    summary: string;
    reportDraft: string;
    manifest: string;
  };
  generatedAt: string;
}
