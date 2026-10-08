import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  runSpatialAudit: vi.fn(),
  serverGenerateText: vi.fn(),
}));

vi.mock('../../server/services/spatialAuditService', () => ({
  runSpatialAudit: mocks.runSpatialAudit,
}));

vi.mock('../../services/aiAssistantService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/aiAssistantService')>()),
  serverGenerateText: mocks.serverGenerateText,
}));

import { performServerSpatialAudit } from '../../server/services/aiSpatialAuditService';

/**
 * U51-DYNAMIC-IMPORT-CLOSURE-01 B4: server-side fallback chain for performSpatialAudit. Same order as the former
 * shared Node-only branch: local runSpatialAudit, then local generation text, then the unavailable error.
 */
describe('performServerSpatialAudit fallback chain', () => {
  beforeEach(() => {
    mocks.runSpatialAudit.mockReset();
    mocks.serverGenerateText.mockReset();
  });

  it('returns the local audit as { text, sources } and skips generation', async () => {
    mocks.runSpatialAudit.mockResolvedValueOnce({
      text: 'local-text',
      sources: [{ web: { uri: 'https://example.invalid/s', title: 'S' } }],
      unrelated: true,
    });

    const result = await performServerSpatialAudit(59.33, 18.06);

    expect(mocks.runSpatialAudit).toHaveBeenCalledWith(59.33, 18.06);
    expect(result).toEqual({
      text: 'local-text',
      sources: [{ web: { uri: 'https://example.invalid/s', title: 'S' } }],
    });
    expect(mocks.serverGenerateText).not.toHaveBeenCalled();
  });

  it('falls back to local generation text with empty sources when the local audit fails', async () => {
    mocks.runSpatialAudit.mockRejectedValueOnce(new Error('db down'));
    mocks.serverGenerateText.mockResolvedValueOnce('generated-text');

    const result = await performServerSpatialAudit(59.33, 18.06);

    expect(result).toEqual({ text: 'generated-text', sources: [] });
    expect(mocks.serverGenerateText).toHaveBeenCalledWith(expect.stringContaining('lat 59.33, lng 18.06'));
  });

  it('throws the unavailable error when the local audit and generation both fail', async () => {
    mocks.runSpatialAudit.mockRejectedValueOnce(new Error('db down'));
    mocks.serverGenerateText.mockResolvedValueOnce(null);

    await expect(performServerSpatialAudit(59.33, 18.06)).rejects.toThrow(
      'Spatial audit saknar verifierad AI-källa',
    );
  });
});
