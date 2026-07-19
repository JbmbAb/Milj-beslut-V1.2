/**
 * Sewage Regulations Service (Legacy wrapper)
 * Delegating all logic to Clean Architecture Use Case in src/application/
 */

export type {
  RegulatoryReference,
  SewageRegulation,
} from '../../src/application/evaluate-sewage-regulations.usecase';

export {
  SEWAGE_REGULATIONS,
  generateSewageRequirementChecklist,
  validateSewageApplicationRegulations,
  getMunicipalRegulations,
  generateRegulatorySourceTracing,
  EvaluateSewageRegulationsUseCase,
} from '../../src/application/evaluate-sewage-regulations.usecase';

export { listSewageEvidenceSources } from '../modules/legal/catalogs/sewageEvidenceSources';
