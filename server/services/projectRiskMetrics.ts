/** Delad risk-/compliance-metric för projekt (GreenCheck, WebSocket, API). */

export interface ProjectRiskMetric {
  name: string;
  score: number;
  threshold: number;
  status: 'low' | 'medium' | 'high';
}

export function buildProjectRiskMetrics(project: {
  complianceScore: number | null;
  environmentalScore: number | null;
  regulatoryRiskScore: number | null;
}): ProjectRiskMetric[] {
  const regulatory = project.regulatoryRiskScore ?? 35;
  const environmental = project.environmentalScore ?? 62;
  const compliance = project.complianceScore ?? 0;

  return [
    {
      name: 'Regulatorisk Risk',
      score: regulatory,
      threshold: 50,
      status: regulatory < 50 ? 'low' : 'medium',
    },
    {
      name: 'Miljöpåverkan',
      score: environmental,
      threshold: 75,
      status: environmental < 50 ? 'low' : environmental < 75 ? 'medium' : 'high',
    },
    {
      name: 'Compliance',
      score: compliance,
      threshold: 75,
      status: compliance >= 75 ? 'low' : compliance >= 50 ? 'medium' : 'high',
    },
  ];
}

export function compliancePercentFromMetrics(metrics: ProjectRiskMetric[]): number | null {
  const compliance = metrics.find((m) => m.name === 'Compliance');
  if (compliance && compliance.score > 0) {
    return Math.round(Math.min(100, Math.max(0, compliance.score)));
  }
  if (metrics.length === 0) return null;
  const passing = metrics.filter((m) => m.status === 'low' || m.score >= m.threshold).length;
  return Math.round((passing / metrics.length) * 100);
}
