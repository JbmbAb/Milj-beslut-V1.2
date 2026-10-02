export type UserRole = 'ADMIN' | 'CONSULTANT' | 'AUDITOR' | 'BANK';

export interface AuthUser {
  id: string;
  organisationId: string | null;
  bankidId: string;
  role: UserRole;
  /** Provenance of the BankID identity, not an authorization grant. */
  identityEnvironment?: 'MOCK' | 'TEST' | 'PRODUCTION' | 'LEGACY';
}

export interface PropertyLookupInput {
  projectId: string;
  propertyDesignation: string;
  purpose: string;
  /** Optional county (län) code; when given, the exact property lookup only matches within it. */
  lanKod?: number;
}

export interface ProjectRecord {
  id: string;
  organisationId: string;
  propertyDesignation: string;
  status: 'ACTIVE' | 'CLOSED' | 'ARCHIVED';
}

export interface ProjectMemberRecord {
  projectId: string;
  userId: string;
  accessRole: 'OWNER' | 'CONTRIBUTOR' | 'REVIEWER' | 'AUDITOR';
}

export interface PropertyAccessAuditEvent {
  userId: string;
  projectId: string;
  propertyDesignation: string;
  purpose: string;
  responseClass: 'geometry' | 'boundaries' | 'ownership_redacted';
}
