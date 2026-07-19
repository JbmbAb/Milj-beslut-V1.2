/**
 * pdfReportService.ts (Legacy Wrapper)
 *
 * Delegating all logic to Clean Architecture Use Case in src/application/
 */

import {
  GenerateReportPdfUseCase,
  type ApplicationPdfData,
  type SustainabilityReportData,
} from '../../src/application/generate-report-pdf.usecase';

export { ApplicationPdfData, SustainabilityReportData };

const useCase = new GenerateReportPdfUseCase();

/**
 * Hämtar data för att generera en PDF-anmälningsblankett.
 *
 * @param verksamhetskod  SNI/MB-verksamhetskod, t.ex. "9.1"
 * @param fastighet       Fastighetsbeteckning (valfri)
 */
export async function getApplicationPdfData(
  verksamhetskod: string,
  fastighet?: string | null,
): Promise<ApplicationPdfData> {
  return useCase.getApplicationPdfData(verksamhetskod, fastighet);
}

/**
 * Beräknar statistik för Grönkoll-hållbarhetsrapport.
 */
export async function getSustainabilityReportData(
  organisationId?: string,
): Promise<SustainabilityReportData> {
  return useCase.getSustainabilityReportData(organisationId);
}
