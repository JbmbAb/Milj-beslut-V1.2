const requiredEnv = ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET', 'LANTMATERIET_BASE_URL'] as const;

export type BankIdRuntimeMode = 'mock' | 'test' | 'production';

export type BankIdConfigurationStatus = {
  mode: BankIdRuntimeMode | 'unconfigured';
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

const BANKID_TEST_HOST = 'appapi2.test.bankid.com';
// PRODUCT-AUTH-BANKID-TEST-403-RECON-01: proven by direct mTLS request against BankID's
// real test API -- /6.0 returns an edge-level plain-text 403 (never reaches the RP API),
// /rp/v6.0 returns 200 with a real orderRef. Do not change this back to /6.0.
const BANKID_TEST_API_PATH = '/rp/v6.0';

function configuredBankIdMode(): BankIdRuntimeMode {
  const explicit = String(process.env.BANKID_MODE || '').trim().toLowerCase();
  if (!explicit) {
    // Compatibility is intentionally one-way: legacy mock configuration remains a mock,
    // while every non-mock legacy configuration is treated as production.
    return isBankIdMockMode() ? 'mock' : 'production';
  }
  if (explicit === 'mock' || explicit === 'test' || explicit === 'production') {
    return explicit;
  }
  throw new Error(`Invalid BANKID_MODE '${explicit}'; expected mock, test, or production`);
}

function bankIdConfigurationError(): string | null {
  let mode: BankIdRuntimeMode;
  try {
    mode = configuredBankIdMode();
  } catch (error) {
    return error instanceof Error ? error.message : 'Invalid BANKID_MODE';
  }

  const baseUrlValue = String(process.env.BANKID_BASE_URL || '').trim();
  const hasPfx = Boolean(String(process.env.BANKID_PFX_PATH || '').trim());
  const hasPemPair =
    Boolean(String(process.env.BANKID_CERT_PATH || '').trim()) &&
    Boolean(String(process.env.BANKID_KEY_PATH || '').trim());
  const hasMtls = hasPfx || hasPemPair;
  const hasCa = Boolean(String(process.env.BANKID_CA_PATH || '').trim());

  if (mode === 'mock') {
    return baseUrlValue || hasMtls || hasCa
      ? 'BANKID_MODE=mock must not be combined with BankID endpoint or mTLS configuration'
      : null;
  }
  if (!baseUrlValue) return 'Missing env variable: BANKID_BASE_URL';
  if (!hasMtls) return 'BankID mTLS config missing: set BANKID_PFX_PATH or BANKID_CERT_PATH+BANKID_KEY_PATH';
  if (!hasCa) return 'BankID trusted CA config missing: set BANKID_CA_PATH';

  let baseUrl: URL;
  try {
    baseUrl = new URL(baseUrlValue);
  } catch {
    return 'BANKID_BASE_URL must be an absolute HTTPS URL';
  }
  if (baseUrl.protocol !== 'https:') return 'BANKID_BASE_URL must use HTTPS';

  if (mode === 'test') {
    if (baseUrl.hostname !== BANKID_TEST_HOST || baseUrl.pathname.replace(/\/$/, '') !== BANKID_TEST_API_PATH) {
      return `BANKID_MODE=test requires https://${BANKID_TEST_HOST}${BANKID_TEST_API_PATH}`;
    }
  } else if (baseUrl.hostname === BANKID_TEST_HOST) {
    return 'BANKID_MODE=production must not use the BankID test endpoint';
  }

  return null;
}

export function assertBankIdEnv(): void {
  const status = getBankIdConfigurationStatus();
  if (status.mode === 'mock') {
    return;
  }
  if (!status.canInitiate) throw new Error(status.message);
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

export function getBankIdRuntimeMode(): BankIdRuntimeMode {
  return configuredBankIdMode();
}

export function getBankIdConfigurationStatus(): BankIdConfigurationStatus {
  const configurationError = bankIdConfigurationError();
  const hasBaseUrl = Boolean(String(process.env.BANKID_BASE_URL || '').trim());
  const hasPfx = Boolean(String(process.env.BANKID_PFX_PATH || '').trim());
  const hasPemPair =
    Boolean(String(process.env.BANKID_CERT_PATH || '').trim()) &&
    Boolean(String(process.env.BANKID_KEY_PATH || '').trim());
  const hasMtls = hasPfx || hasPemPair;

  let mode: BankIdRuntimeMode;
  try {
    mode = configuredBankIdMode();
  } catch {
    return {
      mode: 'unconfigured',
      canInitiate: false,
      hasBaseUrl,
      hasMtls,
      hasPfx,
      hasPemPair,
      message: configurationError || 'Invalid BankID configuration.',
    };
  }

  if (configurationError) {
    return {
      mode: 'unconfigured',
      canInitiate: false,
      hasBaseUrl,
      hasMtls,
      hasPfx,
      hasPemPair,
      message: `BankID är inte aktiverat ännu: ${configurationError}`,
    };
  }

  if (mode === 'mock') {
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
      mode,
      canInitiate: true,
      hasBaseUrl,
      hasMtls,
      hasPfx,
      hasPemPair,
      message: mode === 'test' ? 'BankID officiella testmiljö kan användas.' : 'BankID kan användas i produktionsläge.',
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
