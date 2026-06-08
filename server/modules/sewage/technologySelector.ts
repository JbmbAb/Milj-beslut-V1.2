import type { SewageGISAnalysis, SewageSystemTypeId } from '../../../types';

export function selectPreferredSewageTechnology(
  analysis: Pick<SewageGISAnalysis, 'recommendedSystems' | 'blockedSystems'>,
): SewageSystemTypeId | null {
  return analysis.recommendedSystems.find((system) => !analysis.blockedSystems.includes(system)) ?? null;
}
