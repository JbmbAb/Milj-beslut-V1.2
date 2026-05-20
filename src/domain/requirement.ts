/**
 * REQUIREMENT DOMAIN
 * Representerar ett juridiskt eller tekniskt krav som projektet måste efterleva.
 */

export enum RequirementLevel {
  MANDATORY = 'MANDATORY',
  RECOMMENDED = 'RECOMMENDED',
  INFORMATION = 'INFORMATION',
}

export enum RequirementStatus {
  PENDING = 'PENDING',
  REVIEWED = 'REVIEWED',
  VERIFIED = 'VERIFIED',
  REJECTED = 'REJECTED',
}

export interface Requirement {
  id: string;
  code: string; // T.ex. "KRAV-001"
  category: string; // T.ex. "Masshantering"
  subcategory?: string;
  text: string; // Det faktiska kravet
  interpretedText?: string; // AI-tolkning eller förenkling
  level: RequirementLevel;
  status: RequirementStatus;
  legalReference?: string;
  sourceDocumentId?: string; // Koppling till dokumentet kravet kom ifrån
  isMinimumRequirement: boolean;
  municipalitySpecific: boolean;
  createdAt: Date;
  updatedAt: Date;
}
