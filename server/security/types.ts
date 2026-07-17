export type UserRole = 'ADMIN' | 'CONSULTANT' | 'AUDITOR' | 'BANK';

export interface AuthUser {
  id: string;
  organisationId: string;
  bankidId: string;
  role: UserRole;
}

export interface PropertyLookupInput {
  projectId: string;
  propertyDesignation: string;
  purpose: string;
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
