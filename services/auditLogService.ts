import * as crypto from 'crypto';

export type AuditLogEntry = {
  logId: string;
  timestamp: string;
  userId: string;
  actionType: 'AI_GENERATION' | 'RULE_ENGINE_EVALUATION' | 'DOCUMENT_GENERATION' | 'USER_SIGNOFF';
  modelVersions: string[];
  promptOrInput: string | Record<string, unknown>;
  ragDocumentsUsed: string[];
  responseOrOutput: string | Record<string, unknown>;
  verificationStatus: 'VERIFIED' | 'UNVERIFIED' | 'MANUAL_OVERRIDE';
  signatureHash: string;
};

// In-memory array for Core. In production, this would be an append-only database table (e.g. AWS QLDB or a protected PostgreSQL table).
const auditLogTrail: AuditLogEntry[] = [];

/**
 * Audit Chain (Juridisk Spårbarhet)
 *
 * Create an immutable, cryptographically verifiable log entry for
 * any compliance-related AI generation or rule evaluation.
 */
export const appendAuditLog = (
  entryData: Omit<AuditLogEntry, 'logId' | 'timestamp' | 'signatureHash'>,
): AuditLogEntry => {
  const logId = crypto.randomUUID();
  const timestamp = new Date().toISOString();

  // Create deterministic string for hashing (proof of immutability)
  const dataToHash = JSON.stringify({
    logId,
    timestamp,
    userId: entryData.userId,
    actionType: entryData.actionType,
    modelVersions: entryData.modelVersions,
    promptOrInput: entryData.promptOrInput,
    responseOrOutput: entryData.responseOrOutput,
    verificationStatus: entryData.verificationStatus,
  });

  const signatureHash = crypto.createHash('sha256').update(dataToHash).digest('hex');

  const entry: AuditLogEntry = {
    ...entryData,
    logId,
    timestamp,
    signatureHash,
  };

  auditLogTrail.push(entry);
  return entry;
};

/**
 * Retrieve the audit trail for a specific user or global.
 * Important for 'Explainability' and external regulators.
 */
export const getAuditLogs = (userId?: string): AuditLogEntry[] => {
  if (userId) {
    return auditLogTrail.filter((log) => log.userId === userId);
  }
  return [...auditLogTrail];
};
