import { spawnSync } from 'node:child_process';
import net from 'node:net';

import {
  canonicalHostForms,
  evaluateDatabaseUrl,
  isRemoteManagedDatabaseUrl,
  isWorkstationHost,
  TEST_DATABASE_OPT_IN_ENV,
  TEST_DB_GUARD_LABEL,
  TestDatabaseTargetRefusedError,
} from './testDatabaseTargetPolicy';

/**
 * TEST-DB-GUARD (OD-K0-5) for local Playwright E2E (playwright.config.ts). Pure: reads only the
 * environment it is given, never an env file, never a socket.
 *
 * A local E2E run
 *   - needs an explicitly opted-in disposable database: MIMER_TEST_DB_ALLOW=<db>, <db> ends in
 *     _test and is exactly the database of PLAYWRIGHT_DATABASE_URL / DATABASE_URL, taken from the
 *     process environment only. An explicitly dead target is NOT enough here: the run writes
 *     through its API server, so it either has its own disposable database or it does not run;
 *   - always starts its own fresh API and UI servers (never reuses a running one) on its own ports,
 *     never on a port of the local demonstrator (whose API server runs on the live database);
 *   - hands the server the checked URL together with MIMER_TEST_MODE=1, so the server keeps it and
 *     reads no env file at all (server/loadEnvFirst.ts, server/loadEnv.ts).
 * An external target (PLAYWRIGHT_BASE_URL / STAGING_URL) starts no server, and must not be this
 * workstation: that would reuse a running local server -- e.g. the demonstrator on the live DB.
 * TDG-3 N1: judged by name alone, an alias such as `localtest.me` (which resolves to 127.0.0.1)
 * passed. Every external target is now refused on a demonstrator port whatever its host, and its
 * host must resolve -- every canonical spelling, every address -- to public addresses only.
 */

/** Never 8787: that is the local demonstrator's API server, which runs on the live database. */
export const LOCAL_E2E_DEFAULT_API_PORT = 18787;
export const LOCAL_E2E_DEFAULT_UI_PORT = 3200;

/** Ports a local E2E server must never use: they belong to the running local demonstrator. */
export const LOCAL_E2E_RESERVED_PORTS: Readonly<Record<number, string>> = {
  8787: 'the local demonstrator API server (live database)',
  5173: 'the local demonstrator UI (Vite)',
  3000: "vite.config.ts's default dev server port",
  8877: 'the LU proof-staging app (miljobeslut-lu-proof-app, staging database)',
};

/** The keys that point an E2E run at an already running server (tests/e2e/support.ts). */
export const EXTERNAL_E2E_TARGET_KEYS: readonly string[] = [
  'PLAYWRIGHT_BASE_URL',
  'STAGING_URL',
  'PLAYWRIGHT_API_BASE_URL',
  'STAGING_API_BASE_URL',
];

const VIA = 'playwright.config.ts (local E2E)';

export type LocalE2eServerPlan = {
  readonly apiPort: number;
  readonly uiPort: number;
  /** The checked URL; the API server and the test workers get exactly this one. */
  readonly databaseUrl: string;
  /** The MIMER_TEST_DB_ALLOW value the URL was admitted under. */
  readonly databaseOptIn: string;
};

export class LocalE2eServerRefusedError extends Error {
  readonly code = 'TEST_DB_GUARD_REFUSED';

  constructor(reason: string) {
    super(`${TEST_DB_GUARD_LABEL} refused ${VIA}: ${reason}. No server was started or reused.`);
    this.name = 'LocalE2eServerRefusedError';
  }
}

function trim(value: string | undefined): string {
  return String(value ?? '').trim();
}

function portFrom(env: NodeJS.ProcessEnv, key: string, fallback: number): number {
  const raw = trim(env[key]);
  if (!raw) return fallback;
  if (!/^\d+$/.test(raw) || Number(raw) < 1 || Number(raw) > 65535) {
    throw new LocalE2eServerRefusedError(`${key}=${JSON.stringify(raw)} is not a TCP port`);
  }
  return Number(raw);
}

