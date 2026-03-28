/**
 * Tests för services/auditLogService.ts
 * Verifierar kryptografisk integritet och filtrering av audit trail.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Vi måste reset modulen mellan tester för att tömma in-memory trail
describe('auditLogService', () => {
  let service: typeof import('../../services/auditLogService');

  beforeEach(async () => {
    vi.resetModules();
    service = await import('../../services/auditLogService');
  });

  describe('appendAuditLog', () => {
    it('skapar en post med automatiskt logId och timestamp', () => {
      const entry = service.appendAuditLog({
        userId: 'user-001',
        actionType: 'AI_GENERATION',
        modelVersions: ['gemini-2.0-flash'],
        promptOrInput: 'Analysera risk',
        ragDocumentsUsed: [],
        responseOrOutput: 'Hög risk',
        verificationStatus: 'UNVERIFIED',
      });

      expect(entry.logId).toBeDefined();
      expect(entry.logId.length).toBeGreaterThan(10);
      expect(entry.timestamp).toBeDefined();
      expect(new Date(entry.timestamp).getFullYear()).toBeGreaterThanOrEqual(2024);
    });

    it('genererar ett SHA-256 signatureHash', () => {
      const entry = service.appendAuditLog({
        userId: 'user-002',
        actionType: 'RULE_ENGINE_EVALUATION',
        modelVersions: [],
        promptOrInput: { volumeTons: 500 },
        ragDocumentsUsed: [],
        responseOrOutput: { riskScore: 'HIGH' },
        verificationStatus: 'VERIFIED',
      });

      expect(entry.signatureHash).toMatch(/^[a-f0-9]{64}$/);
    });

    it('bevara alla indata-fält i posten', () => {
      const entry = service.appendAuditLog({
        userId: 'user-003',
        actionType: 'DOCUMENT_GENERATION',
        modelVersions: ['docx-engine-v1'],
        promptOrInput: 'Kontrollplan',
        ragDocumentsUsed: ['doc-1', 'doc-2'],
        responseOrOutput: 'Genererat dokument',
        verificationStatus: 'MANUAL_OVERRIDE',
      });

      expect(entry.userId).toBe('user-003');
      expect(entry.actionType).toBe('DOCUMENT_GENERATION');
      expect(entry.modelVersions).toEqual(['docx-engine-v1']);
      expect(entry.ragDocumentsUsed).toEqual(['doc-1', 'doc-2']);
      expect(entry.verificationStatus).toBe('MANUAL_OVERRIDE');
    });

    it('genererar unika logId för varje post', () => {
      const e1 = service.appendAuditLog({
        userId: 'u1',
        actionType: 'AI_GENERATION',
        modelVersions: [],
        promptOrInput: 'a',
        ragDocumentsUsed: [],
        responseOrOutput: 'b',
        verificationStatus: 'UNVERIFIED',
      });
      const e2 = service.appendAuditLog({
        userId: 'u1',
        actionType: 'AI_GENERATION',
        modelVersions: [],
        promptOrInput: 'a',
        ragDocumentsUsed: [],
        responseOrOutput: 'b',
        verificationStatus: 'UNVERIFIED',
      });
      expect(e1.logId).not.toBe(e2.logId);
    });

    it('hanterar alla actionType-värden', () => {
      const types: Array<import('../../services/auditLogService').AuditLogEntry['actionType']> = [
        'AI_GENERATION',
        'RULE_ENGINE_EVALUATION',
        'DOCUMENT_GENERATION',
        'USER_SIGNOFF',
      ];
      types.forEach((actionType) => {
        const entry = service.appendAuditLog({
          userId: 'u',
          actionType,
          modelVersions: [],
          promptOrInput: '',
          ragDocumentsUsed: [],
          responseOrOutput: '',
          verificationStatus: 'UNVERIFIED',
        });
        expect(entry.actionType).toBe(actionType);
      });
    });
  });

  describe('getAuditLogs', () => {
    it('returnerar alla poster utan userId-filter', () => {
      service.appendAuditLog({
        userId: 'alice',
        actionType: 'AI_GENERATION',
        modelVersions: [],
        promptOrInput: 'X',
        ragDocumentsUsed: [],
        responseOrOutput: 'Y',
        verificationStatus: 'UNVERIFIED',
      });
      service.appendAuditLog({
        userId: 'bob',
        actionType: 'DOCUMENT_GENERATION',
        modelVersions: [],
        promptOrInput: 'A',
        ragDocumentsUsed: [],
        responseOrOutput: 'B',
        verificationStatus: 'VERIFIED',
      });

      const all = service.getAuditLogs();
      expect(all.length).toBeGreaterThanOrEqual(2);
    });

    it('filtrerar poster på userId', () => {
      service.appendAuditLog({
        userId: 'charlie',
        actionType: 'USER_SIGNOFF',
        modelVersions: [],
        promptOrInput: 'sign',
        ragDocumentsUsed: [],
        responseOrOutput: 'signed',
        verificationStatus: 'VERIFIED',
      });
      service.appendAuditLog({
        userId: 'diana',
        actionType: 'AI_GENERATION',
        modelVersions: [],
        promptOrInput: 'gen',
        ragDocumentsUsed: [],
        responseOrOutput: 'result',
        verificationStatus: 'UNVERIFIED',
      });

      const charlies = service.getAuditLogs('charlie');
      expect(charlies.every((e) => e.userId === 'charlie')).toBe(true);
      expect(charlies.length).toBeGreaterThanOrEqual(1);
    });

    it('returnerar tom array för okänt userId', () => {
      const unknown = service.getAuditLogs('nonexistent-user-xyz');
      expect(unknown).toHaveLength(0);
    });

    it('returnerar kopia av trail (inte referens)', () => {
      const all = service.getAuditLogs();
      const originalLength = all.length;
      all.push({} as any);
      expect(service.getAuditLogs().length).toBe(originalLength);
    });

    it('hanterar object och Record som promptOrInput', () => {
      const entry = service.appendAuditLog({
        userId: 'ev-user',
        actionType: 'RULE_ENGINE_EVALUATION',
        modelVersions: [],
        promptOrInput: { key: 'value', nested: { arr: [1, 2, 3] } },
        ragDocumentsUsed: ['doc-x'],
        responseOrOutput: { status: 'PASS' },
        verificationStatus: 'VERIFIED',
      });
      expect(typeof entry.signatureHash).toBe('string');
      expect(entry.signatureHash.length).toBe(64);
    });
  });
});
