export type Project = {
  id: string;
  propertyDesignation: string;
  status: string;
  docCount: number;
  coverage: {
    municipality: number;
    decisionType: number;
  };
};

export type SearchResult = {
  id: string;
  originalName: string;
  subject: string;
  municipality: string;
  decisionType: string;
  snippet: string;
  score: number;
};

export type Classification = {
  classification: string;
  riskLevel: string;
  suggestedCode: string;
  confidence: number;
  missingFields: string[];
  citations: Array<{ source: string; snippet: string; municipality: string }>;
};

export type MunicipalityInsight = {
  name: string;
  index: number;
  ranking: number;
  commonRisks: string[];
  commonRequirements: string[];
  stats: {
    avgRequirements: number;
    riskCoveragePct: number;
    documentationLevel: string;
  };
  patterns: string[];
};

export function getProjectMunicipality(propertyDesignation: string): string {
  const municipality = propertyDesignation.split(' ')[0];
  return municipality || 'Okänd';
}
