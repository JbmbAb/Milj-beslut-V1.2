import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadEnvFile } from '../../server/loadEnv';

const originalCwd = process.cwd();
const originalEnv = { ...process.env };

afterEach(() => {
  process.chdir(originalCwd);
  process.env = { ...originalEnv };
});

describe('loadEnvFile', () => {
  it('loads only selected prefixes from .env.local without overriding existing env', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'load-env-test-'));
    fs.writeFileSync(
      path.join(tempDir, '.env.local'),
      ['BANKID_MOCK_MODE=true', 'PORT=3000', 'BANKID_BASE_URL=https://example.invalid'].join('\n'),
      'utf8',
    );

    process.chdir(tempDir);
    process.env.BANKID_BASE_URL = 'https://already-set.invalid';
    delete process.env.BANKID_MOCK_MODE;
    delete process.env.PORT;

    loadEnvFile('.env.local', { includePrefixes: ['BANKID_'] });

    expect(process.env.BANKID_MOCK_MODE).toBe('true');
    expect(process.env.BANKID_BASE_URL).toBe('https://already-set.invalid');
    expect(process.env.PORT).toBeUndefined();
  });

  it('unescapes literal \\n sequences to real newlines (flattened multi-line PEM values)', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'load-env-test-'));
    const flattenedPem =
      '-----BEGIN PUBLIC KEY-----\\nMCowBQYDK2VwAyEAKxgC+VpYER0=\\n-----END PUBLIC KEY-----';
    fs.writeFileSync(
      path.join(tempDir, '.env.local'),
      [`SOME_PUBLIC_KEY_PEM=${flattenedPem}`, 'PLAIN_VALUE=no-backslash-n-here'].join('\n'),
      'utf8',
    );

    process.chdir(tempDir);
    delete process.env.SOME_PUBLIC_KEY_PEM;
    delete process.env.PLAIN_VALUE;

    loadEnvFile('.env.local');

    expect(process.env.SOME_PUBLIC_KEY_PEM).toBe(
      '-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAKxgC+VpYER0=\n-----END PUBLIC KEY-----',
    );
    expect(process.env.PLAIN_VALUE).toBe('no-backslash-n-here');
  });
});

describe('loadEnvFirst', () => {
  it('preserves provider-injected DATABASE_URL in production', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'load-env-first-test-'));
    fs.writeFileSync(
      path.join(tempDir, '.env.local'),
      'DATABASE_URL=postgresql://local:pw@localhost:5432/local\n',
      'utf8',
    );

    process.chdir(tempDir);
    process.env.NODE_ENV = 'production';
    process.env.DATABASE_URL = 'postgresql://runtime:pw@db:5432/runtime';

    vi.resetModules();
    await import('../../server/loadEnvFirst');

    expect(process.env.DATABASE_URL).toBe('postgresql://runtime:pw@db:5432/runtime');
  });
});
