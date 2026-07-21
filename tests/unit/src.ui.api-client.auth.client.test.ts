import { afterEach, describe, expect, it, vi } from 'vitest';
import { csrfFetch } from '../../services/csrfClient';
import { cancelBankId, collectBankId, initiateBankId, logout } from '../../src/ui/api-client/auth.client';

vi.mock('../../services/csrfClient', () => ({
  csrfFetch: vi.fn(),
}));

describe('src/ui/api-client.auth.client', () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it('initiates BankID with optional endUserIp', async () => {
    const payload = { ok: true, orderRef: 'order-1' } as const;
    vi.mocked(csrfFetch).mockResolvedValue({
      ok: true,
      json: async () => payload,
    } as Response);

    await expect(initiateBankId('127.0.0.1')).resolves.toEqual(payload);
    expect(csrfFetch).toHaveBeenCalledWith('/api/auth/bankid/init', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endUserIp: '127.0.0.1' }),
    });
  });

  it('throws when BankID initiation fails', async () => {
    vi.mocked(csrfFetch).mockResolvedValue({ ok: false } as Response);

    await expect(initiateBankId()).rejects.toThrow('Kunde inte initiera BankID');
  });

  it('collects BankID status and throws on failure', async () => {
    vi.mocked(csrfFetch)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: true, status: 'pending' }),
      } as Response)
      .mockResolvedValueOnce({ ok: false } as Response);

    await expect(collectBankId('order-2')).resolves.toEqual({ ok: true, status: 'pending' });
    await expect(collectBankId('order-2')).rejects.toThrow('Kunde inte hämta status');
  });

  it('sends cancel and logout requests', async () => {
    vi.mocked(csrfFetch).mockResolvedValue({ ok: true } as Response);

    await cancelBankId('order-3');
    await logout();

    expect(csrfFetch).toHaveBeenNthCalledWith(1, '/api/auth/bankid/cancel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderRef: 'order-3' }),
    });
    expect(csrfFetch).toHaveBeenNthCalledWith(2, '/api/auth/logout', { method: 'POST' });
  });
});
