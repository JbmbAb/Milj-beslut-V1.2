import { describe, expect, it } from 'vitest';
import { CORE_MODEL_MANIFEST, CORE_MODEL_VERSION } from '../../server/domain/coreModel';

describe('coreModel manifest', () => {
  it('has stable shape and hashes', () => {
    expect(CORE_MODEL_MANIFEST.version).toBe(CORE_MODEL_VERSION);
    expect(CORE_MODEL_MANIFEST.project).toMatch(/^[a-f0-9]{64}$/);
    expect(CORE_MODEL_MANIFEST.requirement).toMatch(/^[a-f0-9]{64}$/);
    expect(CORE_MODEL_MANIFEST.auditEvent).toMatch(/^[a-f0-9]{64}$/);
  });
});
