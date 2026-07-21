/**
 * AUTH DOMAIN
 * Hanterar autentisering, identitet och BankID-integration.
 */

export interface AuthUser {
  id: string;
  role: string;
  organisationId: string;
  bankidId?: string;
  displayName?: string;
}

export interface BankIdAuthResponse {
  orderRef: string;
  autoStartToken: string;
  qrStartToken: string;
  qrStartSecret: string;
  launchMode?: 'bankid' | 'mock';
  launchUrl?: string;
}

export interface BankIdInitiateOptions {
  personalNumber?: string;
  userNonVisibleData?: string;
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

export interface IBankIdProvider {
  initiateAuth(endUserIp: string, options?: BankIdInitiateOptions): Promise<BankIdAuthResponse>;
  collectAuth(orderRef: string): Promise<BankIdCollectResponse>;
  cancelAuth(orderRef: string): Promise<boolean>;
  getMode(): 'real' | 'mock';
}
