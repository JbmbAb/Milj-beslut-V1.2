// @vitest-environment node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  assertExternalE2eTargetsAreRemote,
  EXTERNAL_E2E_TARGET_KEYS,
  externalE2eHostRefusal,
  LOCAL_E2E_RESERVED_PORTS,
  nonPublicAddressReason,
  type ExternalHostResolver,
} from '../../server/modules/test-db-guard/localE2eServerPolicy';

/**
 * TEST-DB-GUARD (OD-K0-5), TDG-3 N1: an external E2E target was judged by its host NAME only.
 * `PLAYWRIGHT_BASE_URL=http://localtest.me:8787` (localtest.me resolves to 127.0.0.1) loaded, and
 * the E2E run reached the demonstrator's API server on the live database. Now every external
 * target key is refused on a demonstrator port whatever its host, and its host must resolve --
 * every canonical spelling, every address -- to public addresses only; a failed lookup, an empty
 * and a mixed answer are refused.
 *
 * No real name is ever looked up here: the policy cases get an injected resolver, and the config
 * cases run the REAL playwright.config.ts in a child process whose resolver child inherits a
 * preloaded fake `dns.lookup` (NODE_OPTIONS --import). Names are under the reserved `.example`
 * TLD, so an answer such as 127.0.0.1 can only come from the fake. Nothing is started or contacted.
 */

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CONFIG_URL = pathToFileURL(path.join(REPO_ROOT, 'playwright.config.ts')).href;
const TSX_LOADER_URL = pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href;

const PUBLIC_V4 = '203.0.113.7';
const PUBLIC_V6 = '2001:db8::7';

/** A resolver from a fixed table; records every name it was asked for. */
function fakeResolver(table: Record<string, string[] | null>): ExternalHostResolver & { asked: string[] } {
  const asked: string[] = [];
  const resolve = ((hostname: string) => {
    asked.push(hostname);
    const addresses = table[hostname];
    if (addresses === undefined || addresses === null) return { addresses: null, error: 'ENOTFOUND' };
    return { addresses, error: null };
  }) as ExternalHostResolver & { asked: string[] };
  resolve.asked = asked;
  return resolve;
}

const ownNonInternalAddress = (): string | null => {
  for (const list of Object.values(os.networkInterfaces())) {
    for (const entry of list ?? []) if (!entry.internal) return entry.address;
  }
  return null;
};

describe('policy: an external target is never a demonstrator port, whatever its host', () => {
  const ports = Object.keys(LOCAL_E2E_RESERVED_PORTS).map(Number);

  it.each(EXTERNAL_E2E_TARGET_KEYS.flatMap((key) => ports.map((port) => [key, port] as const)))(
    '%s on port %s is refused before any lookup',
    (key, port) => {
      const resolve = fakeResolver({ 'wtdg3-public.example': [PUBLIC_V4] });
      expect(() =>
        assertExternalE2eTargetsAreRemote({ [key]: `http://wtdg3-public.example:${port}` }, resolve),
      ).toThrow(new RegExp(`TEST-DB-GUARD.*${key} uses port ${port}`));
      expect(resolve.asked).toEqual([]);
    },
  );

  it('the verifier case: localtest.me:8787 is refused (port), also next to a remote base URL', () => {
    const resolve = fakeResolver({});
    expect(() =>
      assertExternalE2eTargetsAreRemote({ PLAYWRIGHT_BASE_URL: 'http://localtest.me:8787' }, resolve),
    ).toThrow(/port 8787/);
    expect(() =>
      assertExternalE2eTargetsAreRemote(
        { PLAYWRIGHT_BASE_URL: `https://${PUBLIC_V4}`, PLAYWRIGHT_API_BASE_URL: 'http://localtest.me:8787' },
        resolve,
      ),
    ).toThrow(/PLAYWRIGHT_API_BASE_URL uses port 8787/);
  });
});

