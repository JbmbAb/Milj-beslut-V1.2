const requiredEnv = ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET', 'LANTMATERIET_BASE_URL'] as const;

export type BankIdConfigurationStatus = {
  mode: 'mock' | 'real' | 'unconfigured';
  canInitiate: boolean;
  hasBaseUrl: boolean;
  hasMtls: boolean;
  hasPfx: boolean;
  hasPemPair: boolean;
  message: string;
};

export function assertSecurityEnv(): void {
  const missing = requiredEnv.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(`Missing required security env variables: ${missing.join(', ')}`);
  }

  if (!isLantmaterietOpenMode() && !hasLantmaterietAuth()) {
    throw new Error(
      'Lantmäteriet autentisering saknas. Ange ett av alternativen: ' +
        'LANTMATERIET_CONSUMER_KEY+LANTMATERIET_CONSUMER_SECRET (OAuth2), ' +
        'LANTMATERIET_ACCESS_TOKEN (direkttoken), ' +
        'eller LANTMATERIET_API_KEY (legacy). ' +
        'Sätt LANTMATERIET_OPEN_MODE=true för öppet kartläge utan autentisering.',
    );
  }
}

export function getEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing env variable: ${name}`);
  }
  return value;
}

export function assertBankIdEnv(): void {
  const status = getBankIdConfigurationStatus();
  if (status.mode === 'mock') {
    return;
  }

  if (!status.hasMtls) {
    throw new Error('BankID mTLS config missing: set BANKID_PFX_PATH or BANKID_CERT_PATH+BANKID_KEY_PATH');
  }

  if (!status.hasBaseUrl) {
    throw new Error('Missing env variable: BANKID_BASE_URL');
  }
}

export function assertSluEnv(): void {
  if (!process.env.SLU_API_KEY) {
    throw new Error('Missing env variable: SLU_API_KEY');
  }
  if (!process.env.SLU_API_BASE_URL) {
    throw new Error('Missing env variable: SLU_API_BASE_URL');
  }
}

export function isBankIdMockMode(): boolean {
  return (
    String(process.env.BANKID_MOCK_MODE || '')
      .trim()
      .toLowerCase() === 'true'
  );
}

export function getBankIdConfigurationStatus(): BankIdConfigurationStatus {
  const hasBaseUrl = Boolean(String(process.env.BANKID_BASE_URL || '').trim());
  const hasPfx = Boolean(String(process.env.BANKID_PFX_PATH || '').trim());
  const hasPemPair =
    Boolean(String(process.env.BANKID_CERT_PATH || '').trim()) &&
    Boolean(String(process.env.BANKID_KEY_PATH || '').trim());
  const hasMtls = hasPfx || hasPemPair;

  if (isBankIdMockMode()) {
    return {
      mode: 'mock',
      canInitiate: true,
      hasBaseUrl,
      hasMtls,
      hasPfx,
      hasPemPair,
      message: 'BankID körs i utvecklingsläge (mock).',
    };
  }

  if (hasBaseUrl && hasMtls) {
    return {
      mode: 'real',
      canInitiate: true,
      hasBaseUrl,
      hasMtls,
      hasPfx,
      hasPemPair,
      message: 'BankID kan användas.',
    };
  }

  const missingParts: string[] = [];
  if (!hasBaseUrl) {
    missingParts.push('BANKID_BASE_URL');
  }
  if (!hasMtls) {
    missingParts.push('mTLS-certifikat (BANKID_PFX_PATH eller BANKID_CERT_PATH + BANKID_KEY_PATH)');
  }

  return {
    mode: 'unconfigured',
    canInitiate: false,
    hasBaseUrl,
    hasMtls,
    hasPfx,
    hasPemPair,
    message: `BankID är inte aktiverat ännu (saknar ${missingParts.join(' och ')}). Använd administratörsinloggning tills avtal och certifikat är klara.`,
  };
}

export function isLantmaterietOpenMode(): boolean {
  return String(process.env.LANTMATERIET_OPEN_MODE || '').toLowerCase() === 'true';
}

export function hasLantmaterietAuth(): boolean {
  const hasConsumerPair =
    Boolean(String(process.env.LANTMATERIET_CONSUMER_KEY || '').trim()) &&
    Boolean(String(process.env.LANTMATERIET_CONSUMER_SECRET || '').trim());
  const hasDirectToken = Boolean(String(process.env.LANTMATERIET_ACCESS_TOKEN || '').trim());
  const hasApiKey = Boolean(String(process.env.LANTMATERIET_API_KEY || '').trim());
  // Avgiftsfri prenumerationsnyckel från Lantmäteriets API-portal räknas också
  // som giltig auth (räcker för öppna data-produkter som Fastighetsindelning
  // öppen, Belägenhetsadress öppen, topowebb, ortofoto m.fl.).
  const hasOpenSubscription = Boolean(String(process.env.LANTMATERIET_OPEN_SUBSCRIPTION_KEY || '').trim());
  return hasConsumerPair || hasDirectToken || hasApiKey || hasOpenSubscription;
}
