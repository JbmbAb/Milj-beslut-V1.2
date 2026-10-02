import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadEnvFile } from '../../server/loadEnv';

const originalCwd = process.cwd();
const originalEnv = { ...process.env };

afterEach(() => {
  vi.restoreAllMocks();
  process.chdir(originalCwd);
  process.env = { ...originalEnv };
});

// TEST-DB-GUARD (OD-K0-5): this suite runs in a test runtime, where `*.local` env files are never
// read. The parser cases therefore use a non-local fixture name; the parser itself is unchanged.
const FIXTURE = '.env.fixture';

describe('loadEnvFile', () => {
  it('loads only selected prefixes from an env file without overriding existing env', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'load-env-test-'));
    fs.writeFileSync(
      path.join(tempDir, FIXTURE),
      ['BANKID_MOCK_MODE=true', 'PORT=3000', 'BANKID_BASE_URL=https://example.invalid'].join('\n'),
      'utf8',
    );

    process.chdir(tempDir);
    process.env.BANKID_BASE_URL = 'https://already-set.invalid';
    delete process.env.BANKID_MOCK_MODE;
    delete process.env.PORT;

    loadEnvFile(FIXTURE, { includePrefixes: ['BANKID_'] });

    expect(process.env.BANKID_MOCK_MODE).toBe('true');
    expect(process.env.BANKID_BASE_URL).toBe('https://already-set.invalid');
    expect(process.env.PORT).toBeUndefined();
  });

  it('unescapes literal \\n sequences to real newlines (flattened multi-line PEM values)', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'load-env-test-'));
    const flattenedPem = '-----BEGIN PUBLIC KEY-----\\nMCowBQYDK2VwAyEAKxgC+VpYER0=\\n-----END PUBLIC KEY-----';
    fs.writeFileSync(
      path.join(tempDir, FIXTURE),
      [`SOME_PUBLIC_KEY_PEM=${flattenedPem}`, 'PLAIN_VALUE=no-backslash-n-here'].join('\n'),
      'utf8',
    );

    process.chdir(tempDir);
    delete process.env.SOME_PUBLIC_KEY_PEM;
    delete process.env.PLAIN_VALUE;

    loadEnvFile(FIXTURE);

    expect(process.env.SOME_PUBLIC_KEY_PEM).toBe(
      '-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAKxgC+VpYER0=\n-----END PUBLIC KEY-----',
    );
    expect(process.env.PLAIN_VALUE).toBe('no-backslash-n-here');
  });
});

describe('loadEnvFile in a test runtime (TEST-DB-GUARD, OD-K0-5)', () => {
  const FAKE_URL = 'postgresql://wtdg-fabricated:x@wtdg-fabricated.invalid:1/wtdg_fabricated_db';
  const tempDirs: string[] = [];
  const makeTempDir = () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wtdg-load-env-'));
    tempDirs.push(dir);
    return dir;
  };

  afterEach(() => {
    process.chdir(originalCwd);
    for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  });

  it.each([['.env.local'], ['.env.development.local'], ['.env.test.local']])(
    'never opens %s (the file is not even read)',
    (fileName) => {
      const tempDir = makeTempDir();
      fs.writeFileSync(path.join(tempDir, fileName), `WTDG_LOCAL_SENTINEL=loaded\nDATABASE_URL=${FAKE_URL}\n`);
      process.chdir(tempDir);
      delete process.env.WTDG_LOCAL_SENTINEL;
      delete process.env.DATABASE_URL;
      const readSpy = vi.spyOn(fs, 'readFileSync');

      loadEnvFile(fileName, { overrideExisting: true });

      expect(process.env.WTDG_LOCAL_SENTINEL).toBeUndefined();
      expect(process.env.DATABASE_URL).toBeUndefined();
      expect(readSpy.mock.calls.some(([p]) => String(p).endsWith(fileName))).toBe(false);
    },
  );

  it('takes no database setting and no opt-in from another env file, but loads its other keys', () => {
    const tempDir = makeTempDir();
    fs.writeFileSync(
      path.join(tempDir, '.env'),
      [
        `DATABASE_URL=${FAKE_URL}`,
        `TEST_DATABASE_URL=${FAKE_URL}`,
        'PGHOST=wtdg-fabricated.invalid',
        `SOME_CUSTOM_CONNECTION=${FAKE_URL}`,
        'MIMER_TEST_DB_ALLOW=wtdg_fabricated_test',
        'WTDG_PLAIN=kept',
      ].join('\n'),
    );
    process.chdir(tempDir);
    process.env.DATABASE_URL = 'postgresql://x:x@127.0.0.1:1/none';
    for (const key of ['TEST_DATABASE_URL', 'PGHOST', 'SOME_CUSTOM_CONNECTION', 'MIMER_TEST_DB_ALLOW', 'WTDG_PLAIN']) {
      delete process.env[key];
    }

    loadEnvFile('.env', { overrideExisting: true });

    expect(process.env.DATABASE_URL).toBe('postgresql://x:x@127.0.0.1:1/none');
    expect(process.env.TEST_DATABASE_URL).toBeUndefined();
    expect(process.env.PGHOST).toBeUndefined();
    expect(process.env.SOME_CUSTOM_CONNECTION).toBeUndefined();
    expect(process.env.MIMER_TEST_DB_ALLOW).toBeUndefined();
    expect(process.env.WTDG_PLAIN).toBe('kept');
  });
});