describe('policy: an external host must resolve to public addresses only', () => {
  it.each(EXTERNAL_E2E_TARGET_KEYS)('%s: an alias that resolves to 127.0.0.1 is refused', (key) => {
    const resolve = fakeResolver({ 'localtest.me': ['127.0.0.1'] });
    expect(() => assertExternalE2eTargetsAreRemote({ [key]: 'http://localtest.me:9443' }, resolve)).toThrow(
      new RegExp(`TEST-DB-GUARD.*${key}.*localtest\\.me resolves to 127\\.0\\.0\\.1: .*this workstation`),
    );
    expect(resolve.asked).toEqual(['localtest.me']);
  });

  it.each<[string, string[]]>([
    ['loopback v6', ['::1']],
    ['127/8 beyond .1', ['127.3.4.5']],
    ['IPv4-mapped loopback', ['::ffff:127.0.0.1']],
    ['private 10/8', ['10.1.2.3']],
    ['private 172.16/12', ['172.20.0.2']],
    ['private 192.168/16', ['192.168.1.5']],
    ['IPv4-mapped private', ['::ffff:10.0.0.1']],
    ['shared 100.64/10 (e.g. a tailnet)', ['100.100.1.1']],
    ['link-local v4', ['169.254.1.1']],
    ['unique-local v6', ['fd12:3456::1']],
    ['link-local v6', ['fe80::1']],
    ['unspecified v4', ['0.0.0.0']],
    ['unspecified v6', ['::']],
    ['multicast', ['239.1.2.3']],
    ['not an IP address (unknown answer)', ['wtdg3-garbage']],
    ['mixed: public and loopback', [PUBLIC_V4, '127.0.0.1']],
    ['mixed: public v6 and private v4', [PUBLIC_V6, '192.168.0.10']],
  ])('%s is refused', (_label, addresses) => {
    const resolve = fakeResolver({ 'wtdg3-target.example': addresses });
    const refusal = externalE2eHostRefusal('wtdg3-target.example', resolve);
    expect(refusal).not.toBeNull();
    if (addresses.length > 1) expect(refusal).toMatch(/mixed answer is refused as a whole/);
  });

  it("one of this workstation's own interface addresses is refused", () => {
    const own = ownNonInternalAddress();
    if (own === null) return; // no non-internal interface on this machine: nothing to check
    const resolve = fakeResolver({ 'wtdg3-self.example': [own] });
    expect(externalE2eHostRefusal('wtdg3-self.example', resolve)).toMatch(/this workstation/);
  });

  it('a failed lookup and an empty answer are refused', () => {
    expect(externalE2eHostRefusal('wtdg3-nxdomain.example', fakeResolver({}))).toMatch(
      /lookup of wtdg3-nxdomain\.example failed: ENOTFOUND/,
    );
    expect(
      externalE2eHostRefusal('wtdg3-empty.example', fakeResolver({ 'wtdg3-empty.example': [] })),
    ).toMatch(/returned no address/);
    const broken: ExternalHostResolver = () => ({ addresses: null, error: null });
    expect(externalE2eHostRefusal('wtdg3-broken.example', broken)).toMatch(/failed: no answer/);
  });

  it('IP literals are judged without a lookup; .invalid names are refused without one', () => {
    const resolve = fakeResolver({});
    expect(externalE2eHostRefusal('10.0.0.5', resolve)).toMatch(/private/);
    expect(externalE2eHostRefusal('[fd00::5]', resolve)).toMatch(/unique-local/);
    expect(externalE2eHostRefusal(PUBLIC_V4, resolve)).toBeNull();
    expect(externalE2eHostRefusal('wtdg3-external.invalid', resolve)).toMatch(/\.invalid name/);
    expect(resolve.asked).toEqual([]);
  });

  it('this workstation by name needs no lookup either', () => {
    const resolve = fakeResolver({});
    for (const host of ['localhost', 'foo.localhost', 'kubernetes.docker.internal', os.hostname()]) {
      expect(externalE2eHostRefusal(host, resolve)).toMatch(/this workstation/);
    }
    expect(resolve.asked).toEqual([]);
  });

  it('controls: a name resolving to public addresses only passes, and a non-http URL is refused', () => {
    const resolve = fakeResolver({ 'wtdg3-staging.example': [PUBLIC_V4, PUBLIC_V6] });
    expect(() =>
      assertExternalE2eTargetsAreRemote({ STAGING_URL: 'https://wtdg3-staging.example' }, resolve),
    ).not.toThrow();
    expect(() =>
      assertExternalE2eTargetsAreRemote({ PLAYWRIGHT_BASE_URL: `ftp://${PUBLIC_V4}` }, resolve),
    ).toThrow(/not an http\(s\) URL/);
  });

  it('address classification itself (canonical spellings)', () => {
    expect(nonPublicAddressReason('2130706433')).toMatch(/this workstation/);
    expect(nonPublicAddressReason('::ffff:c0a8:1')).toMatch(/private/);
    expect(nonPublicAddressReason(PUBLIC_V6)).toBeNull();
    expect(nonPublicAddressReason('')).toMatch(/not an IP address/);
  });
});

// ---- the REAL playwright.config.ts, with a fake DNS for every lookup it makes ----------------

let fakeCwd: string;
let tmpRoot: string;
let fakeDnsUrl: string;

beforeAll(() => {
  fakeCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'wtdg3-external-cwd-'));
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wtdg3-external-tmp-'));
  const fakeDns = path.join(tmpRoot, 'wtdg3-fake-dns.mjs');
  fs.writeFileSync(
    fakeDns,
    `import dns from 'node:dns';
const table = JSON.parse(process.env.WTDG3_FAKE_DNS || '{}');
function fakeLookup(hostname, options, callback) {
  if (typeof options === 'function') { callback = options; options = {}; }
  const entries = (table[hostname] || []).map((address) => ({ address, family: address.includes(':') ? 6 : 4 }));
  process.nextTick(() => {
    if (entries.length === 0) {
      const error = new Error('getaddrinfo ENOTFOUND ' + hostname);
      error.code = 'ENOTFOUND';
      callback(error);
    } else if (options && options.all) callback(null, entries);
    else callback(null, entries[0].address, entries[0].family);
  });
}
dns.lookup = fakeLookup;
`,
    'utf8',
  );
  fakeDnsUrl = pathToFileURL(fakeDns).href;
});

