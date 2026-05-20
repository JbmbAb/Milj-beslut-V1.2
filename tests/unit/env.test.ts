import { afterEach, describe, expect, it } from 'vitest';
import {
  assertBankIdEnv,
  assertSecurityEnv,
  assertSluEnv,
  getEnv,
  isLantmaterietOpenMode,
} from '../../server/security/env';

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

function setSecurityBaseEnv() {
  process.env.JWT_ACCESS_SECRET = 'test-access';
  process.env.JWT_REFRESH_SECRET = 'test-refresh';
  process.env.LANTMATERIET_BASE_URL = 'https://example.invalid';
}

describe('security env', () => {
  it('returns existing env values and throws for missing keys', () => {
    process.env.TEST_KEY = 'value';
    expect(getEnv('TEST_KEY')).toBe('value');
    delete process.env.TEST_KEY;
    expect(() => getEnv('TEST_KEY')).toThrow(/Missing env variable/);
  });

  it('detects open mode flag', () => {
    process.env.LANTMATERIET_OPEN_MODE = 'true';
    expect(isLantmaterietOpenMode()).toBe(true);

    process.env.LANTMATERIET_OPEN_MODE = 'false';
    expect(isLantmaterietOpenMode()).toBe(false);
  });

  it('validates security env and allows open mode without API key', () => {
    setSecurityBaseEnv();
    process.env.LANTMATERIET_OPEN_MODE = 'true';
    delete process.env.LANTMATERIET_API_KEY;

    expect(() => assertSecurityEnv()).not.toThrow();
  });

  it('requires licensed Lantmateriet credentials when not in open mode', () => {
    setSecurityBaseEnv();
    process.env.LANTMATERIET_OPEN_MODE = 'false';
    delete process.env.LANTMATERIET_API_KEY;
    delete process.env.LANTMATERIET_ACCESS_TOKEN;
    delete process.env.LANTMATERIET_CONSUMER_KEY;
    delete process.env.LANTMATERIET_CONSUMER_SECRET;

    expect(() => assertSecurityEnv()).toThrow(/Lantm.*autentisering saknas/i);

    process.env.LANTMATERIET_API_KEY = 'licensed-key';
    expect(() => assertSecurityEnv()).not.toThrow();

    delete process.env.LANTMATERIET_API_KEY;
    process.env.LANTMATERIET_CONSUMER_KEY = 'consumer-key';
    process.env.LANTMATERIET_CONSUMER_SECRET = 'consumer-secret';
    expect(() => assertSecurityEnv()).not.toThrow();

    delete process.env.LANTMATERIET_CONSUMER_KEY;
    delete process.env.LANTMATERIET_CONSUMER_SECRET;
    process.env.LANTMATERIET_ACCESS_TOKEN = 'short-lived-token';
    expect(() => assertSecurityEnv()).not.toThrow();
  });

  it('requires either BankID PFX or PEM configuration', () => {
    process.env.BANKID_MOCK_MODE = 'false';
    delete process.env.BANKID_PFX_PATH;
    delete process.env.BANKID_CERT_PATH;
    delete process.env.BANKID_KEY_PATH;
    delete process.env.BANKID_BASE_URL;

    expect(() => assertBankIdEnv()).toThrow(/mTLS/);

    process.env.BANKID_PFX_PATH = 'dummy.pfx';
    process.env.BANKID_BASE_URL = 'https://example.invalid';
    expect(() => assertBankIdEnv()).not.toThrow();

    delete process.env.BANKID_PFX_PATH;
    process.env.BANKID_CERT_PATH = 'dummy.crt';
    process.env.BANKID_KEY_PATH = 'dummy.key';
    expect(() => assertBankIdEnv()).not.toThrow();
  });

  it('requires SLU base URL and API key', () => {
    delete process.env.SLU_API_KEY;
    delete process.env.SLU_API_BASE_URL;
    expect(() => assertSluEnv()).toThrow(/SLU_API_KEY/);

    process.env.SLU_API_KEY = 'slu-key';
    expect(() => assertSluEnv()).toThrow(/SLU_API_BASE_URL/);

    process.env.SLU_API_BASE_URL = 'https://example.invalid';
    expect(() => assertSluEnv()).not.toThrow();
  });
});
