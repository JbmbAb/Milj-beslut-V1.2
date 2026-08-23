import { Request } from 'express';
import os from 'node:os';

/**
 * PRODUCT-AUTH-BANKID-CLIENT-10035-RESOLUTION-01.
 *
 * Root cause of the 10035 desktop-client failure was proven live: BankID's real test API
 * accepts an /auth order with endUserIp=127.0.0.1 (200, real orderRef), but the desktop
 * client fails deterministically, sub-second, the moment it actually engages that order --
 * while the identical flow with a real, non-loopback endUserIp reached genuine userSign.
 * BankID's own guidance is to never present a loopback address as the end user's IP.
 *
 * req.ip (with `trust proxy` correctly set) is the right value whenever it is a genuine,
 * routable client address. But this app's own dev/local topology (browser and server both
 * on localhost) makes req.ip resolve to loopback even with a fully correct proxy chain --
 * that is not a proxy misconfiguration, it is just true. Silently sending that literal
 * loopback string to BankID is what produced 10035, so the loopback case gets a dynamic,
 * non-hardcoded fallback instead: the server's own first non-internal IPv4 interface
 * address, resolved fresh per call, never a fixed string.
 */

function isLoopbackOrUnspecified(ip: string): boolean {
  const normalized = ip.replace(/^::ffff:/, '');
  return (
    normalized === '127.0.0.1' ||
    normalized === '::1' ||
    normalized === '0.0.0.0' ||
    normalized === '::' ||
    normalized.startsWith('127.')
  );
}

function firstNonInternalIPv4(): string | null {
  const interfaces = os.networkInterfaces();
  for (const entries of Object.values(interfaces)) {
    for (const entry of entries ?? []) {
      if (entry.family === 'IPv4' && !entry.internal) {
        return entry.address;
      }
    }
  }
  return null;
}

export function resolveEndUserIp(req: Request): string {
  const candidate = String(req.ip || '').trim();
  if (candidate && !isLoopbackOrUnspecified(candidate)) {
    return candidate;
  }
  return firstNonInternalIPv4() ?? candidate ?? '0.0.0.0';
}
