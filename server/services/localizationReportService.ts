/**
 * localizationReportService.ts (Legacy Wrapper)
 *
 * Delegating all logic to Clean Architecture Use Case in src/application/
 */

import {
  GenerateLocalizationReportUseCase,
  type SiteAlternative,
  type SluObservation,
  type DataSourceStatus,
  type SiteAnalysisResult,
  type LocalizationReport,
  isLocalizationStrictMode,
} from '../../src/application/generate-localization-report.usecase';
import type { AuthUser } from '../security/types';

export {
  SiteAlternative,
  SluObservation,
  DataSourceStatus,
  SiteAnalysisResult,
  LocalizationReport,
  isLocalizationStrictMode,
};

const useCase = new GenerateLocalizationReportUseCase();

/**
 * Generates a full localization report for a given project and site alternatives.
 */
export async function generateLocalizationReport(input: {
  projectId: string;
  siteAlternatives: SiteAlternative[];
  userId?: string;
  user?: AuthUser;
}): Promise<LocalizationReport> {
  return useCase.execute(input);
}

/** Bakåtkompatibel signatur för äldre anrop. */
export async function generateLocalizationReportLegacy(
  projectId: string,
  siteAlternatives: SiteAlternative[],
  userId?: string,
): Promise<LocalizationReport> {
  return useCase.execute({ projectId, siteAlternatives, userId });
}
