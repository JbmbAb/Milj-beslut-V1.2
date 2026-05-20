import crypto from 'node:crypto';
import fs from 'node:fs';
import * as https from 'node:https'; // Corrected import path
import { createTokenPair, rotateRefreshToken } from '../security/auth';
import { assertBankIdEnv, getEnv, isBankIdMockMode } from '../security/env';
import { ensureMockAuthUser, findAuthUserByBankId } from '../repositories/userRepository';
import { persistentReplayProtection } from '../security/persistentReplayProtection';
import { logger } from '../logger';
import { CircuitBreaker } from '../utils/circuitBreaker';

const bankIdBreaker = new CircuitBreaker({
  name: 'BankID',
  failureThreshold: 3,
  recoveryTimeoutMs: 15_000,
});

export interface BankIdAuthResponse {
  orderRef: string;
  autoStartToken: string;
  qrStartToken: string;
  qrStartSecret: string;
  launchMode?: 'bankid' | 'mock';
  launchUrl?: string;
}

export interface InitiateBankIdAuthOptions {
  personalNumber?: string;
}

interface BankIdCollectRequest {
  orderRef: string;
}

export interface BankIdCollectResponse {
  orderRef: string;
  status: 'pending' | 'failed' | 'complete';
  hintCode?: string;
  completionData?: {
    user: {
      personalNumber: string;
      givenName: string;
      surname: string;
      name: string;
    };
    device: {
      ipAddress: string;
    };
    cert: {
      notBefore: string;
      notAfter: string;
    };
    signature: string;
    ocspResponse: string;
  };
}

type MockBankIdOrder = {
  orderRef: string;
  autoStartToken: string;
  qrStartToken: string;
  qrStartSecret: string;
  endUserIp: string;
  bankidId?: string;
  createdAt: Date;
  status: 'pending' | 'failed' | 'complete';
  hintCode?: string;
  completionData?: BankIdCollectResponse['completionData'];
};

const mockOrders = new Map<string, MockBankIdOrder>();

function buildAgent(): https.Agent {
  const pfxPath = process.env.BANKID_PFX_PATH;
  if (pfxPath) {
    return new https.Agent({
      pfx: fs.readFileSync(pfxPath),
      passphrase: process.env.BANKID_PFX_PASSPHRASE,
      ca: process.env.BANKID_CA_PATH ? fs.readFileSync(process.env.BANKID_CA_PATH) : undefined,
      minVersion: 'TLSv1.2',
    });
  }

  return new https.Agent({
    cert: fs.readFileSync(getEnv('BANKID_CERT_PATH')),
    key: fs.readFileSync(getEnv('BANKID_KEY_PATH')),
    ca: process.env.BANKID_CA_PATH ? fs.readFileSync(process.env.BANKID_CA_PATH) : undefined,
    minVersion: 'TLSv1.2',
  });
}

function postBankId<TRequest extends object, TResponse>(path: string, payload: TRequest): Promise<TResponse> {
  return bankIdBreaker.execute(() => {
    assertBankIdEnv();
    const baseUrl = new URL(getEnv('BANKID_BASE_URL'));
    const body = JSON.stringify(payload);
    const agent = buildAgent();

    return new Promise((resolve, reject) => {
      const req = https.request(
        {
          protocol: baseUrl.protocol,
          hostname: baseUrl.hostname,
          port: baseUrl.port || 443,
          path: `${baseUrl.pathname.replace(/\/$/, '')}${path}`,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body),
          },
          agent,
          timeout: 10_000,
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
          res.on('end', () => {
            const text = Buffer.concat(chunks).toString('utf8');
            if (!res.statusCode || res.statusCode >= 400) {
              reject(new Error(`BankID request failed (${res.statusCode}): ${text}`));
              return;
            }
            try {
              resolve(JSON.parse(text) as TResponse);
            } catch {
              reject(new Error('Invalid JSON response from BankID'));
            }
          });
        },
      );

      req.on('timeout', () => req.destroy(new Error('BankID request timeout')));
      req.on('error', reject);
      req.write(body);
      req.end();
    });
  });
}

function buildMockLaunchUrl(orderRef: string): string {
  const base = String(process.env.BANKID_MOCK_LAUNCH_BASE_URL || '').trim();
  if (base) {
    return `${base.replace(/\/$/, '')}/api/auth/bankid/mock/launch/${encodeURIComponent(orderRef)}`;
  }

  return `/api/auth/bankid/mock/launch/${encodeURIComponent(orderRef)}`;
}

