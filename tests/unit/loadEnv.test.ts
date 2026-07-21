import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
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
});