/** Throws unless a local E2E run may start; returns the ports and the admitted database URL. */
export function resolveLocalE2eServerPlan(env: NodeJS.ProcessEnv): LocalE2eServerPlan {
  const apiPort = portFrom(env, 'PLAYWRIGHT_LOCAL_API_PORT', LOCAL_E2E_DEFAULT_API_PORT);
  const uiPort = portFrom(env, 'PLAYWRIGHT_LOCAL_UI_PORT', LOCAL_E2E_DEFAULT_UI_PORT);
  for (const [key, port] of [
    ['PLAYWRIGHT_LOCAL_API_PORT', apiPort],
    ['PLAYWRIGHT_LOCAL_UI_PORT', uiPort],
  ] as const) {
    const reserved = LOCAL_E2E_RESERVED_PORTS[port];
    if (reserved) {
      throw new LocalE2eServerRefusedError(
        `${key} resolves to port ${port}, which is ${reserved}; a local E2E run always starts its own ` +
          `fresh server on a port of its own (default API ${LOCAL_E2E_DEFAULT_API_PORT}, UI ${LOCAL_E2E_DEFAULT_UI_PORT})`,
      );
    }
  }
  if (apiPort === uiPort) {
    throw new LocalE2eServerRefusedError(`the API and UI servers cannot share port ${apiPort}`);
  }

  const databaseUrl = trim(env.PLAYWRIGHT_DATABASE_URL) || trim(env.DATABASE_URL);
  if (!databaseUrl) {
    throw new TestDatabaseTargetRefusedError(
      VIA,
      'no database',
      'PLAYWRIGHT_DATABASE_URL / DATABASE_URL is not set in the process environment (a local E2E run ' +
        'never takes its database from an env file)',
    );
  }
  if (isRemoteManagedDatabaseUrl(databaseUrl)) {
    throw new TestDatabaseTargetRefusedError(
      VIA,
      'a remote managed database (prisma://)',
      'a local E2E run never uses a remote managed database',
    );
  }
  // Every target the URL can reach (pg, libpq, PG* fallbacks; every spelling of every host).
  const verdict = evaluateDatabaseUrl(databaseUrl, env);
  if (!verdict.allowed) {
    throw new TestDatabaseTargetRefusedError(VIA, verdict.target, verdict.reason);
  }
  if (verdict.basis !== 'explicit-opt-in') {
    throw new TestDatabaseTargetRefusedError(
      VIA,
      verdict.target,
      `${verdict.reason}, but a local E2E run writes through its own API server and needs an opted-in ` +
        `disposable database: set ${TEST_DATABASE_OPT_IN_ENV}=<database> naming a *_test database`,
    );
  }
  return { apiPort, uiPort, databaseUrl, databaseOptIn: trim(env[TEST_DATABASE_OPT_IN_ENV]) };
}

/**
 * What a lookup of an external E2E target's host name returned. One flat shape (this repo compiles
 * without strictNullChecks): `addresses` null means the lookup failed and `error` says why.
 */
export type ExternalHostResolution = {
  readonly addresses: readonly string[] | null;
  readonly error: string | null;
};

/** Resolves a host name synchronously (the Playwright config is evaluated synchronously). */
export type ExternalHostResolver = (hostname: string) => ExternalHostResolution;

export const EXTERNAL_HOST_LOOKUP_TIMEOUT_MS = 5000;

/** The host name goes to the lookup process in its environment, never on its command line. */
const LOOKUP_HOST_ENV = 'MIMER_TEST_DB_GUARD_LOOKUP_HOST';

/**
 * `dns.lookup` (getaddrinfo: the hosts file and DNS, exactly what the browser's and Node's HTTP
 * clients use) with every address, in a child Node process: there is no synchronous lookup.
 */
const LOOKUP_SCRIPT = [
  "const dns = typeof require === 'function' ? require('node:dns') : process.getBuiltinModule('node:dns');",
  `dns.lookup(process.env.${LOOKUP_HOST_ENV}, { all: true, verbatim: true }, (error, entries) => {`,
  '  process.stdout.write(JSON.stringify(error',
  '    ? { error: String(error.code || error.message) }',
  '    : { addresses: entries.map((entry) => entry.address) }));',
  '});',
].join('\n');

/** The real resolver: one `dns.lookup(host, { all: true })` in a child process, time-boxed. */
export function resolveExternalHostSync(hostname: string): ExternalHostResolution {
  const result = spawnSync(process.execPath, ['-e', LOOKUP_SCRIPT], {
    env: { ...process.env, [LOOKUP_HOST_ENV]: hostname },
    encoding: 'utf8',
    timeout: EXTERNAL_HOST_LOOKUP_TIMEOUT_MS,
    windowsHide: true,
  });
  if (result.error) {
    const code = (result.error as { code?: string }).code ?? result.error.message;
    return { addresses: null, error: `the lookup did not complete (${code})` };
  }
  if (result.status !== 0) return { addresses: null, error: `the lookup exited ${String(result.status)}` };
  try {
    const answer = JSON.parse(String(result.stdout ?? '').trim()) as { addresses?: unknown; error?: unknown };
    if (Array.isArray(answer.addresses)) return { addresses: answer.addresses.map(String), error: null };
    return { addresses: null, error: String(answer.error ?? 'no answer') };
  } catch {
    return { addresses: null, error: 'the lookup gave no readable answer' };
  }
}

function nonPublicIpv4(ip: string): string | null {
  const [a, b] = ip.split('.').map(Number);
  if (a === 0) return 'a "this network" address (0.0.0.0/8)';
  if (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) {
    return 'a private address (RFC 1918)';
  }
  if (a === 100 && b >= 64 && b <= 127) return 'a shared/carrier-grade NAT address (100.64.0.0/10)';
  if (a === 127) return 'a loopback address';
  if (a === 169 && b === 254) return 'a link-local address';
  if (a === 198 && (b === 18 || b === 19)) return 'a benchmarking address (198.18.0.0/15)';
  if (a >= 224) return 'a multicast, reserved or broadcast address';
  return null;
}

