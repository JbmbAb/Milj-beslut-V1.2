import { afterEach, describe, expect, it } from 'vitest';
import { getBankIdConfigurationStatus, getBankIdRuntimeMode } from '../../server/security/env';

const keys = [
  'BANKID_MODE',
  'BANKID_MOCK_MODE',
  'BANKID_BASE_URL',
  'BANKID_PFX_PATH',
  'BANKID_CERT_PATH',
  'BANKID_KEY_PATH',
  'BANKID_CA_PATH',
] as const;
const original = Object.fromEntries(keys.map((key) => [key, process.env[key]]));

function clearBankIdEnv() {
  for (const key of keys) delete process.env[key];
}

afterEach(() => {
  clearBankIdEnv();
  for (const key of keys) {
    const value = original[key];
    if (value !== undefined) process.env[key] = value;
  }
});

describe('BankID official environment modes', () => {
  it('accepts only the official test RP API endpoint with mTLS and explicit CA trust', () => {
    clearBankIdEnv();
    process.env.BANKID_MODE = 'test';
    process.env.BANKID_BASE_URL = 'https://appapi2.test.bankid.com/rp/v6.0';
    process.env.BANKID_PFX_PATH = 'C:\\secrets\\bankid-test.p12';
    process.env.BANKID_CA_PATH = 'C:\\secrets\\bankid-test-ca.pem';

    expect(getBankIdRuntimeMode()).toBe('test');
    expect(getBankIdConfigurationStatus()).toMatchObject({ mode: 'test', canInitiate: true });
  });

  it('regression: PRODUCT-AUTH-BANKID-TEST-403-RECON-01 -- /6.0 must never again be accepted as the test endpoint', () => {
    // Proven root cause: /6.0 is an edge-level path that returns a plain-text 403 before
    // ever reaching BankID's real RP API; the actual test endpoint is /rp/v6.0. This test
    // guards against BANKID_TEST_API_PATH silently reverting to the wrong, previously-live value.
    clearBankIdEnv();
    process.env.BANKID_MODE = 'test';
    process.env.BANKID_BASE_URL = 'https://appapi2.test.bankid.com/6.0';
    process.env.BANKID_PFX_PATH = 'C:\\secrets\\bankid-test.p12';
    process.env.BANKID_CA_PATH = 'C:\\secrets\\bankid-test-ca.pem';

    expect(getBankIdConfigurationStatus()).toMatchObject({ mode: 'unconfigured', canInitiate: false });
  });

  it('fails closed for test mode with a production endpoint, absent CA, or absent client certificate', () => {
    clearBankIdEnv();
    process.env.BANKID_MODE = 'test';
    process.env.BANKID_BASE_URL = 'https://appapi2.bankid.com/6.0';
    process.env.BANKID_PFX_PATH = 'C:\\secrets\\bankid-test.p12';
    process.env.BANKID_CA_PATH = 'C:\\secrets\\bankid-test-ca.pem';
    expect(getBankIdConfigurationStatus()).toMatchObject({ mode: 'unconfigured', canInitiate: false });

    process.env.BANKID_BASE_URL = 'https://appapi2.test.bankid.com/rp/v6.0';
    delete process.env.BANKID_CA_PATH;
    expect(getBankIdConfigurationStatus()).toMatchObject({ mode: 'unconfigured', canInitiate: false });

    process.env.BANKID_CA_PATH = 'C:\\secrets\\bankid-test-ca.pem';
    delete process.env.BANKID_PFX_PATH;
    expect(getBankIdConfigurationStatus()).toMatchObject({ mode: 'unconfigured', canInitiate: false });
  });

  it('rejects the test endpoint in production and any external BankID configuration in mock mode', () => {
    clearBankIdEnv();
    process.env.BANKID_MODE = 'production';
    process.env.BANKID_BASE_URL = 'https://appapi2.test.bankid.com/rp/v6.0';
    process.env.BANKID_PFX_PATH = 'C:\\secrets\\bankid-production.p12';
    process.env.BANKID_CA_PATH = 'C:\\secrets\\bankid-production-ca.pem';
    expect(getBankIdConfigurationStatus()).toMatchObject({ mode: 'unconfigured', canInitiate: false });

    clearBankIdEnv();
    process.env.BANKID_MODE = 'mock';
    process.env.BANKID_BASE_URL = 'https://appapi2.test.bankid.com/rp/v6.0';
    expect(getBankIdConfigurationStatus()).toMatchObject({ mode: 'unconfigured', canInitiate: false });
  });
});
