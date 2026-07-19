/**
 * caseSpine.ts
 *
 * "Case Spine" = minsta gemensamma domänryggrad som alla flöden kan hänga på.
 * Syftet är att göra migrering möjlig utan att alla interna implementationer
 * måste vara frysta: så länge spine-kontraktet består kan moduler bytas ut.
 */

export type OrganisationId = string & { readonly __brand: 'OrganisationId' };
export type UserId = string & { readonly __brand: 'UserId' };
export type ProjectId = string & { readonly __brand: 'ProjectId' };
export type DocumentId = string & { readonly __brand: 'DocumentId' };
export type RequirementCaseId = string & { readonly __brand: 'RequirementCaseId' };
export type RequirementId = string & { readonly __brand: 'RequirementId' };

export type CaseId =
  | { kind: 'PROJECT'; projectId: ProjectId }
  | { kind: 'REQUIREMENT_CASE'; requirementCaseId: RequirementCaseId };

export interface CaseSpine {
  organisationId: OrganisationId;
  projectId: ProjectId;
  /** Normaliserad fastighetsbeteckning eller användarinput (för uppslag/audit). */
  propertyDesignation: string;
  /**
   * "Case" kan vara en ren Project-spine eller en undercase (t.ex. requirement-case).
   * Detta gör det möjligt att migrera gradvis.
   */
  caseId: CaseId;
}

export function asOrganisationId(value: string): OrganisationId {
  const v = String(value || '').trim();
  if (!v) throw new Error('OrganisationId is required');
  return v as OrganisationId;
}

export function asUserId(value: string): UserId {
  const v = String(value || '').trim();
  if (!v) throw new Error('UserId is required');
  return v as UserId;
}

export function asProjectId(value: string): ProjectId {
  const v = String(value || '').trim();
  if (!v) throw new Error('ProjectId is required');
  return v as ProjectId;
}

export function asDocumentId(value: string): DocumentId {
  const v = String(value || '').trim();
  if (!v) throw new Error('DocumentId is required');
  return v as DocumentId;
}

export function asRequirementCaseId(value: string): RequirementCaseId {
  const v = String(value || '').trim();
  if (!v) throw new Error('RequirementCaseId is required');
  return v as RequirementCaseId;
}

export function asRequirementId(value: string): RequirementId {
  const v = String(value || '').trim();
  if (!v) throw new Error('RequirementId is required');
  return v as RequirementId;
}