function buildMockCompletionData(bankidId: string, endUserIp: string) {
  const now = new Date();
  const givenName = process.env.BANKID_MOCK_GIVEN_NAME || 'Mock';
  const surname = process.env.BANKID_MOCK_SURNAME || 'User';
  return {
    user: {
      personalNumber: bankidId,
      givenName,
      surname,
      name: `${givenName} ${surname}`.trim(),
    },
    device: {
      ipAddress: endUserIp,
    },
    cert: {
      notBefore: now.toISOString(),
      notAfter: new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000).toISOString(),
    },
    signature: `mock-signature-${bankidId}-${crypto.randomUUID()}`,
    ocspResponse: 'mock-ocsp-response',
  } satisfies NonNullable<BankIdCollectResponse['completionData']>;
}

function createMockOrder(endUserIp: string, bankidId?: string): MockBankIdOrder {
  const orderRef = `mock-order-${crypto.randomUUID()}`;
  return {
    orderRef,
    autoStartToken: `mock-autostart-${crypto.randomUUID()}`,
    qrStartToken: `mock-qr-start-${crypto.randomUUID()}`,
    qrStartSecret: crypto.randomBytes(32).toString('hex'),
    endUserIp,
    bankidId,
    createdAt: new Date(),
    status: 'pending',
    hintCode: 'outstandingTransaction',
  };
}

function getMockOrder(orderRef: string): MockBankIdOrder {
  const order = mockOrders.get(orderRef);
  if (!order) {
    throw new Error('Mock BankID order not found');
  }
  return order;
}

function shouldAutoCreateMockUsers(): boolean {
  const value = String(process.env.BANKID_MOCK_AUTO_CREATE_USER || '')
    .trim()
    .toLowerCase();
  if (!value) {
    return true;
  }
  return value !== 'false' && value !== '0' && value !== 'no' && value !== 'nej';
}

export function getBankIdMode(): 'real' | 'mock' {
  return isBankIdMockMode() ? 'mock' : 'real';
}

export function normalizeBankIdPersonalNumber(value: unknown): string | undefined {
  const digits = String(value ?? '').replace(/\D/g, '');
  if (!digits) return undefined;
  if (!/^\d{12}$/.test(digits)) {
    throw new Error('Personnummer måste anges med 12 siffror.');
  }
  return digits;
}

/**
 * Initiate BankID Authentication (Login)
 */
export async function initiateBankIdAuth(
  endUserIp: string,
  options: InitiateBankIdAuthOptions = {},
): Promise<BankIdAuthResponse> {
  // Generate security nonce for anti-replay
  const nonce = crypto.randomBytes(32).toString('base64');
  const personalNumber = normalizeBankIdPersonalNumber(options.personalNumber);

  if (isBankIdMockMode()) {
    const order = createMockOrder(endUserIp, personalNumber);
    mockOrders.set(order.orderRef, order);
    await persistentReplayProtection.registerSession(order.orderRef, endUserIp);
    return {
      orderRef: order.orderRef,
      autoStartToken: order.autoStartToken,
      qrStartToken: order.qrStartToken,
      qrStartSecret: order.qrStartSecret,
      launchMode: 'mock',
      launchUrl: buildMockLaunchUrl(order.orderRef),
    };
  }

  const payload = {
    endUserIp,
    ...(personalNumber ? { personalNumber } : {}),
    userNonVisibleData: nonce,
  };
  const response = await postBankId<typeof payload, BankIdAuthResponse>('/auth', payload);
  await persistentReplayProtection.registerSession(response.orderRef, endUserIp);
  return response;
}

/**
 * Initiate BankID Signing
 */
export async function initiateBankIdSign(params: {
  endUserIp: string;
  userVisibleData: string;
  userNonVisibleData?: string;
}): Promise<BankIdAuthResponse> {
  // Generate security nonce
  const nonce = crypto.randomBytes(32).toString('base64');

  if (isBankIdMockMode()) {
    const order = createMockOrder(params.endUserIp);
    mockOrders.set(order.orderRef, order);
    await persistentReplayProtection.registerSession(order.orderRef, params.endUserIp);
    return {
      orderRef: order.orderRef,
      autoStartToken: order.autoStartToken,
      qrStartToken: order.qrStartToken,
      qrStartSecret: order.qrStartSecret,
      launchMode: 'mock',
      launchUrl: buildMockLaunchUrl(order.orderRef),
    };
  }

  const payload = {
    endUserIp: params.endUserIp,
    userVisibleData: Buffer.from(params.userVisibleData).toString('base64'),
    userNonVisibleData: params.userNonVisibleData || nonce,
  };
  const response = await postBankId<typeof payload, BankIdAuthResponse>('/sign', payload);
  await persistentReplayProtection.registerSession(response.orderRef, params.endUserIp);
  return response;
}

/**
 * Internal: Collect BankID result and perform security checks
 */
