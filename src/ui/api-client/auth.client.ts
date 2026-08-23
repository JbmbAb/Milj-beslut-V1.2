import { csrfFetch } from '../../../services/csrfClient';

/**
 * AUTH API CLIENT
 */

export interface BankIdInitResponse {
  ok: boolean;
  orderRef: string;
  autoStartToken: string;
  qrStartToken: string;
  qrStartSecret: string;
  orderTime: string;
  qrPayload: string;
  launchMode?: 'bankid' | 'mock';
  launchUrl?: string;
}

export interface BankIdCollectResponse {
  ok: boolean;
  status: 'pending' | 'failed' | 'complete';
  hintCode?: string;
  accessToken?: string;
  refreshToken?: string;
  user?: {
    id: string;
    role: string;
    organisationId: string;
    bankidId?: string;
    displayName?: string;
  };
}

export async function initiateBankId(endUserIp?: string): Promise<BankIdInitResponse> {
  const response = await csrfFetch('/api/auth/bankid/init', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ endUserIp }),
  });
  if (!response.ok) throw new Error('Kunde inte initiera BankID');
  return await response.json();
}

export async function collectBankId(orderRef: string): Promise<BankIdCollectResponse> {
  const response = await csrfFetch('/api/auth/bankid/collect', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ orderRef }),
  });
  if (!response.ok) throw new Error('Kunde inte hämta status');
  return await response.json();
}

export async function cancelBankId(orderRef: string): Promise<void> {
  await csrfFetch('/api/auth/bankid/cancel', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ orderRef }),
  });
}

export async function logout(accessToken?: string, refreshToken?: string): Promise<void> {
  await csrfFetch('/api/auth/logout', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: JSON.stringify({ refreshToken }),
  });
}
