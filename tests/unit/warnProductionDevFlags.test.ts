import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('warnProductionDevFlags', { timeout: 10000 }, () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  it('does nothing when NODE_ENV is not production', async () => {
    process.env.NODE_ENV = 'development';
    process.env.BANKID_MOCK_MODE = 'true';
    const logger = await import('../../server/logger');
    const spy = vi.spyOn(logger.logger, 'error').mockImplementation(() => {});
    const { warnProductionDevFlags } = await import('../../server/warnProductionDevFlags');
    warnProductionDevFlags();
    expect(spy).not.toHaveBeenCalled();
  });

  it('logs error when NODE_ENV is production and BANKID_MOCK_MODE is true', async () => {
    process.env.NODE_ENV = 'production';
    process.env.BANKID_MOCK_MODE = 'true';
    process.env.AUTHORITY_MOCK_MODE = 'false';
    const logger = await import('../../server/logger');
    const spy = vi.spyOn(logger.logger, 'error').mockImplementation(() => {});
    const { warnProductionDevFlags } = await import('../../server/warnProductionDevFlags');
    warnProductionDevFlags();
    expect(spy).toHaveBeenCalledTimes(1);
    const payload = spy.mock.calls[0][1] as { flags?: string[] };
    expect(payload.flags).toContain('BANKID_MOCK_MODE');
  });

  it('logs error when both mock flags are true in production', async () => {
    process.env.NODE_ENV = 'production';
    process.env.BANKID_MOCK_MODE = 'true';
    process.env.AUTHORITY_MOCK_MODE = 'true';
    const logger = await import('../../server/logger');
    const spy = vi.spyOn(logger.logger, 'error').mockImplementation(() => {});
    const { warnProductionDevFlags } = await import('../../server/warnProductionDevFlags');
    warnProductionDevFlags();
    expect(spy).toHaveBeenCalledTimes(1);
    const payload = spy.mock.calls[0][1] as { flags?: string[] };
    expect(payload.flags).toEqual(expect.arrayContaining(['BANKID_MOCK_MODE', 'AUTHORITY_MOCK_MODE']));
  });
});