async function collectBankIdResult(orderRef: string, endUserIp: string): Promise<BankIdCollectResponse> {
  const response = isBankIdMockMode()
    ? ({
        orderRef,
        status: getMockOrder(orderRef).status,
        hintCode: getMockOrder(orderRef).hintCode,
        completionData: getMockOrder(orderRef).completionData,
      } satisfies BankIdCollectResponse)
    : await postBankId<BankIdCollectRequest, BankIdCollectResponse>('/collect', { orderRef });

  if (response.status === 'complete') {
    const bankidId = response.completionData?.user?.personalNumber;
    if (!bankidId) throw new Error('BankID complete response missing personal number');

    // Anti-replay check
    await persistentReplayProtection.validateAndComplete({
      orderRef,
      ipAddress: endUserIp,
      bankidId,
      signature: response.completionData?.signature || `mock-sig-${orderRef}`,
    });
  }

  return response;
}

/**
 * Collect BankID Auth (Login flow)
 */
export async function collectBankIdAuth(orderRef: string, endUserIp: string) {
  const response = await collectBankIdResult(orderRef, endUserIp);

  if (response.status !== 'complete') {
    return {
      status: response.status,
      hintCode: response.hintCode ?? null,
    };
  }

  const bankidId = response.completionData!.user.personalNumber;
  const user = await resolveAuthUser(bankidId);
  const pair = createTokenPair(user);

  return {
    status: 'complete' as const,
    accessToken: pair.accessToken,
    refreshToken: pair.refreshToken,
    user: {
      id: user.id,
      organisationId: user.organisationId,
      role: user.role,
      bankidId,
      displayName: response.completionData!.user.name,
    },
  };
}

/**
 * Collect BankID Sign (Signature flow)
 */
export async function collectBankIdSign(orderRef: string, endUserIp: string) {
  const response = await collectBankIdResult(orderRef, endUserIp);
  return response;
}

export async function cancelBankIdAuth(orderRef: string): Promise<{ cancelled: boolean }> {
  if (isBankIdMockMode()) {
    const order = getMockOrder(orderRef);
    order.status = 'failed';
    order.hintCode = 'userCancel';
    mockOrders.set(orderRef, order);
    await persistentReplayProtection.failSession(orderRef, 'userCancel');
    return { cancelled: true };
  }

  await postBankId<{ orderRef: string }, { message?: string }>('/cancel', { orderRef });
  await persistentReplayProtection.failSession(orderRef, 'userCancel');
  return { cancelled: true };
}

// ... (remaining helper functions stay same)

function qrAuthCode(qrStartSecret: string, elapsedSeconds: number): string {
  return crypto.createHmac('sha256', qrStartSecret).update(String(elapsedSeconds)).digest('hex');
}

export function generateAnimatedQrPayload(input: {
  qrStartToken: string;
  qrStartSecret: string;
  orderTime: Date;
  now?: Date;
}): string {
  const current = input.now ?? new Date();
  const elapsedSeconds = Math.max(0, Math.floor((current.getTime() - input.orderTime.getTime()) / 1000));
  const authCode = qrAuthCode(input.qrStartSecret, elapsedSeconds);
  return `bankid.${input.qrStartToken}.${elapsedSeconds}.${authCode}`;
}

async function resolveAuthUser(bankidId: string) {
  let user = await findAuthUserByBankId(bankidId);
  if (!user && isBankIdMockMode() && shouldAutoCreateMockUsers()) {
    user = await ensureMockAuthUser(bankidId);
  }

  if (!user) {
    throw new Error('Authenticated BankID user is not registered in a permitted organisation');
  }

  return user;
}

export function getMockBankIdOrder(orderRef: string) {
  const order = getMockOrder(orderRef);
  return {
    orderRef: order.orderRef,
    status: order.status,
    hintCode: order.hintCode ?? null,
    createdAt: order.createdAt.toISOString(),
    launchUrl: buildMockLaunchUrl(order.orderRef),
    completionData: order.completionData
      ? {
          user: order.completionData.user,
        }
      : null,
  };
}

export function completeMockBankIdOrder(input: { orderRef: string; bankidId?: string }) {
  const order = getMockOrder(input.orderRef);
  const bankidId = String(
    input.bankidId || order.bankidId || process.env.BANKID_MOCK_DEFAULT_USER || 'mock-bankid-testuser-1',
  ).trim();
  order.status = 'complete';
  order.hintCode = undefined;
  order.completionData = buildMockCompletionData(bankidId, order.endUserIp);
  mockOrders.set(order.orderRef, order);
  return getMockBankIdOrder(order.orderRef);
}

export function failMockBankIdOrder(input: { orderRef: string; hintCode?: string }) {
  const order = getMockOrder(input.orderRef);
  order.status = 'failed';
  order.hintCode = input.hintCode || 'userCancel';
  order.completionData = undefined;
  mockOrders.set(order.orderRef, order);
  return getMockBankIdOrder(order.orderRef);
}

export async function refreshSession(
  refreshToken: string,
): Promise<{ accessToken: string; refreshToken: string }> {
  const rotated = await rotateRefreshToken(refreshToken);
  return {
    accessToken: rotated.accessToken,
    refreshToken: rotated.refreshToken,
  };
}
