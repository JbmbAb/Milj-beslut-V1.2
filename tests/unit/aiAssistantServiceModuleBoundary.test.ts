import { describe, expect, it, vi } from 'vitest';

/**
 * U51-DYNAMIC-IMPORT-CLOSURE-01 B4: services/aiAssistantService.ts is shared by browser components and the server.
 * It must not reference the server spatial audit service or its runner. The server-side performSpatialAudit lives in
 * server/services/aiSpatialAuditService.ts instead.
 */
describe('shared aiAssistantService module boundary', () => {
  it('does not reference the server spatial audit service, its runner, or the removed shared performSpatialAudit', async () => {
    const actualFs = await vi.importActual<typeof import('node:fs')>('node:fs');
    const source = actualFs.readFileSync(`${process.cwd()}/services/aiAssistantService.ts`, 'utf8');

    expect(source).not.toContain('spatialAuditService');
    expect(source).not.toContain('runSpatialAudit');
    expect(source).not.toContain('performSpatialAudit');
  });
});