afterAll(() => {
  fs.rmSync(fakeCwd, { recursive: true, force: true });
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

const FAKE_DNS_TABLE = {
  'wtdg3-alias.example': ['127.0.0.1'],
  'wtdg3-private.example': ['10.20.30.40'],
  'wtdg3-mixed.example': [PUBLIC_V4, '::1'],
  'wtdg3-public.example': [PUBLIC_V4],
};

type ConfigReport = { ok: boolean; error: string | null; servers: number; testMode: string | null };

function loadConfigInChild(extra: Record<string, string>): ConfigReport {
  const env: NodeJS.ProcessEnv = {};
  for (const key of ['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'windir', 'HOME', 'USERPROFILE']) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  Object.assign(env, {
    TEMP: tmpRoot,
    TMP: tmpRoot,
    TMPDIR: tmpRoot,
    NODE_OPTIONS: `--import=${fakeDnsUrl}`,
    WTDG3_FAKE_DNS: JSON.stringify(FAKE_DNS_TABLE),
    ...extra,
  });
  const code = `
const report = { ok: false, error: null, servers: 0, testMode: null };
try {
  const cfg = (await import(${JSON.stringify(CONFIG_URL)})).default;
  report.ok = true;
  report.servers = Array.isArray(cfg.webServer) ? cfg.webServer.length : cfg.webServer ? 1 : 0;
  report.testMode = process.env.MIMER_TEST_MODE ?? null;
} catch (e) {
  report.error = String(e && e.message);
}
process.stdout.write('WTDG3_RESULT ' + JSON.stringify(report) + String.fromCharCode(10));
process.exit(0);
`;
  const result = spawnSync(
    process.execPath,
    ['--import', TSX_LOADER_URL, '--input-type=module', '-e', code],
    {
      cwd: fakeCwd,
      env,
      encoding: 'utf8',
      timeout: 90_000,
    },
  );
  const line = String(result.stdout ?? '')
    .split(/\r?\n/)
    .find((l) => l.startsWith('WTDG3_RESULT '));
  if (!line) throw new Error(`child produced no result: ${String(result.stderr ?? '').slice(0, 2000)}`);
  return JSON.parse(line.slice('WTDG3_RESULT '.length)) as ConfigReport;
}

describe('playwright.config.ts: every external target is judged by port and by what it resolves to', () => {
  it.each<[string, Record<string, string>, RegExp]>([
    [
      'W14: PLAYWRIGHT_BASE_URL on the demonstrator port',
      { PLAYWRIGHT_BASE_URL: 'http://localtest.me:8787' },
      /PLAYWRIGHT_BASE_URL uses port 8787/,
    ],
    [
      'W16: a remote base URL with PLAYWRIGHT_API_BASE_URL on the demonstrator port',
      { PLAYWRIGHT_BASE_URL: `https://${PUBLIC_V4}`, PLAYWRIGHT_API_BASE_URL: 'http://localtest.me:8787' },
      /PLAYWRIGHT_API_BASE_URL uses port 8787/,
    ],
    [
      'an alias on a free port that resolves here',
      { PLAYWRIGHT_BASE_URL: 'http://wtdg3-alias.example:9443' },
      /resolves to 127\.0\.0\.1: .*this workstation/,
    ],
    [
      'STAGING_URL resolving to a private address',
      { STAGING_URL: 'https://wtdg3-private.example' },
      /10\.20\.30\.40 is a private address/,
    ],
    [
      'STAGING_API_BASE_URL with a mixed answer',
      { STAGING_URL: `https://${PUBLIC_V4}`, STAGING_API_BASE_URL: 'https://wtdg3-mixed.example' },
      /STAGING_API_BASE_URL.*mixed answer/,
    ],
    [
      'a name that does not resolve',
      { PLAYWRIGHT_BASE_URL: 'https://wtdg3-nxdomain.example' },
      /lookup of wtdg3-nxdomain\.example failed/,
    ],
  ])('%s is refused', (_label, env, message) => {
    const r = loadConfigInChild(env);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/TEST-DB-GUARD/);
    expect(r.error).toMatch(message);
  });

  it('a target resolving to public addresses only loads, starts no server and guards its runner', () => {
    const r = loadConfigInChild({ STAGING_URL: 'https://wtdg3-public.example' });
    expect(r).toEqual({ ok: true, error: null, servers: 0, testMode: '1' });
  });
});

describe('the real resolver (no name is looked up: an IP literal only, which getaddrinfo answers locally)', () => {
  it('returns every address it got; a .invalid name never reaches it', async () => {
    const { resolveExternalHostSync } =
      await import('../../server/modules/test-db-guard/localE2eServerPolicy');
    const literal = resolveExternalHostSync(PUBLIC_V4);
    expect(literal).toEqual({ addresses: [PUBLIC_V4], error: null });
    const spy = vi.fn(resolveExternalHostSync);
    expect(externalE2eHostRefusal('wtdg3-external.invalid', spy)).toMatch(/\.invalid/);
    expect(spy).not.toHaveBeenCalled();
  });
});
