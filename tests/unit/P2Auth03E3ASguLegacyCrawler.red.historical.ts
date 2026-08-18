import { beforeEach, describe, expect, it, vi } from 'vitest';

const { existsSyncMock, mkdirSyncMock, writeFileSyncMock } = vi.hoisted(() => ({
  existsSyncMock: vi.fn(() => false),
  mkdirSyncMock: vi.fn(),
  writeFileSyncMock: vi.fn(),
}));

vi.mock('node:fs', () => ({
  default: {
    existsSync: existsSyncMock,
    mkdirSync: mkdirSyncMock,
    writeFileSync: writeFileSyncMock,
  },
  existsSync: existsSyncMock,
  mkdirSync: mkdirSyncMock,
  writeFileSync: writeFileSyncMock,
}));

vi.mock('dotenv', () => ({ default: { config: vi.fn() } }));

describe('P2-AUTH-03E3-A historical red proof - SGU broad crawler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('P2-AUTH-03E3-A VIOLATED: broad SGU discovery can acquire and persist material', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => '<html><head><title>SGU guidance</title></head><body></body></html>',
      arrayBuffer: async () => new ArrayBuffer(0),
    }));
    vi.stubGlobal('fetch', fetchMock);

    await import('../../scripts/fetch_sgu_anvandarstod_knowledge');

    await vi.waitFor(() => {
      expect(writeFileSyncMock).toHaveBeenCalledTimes(2);
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(mkdirSyncMock).toHaveBeenCalledTimes(3);

    throw new Error(
      'P2-AUTH-03E3-A VIOLATED: network_calls=1; payload_writes=1; manifest_writes=1; ' +
        'verified_source_authority_used=false',
    );
  });
});
