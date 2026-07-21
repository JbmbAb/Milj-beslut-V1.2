/**
 * AUDIT DOMAIN
 * Loggar alla viktiga händelser för juridisk spårbarhet (Immutable).
 */

export enum AuditAction {
  CREATE = 'CREATE',
  UPDATE = 'UPDATE',
  DELETE = 'DELETE',
  VERIFY = 'VERIFY',
  EXPORT = 'EXPORT',
  ACCESS = 'ACCESS',
}

export interface AuditEvent {
  id: string;
  timestamp: Date;
  userId: string;
  action: AuditAction;
  entityType: string; // T.ex. "Project", "Requirement"
  entityId: string;
  details: string; // JSON-sträng eller textbeskrivning
  clientIp?: string;
  userAgent?: string;
  signatureId?: string; // För kryptografisk signering (BankID/eIDAS)
}