function nonPublicIpv6(ip: string): string | null {
  if (ip === '::') return 'the unspecified address';
  if (ip === '::1') return 'a loopback address';
  const first = ip.startsWith('::') ? 0 : parseInt(ip.split(':')[0], 16);
  if ((first & 0xfe00) === 0xfc00) return 'a unique-local address (fc00::/7)';
  if ((first & 0xffc0) === 0xfe80) return 'a link-local address (fe80::/10)';
  if ((first & 0xffc0) === 0xfec0) return 'a site-local address (fec0::/10)';
  if ((first & 0xff00) === 0xff00) return 'a multicast address';
  return null;
}

/**
 * Why an address is not a public address an external E2E target may resolve to, or null. Judged in
 * every canonical spelling (canonicalHostForms: an IPv4 embedded in IPv6 is judged as IPv4 too):
 * this workstation (loopback, wildcard, its own interface addresses), private, shared, link-local,
 * site/unique-local, multicast, reserved -- and anything that is not an IP address at all.
 */
export function nonPublicAddressReason(address: string): string | null {
  const forms = canonicalHostForms(address);
  const ips = forms.filter((form) => net.isIP(form) !== 0);
  if (ips.length === 0) return `${JSON.stringify(address)} is not an IP address`;
  if (isWorkstationHost(address)) return `${address} is this workstation`;
  for (const ip of ips) {
    const reason = net.isIPv4(ip) ? nonPublicIpv4(ip) : nonPublicIpv6(ip);
    if (reason) return `${address} is ${reason}`;
  }
  return null;
}

/**
 * Why an external E2E target's host is refused, or null. This workstation by name; an IP literal
 * by what it is; a reserved `.invalid` name (never resolves) outright; any other name by EVERY
 * address that EVERY canonical spelling of it resolves to -- a failed lookup, an empty answer and
 * an answer that mixes public with non-public addresses are all refused.
 */
export function externalE2eHostRefusal(
  hostname: string,
  resolveHost: ExternalHostResolver = resolveExternalHostSync,
): string | null {
  if (isWorkstationHost(hostname)) return `${hostname} is this workstation`;
  const forms = canonicalHostForms(hostname);
  if (forms.some((form) => net.isIP(form) !== 0)) return nonPublicAddressReason(hostname);
  if (forms.every((form) => form === 'invalid' || form.endsWith('.invalid'))) {
    return `${hostname} is a reserved .invalid name, which never resolves`;
  }
  const answers: string[] = [];
  for (const name of forms) {
    const resolution = resolveHost(name);
    if (!resolution || resolution.addresses === null || resolution.addresses === undefined) {
      return `the lookup of ${name} failed: ${String(resolution?.error ?? 'no answer')}`;
    }
    if (resolution.addresses.length === 0) return `the lookup of ${name} returned no address`;
    answers.push(...resolution.addresses.map(String));
  }
  const distinct = [...new Set(answers)];
  const refusals = distinct
    .map((address) => nonPublicAddressReason(address))
    .filter((reason): reason is string => reason !== null);
  if (refusals.length === 0) return null;
  const mixed = refusals.length < distinct.length ? ' (a mixed answer is refused as a whole)' : '';
  return `${hostname} resolves to ${distinct.join(', ')}: ${refusals.join('; ')}${mixed}`;
}

function defaultPortOf(url: URL): number {
  if (url.port) return Number(url.port);
  return url.protocol === 'https:' ? 443 : 80;
}

/**
 * Throws when an external E2E target could reach this workstation (a running local server such as
 * the demonstrator on the live database): applied to every external target key. Refused are a
 * workstation host in any spelling, every demonstrator port whatever the host, a non-HTTP URL, and
 * a host that does not resolve to public addresses only (see externalE2eHostRefusal).
 */
export function assertExternalE2eTargetsAreRemote(
  env: NodeJS.ProcessEnv,
  resolveHost: ExternalHostResolver = resolveExternalHostSync,
): void {
  for (const key of EXTERNAL_E2E_TARGET_KEYS) {
    const value = trim(env[key]);
    if (!value) continue;
    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      throw new LocalE2eServerRefusedError(`${key} is not a URL`);
    }
    if (isWorkstationHost(parsed.hostname)) {
      throw new LocalE2eServerRefusedError(
        `${key} points at this workstation (${parsed.host}); an external E2E target would reuse a ` +
          `running local server such as the demonstrator on the live database. Unset it: the local ` +
          `E2E harness starts its own fresh servers on an opted-in *_test database`,
      );
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new LocalE2eServerRefusedError(`${key} is not an http(s) URL (${parsed.protocol})`);
    }
    const port = defaultPortOf(parsed);
    const reserved = LOCAL_E2E_RESERVED_PORTS[port];
    if (reserved) {
      throw new LocalE2eServerRefusedError(
        `${key} uses port ${port}, which is ${reserved}; an external E2E target is never a ` +
          `demonstrator port, whatever its host name says`,
      );
    }
    const refusal = externalE2eHostRefusal(parsed.hostname, resolveHost);
    if (refusal) {
      throw new LocalE2eServerRefusedError(
        `${key} (${parsed.host}) may reach this workstation or a private network: ${refusal}. An ` +
          `external E2E target must resolve to public addresses only`,
      );
    }
  }
}
