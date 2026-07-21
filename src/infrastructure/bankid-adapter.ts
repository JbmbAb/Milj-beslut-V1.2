import https from 'node:https';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { IBankIdProvider, BankIdAuthResponse, BankIdCollectResponse, BankIdInitiateOptions } from '../domain/auth';
import { isBankIdMockMode, getEnv, assertBankIdEnv } from '../../server/security/env';

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

export class BankIdAdapter implements IBankIdProvider {
  private mockOrders = new Map<string, MockBankIdOrder>();

  getMode(): 'real' | 'mock' {
    return isBankIdMockMode() ? 'mock' : 'real';
  }

  async initiateAuth(endUserIp: string, options: BankIdInitiateOptions = {}): Promise<BankIdAuthResponse> {
    if (this.getMode() === 'mock') {
      return this.createMockOrder(endUserIp, options.personalNumber);
    }

    const payload = {
      endUserIp,
      ...(options.personalNumber ? { personalNumber: options.personalNumber } : {}),
      userNonVisibleData: options.userNonVisibleData, // Add nonce here
      requirement: {
        returnUrl: 'https://miljobeslut.se/auth/callback',
      },
    };

    return await this.postBankId<typeof payload, BankIdAuthResponse>('/auth', payload);
  }

  async collectAuth(orderRef: string): Promise<BankIdCollectResponse> {
    if (this.getMode() === 'mock') {
      const order = this.mockOrders.get(orderRef);
      if (!order) throw new Error('Mock BankID order not found');

      return {
        orderRef: order.orderRef,
        status: order.status,
        hintCode: order.hintCode,
        completionData: order.completionData,
      };
    }

    return await this.postBankId<{ orderRef: string }, BankIdCollectResponse>('/collect', { orderRef });
  }

  async cancelAuth(orderRef: string): Promise<boolean> {
    if (this.getMode() === 'mock') {
      const order = this.mockOrders.get(orderRef);
      if (order) {
        order.status = 'failed';
        order.hintCode = 'userCancel';
        return true;
      }
      return false;
    }

    await this.postBankId<{ orderRef: string }, { message?: string }>('/cancel', { orderRef });
    return true;
  }

  // ─── INTERNAL: Real BankID ──────────────────────────────────────────────────

  private buildAgent(): https.Agent {
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

  private postBankId<TRequest extends object, TResponse>(
    path: string,
    payload: TRequest,
  ): Promise<TResponse> {
    assertBankIdEnv();
    const baseUrl = new URL(getEnv('BANKID_BASE_URL'));
    const body = JSON.stringify(payload);
    const agent = this.buildAgent();

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
  }

  // ─── INTERNAL: Mock BankID ──────────────────────────────────────────────────

  private createMockOrder(endUserIp: string, bankidId?: string): BankIdAuthResponse {
    const orderRef = crypto.randomUUID();
    const autoStartToken = crypto.randomUUID();
    const qrStartToken = crypto.randomUUID();
    const qrStartSecret = crypto.randomBytes(32).toString('base64');

    this.mockOrders.set(orderRef, {
      orderRef,
      autoStartToken,
      qrStartToken,
      qrStartSecret,
      endUserIp,
      bankidId,
      createdAt: new Date(),
      status: 'pending',
      hintCode: 'outstandingTransaction',
    });

    return {
      orderRef,
      autoStartToken,
      qrStartToken,
      qrStartSecret,
      launchMode: 'mock',
      launchUrl: this.buildMockLaunchUrl(orderRef),
    };
  }

  private buildMockLaunchUrl(orderRef: string): string {
    const base = String(process.env.BANKID_MOCK_LAUNCH_BASE_URL || '').trim();
    if (base) {
      return `${base.replace(/\/$/, '')}/api/auth/bankid/mock/launch/${encodeURIComponent(orderRef)}`;
    }
    return `/api/auth/bankid/mock/launch/${encodeURIComponent(orderRef)}`;
  }

  // Method to complete mock order from test endpoint
  public completeMockOrder(orderRef: string, bankidId: string) {
    const order = this.mockOrders.get(orderRef);
    if (order) {
      const resolvedBankidId = bankidId || order.bankidId || 'mock-bankid-testuser-1';
      order.status = 'complete';
      order.completionData = {
        user: {
          personalNumber: resolvedBankidId,
          givenName: 'Mock',
          surname: 'User',
          name: 'Mock User',
        },
        device: { ipAddress: order.endUserIp },
        cert: {
          notBefore: new Date().toISOString(),
          notAfter: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
        },
        signature: `mock-signature-${resolvedBankidId}`,
        ocspResponse: 'mock-ocsp',
      };
    }
  }
}
