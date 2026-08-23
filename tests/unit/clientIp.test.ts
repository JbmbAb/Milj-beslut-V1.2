import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { resolveEndUserIp } from '../../server/security/clientIp';

function buildApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.get('/whoami', (req, res) => {
    res.json({ resolved: resolveEndUserIp(req) });
  });
  return app;
}

describe('resolveEndUserIp', () => {
  it('uses a genuine, non-loopback forwarded client IP as-is', async () => {
    const app = buildApp();
    const res = await request(app).get('/whoami').set('X-Forwarded-For', '203.0.113.42');

    expect(res.body.resolved).toBe('203.0.113.42');
  });

  it('never returns the literal loopback address -- this is what caused BankID message code 10035', async () => {
    const app = buildApp();
    const res = await request(app).get('/whoami').set('X-Forwarded-For', '127.0.0.1');

    expect(res.body.resolved).not.toBe('127.0.0.1');
    expect(res.body.resolved).not.toBe('::1');
  });

  it('falls back to a dynamically-resolved address, not a hardcoded literal, when no proxy header is present', async () => {
    const app = buildApp();
    const res = await request(app).get('/whoami');

    // With trust proxy=1 and no X-Forwarded-For, supertest's direct connection resolves to
    // loopback; the fallback must not be the literal '127.0.0.1' BankID rejects.
    expect(res.body.resolved).not.toBe('127.0.0.1');
    expect(typeof res.body.resolved).toBe('string');
    expect(res.body.resolved.length).toBeGreaterThan(0);
  });

  it('does not trust a second, client-injected hop beyond the configured trusted proxy count', async () => {
    const app = buildApp();
    // A malicious client sending its own forged entry ahead of the real proxy's appended
    // entry must not have the forged value win -- trust proxy=1 means only the entry closest
    // to the server (the last one, added by the actual trusted proxy) is honored.
    const res = await request(app)
      .get('/whoami')
      .set('X-Forwarded-For', '198.51.100.9, 203.0.113.42');

    expect(res.body.resolved).toBe('203.0.113.42');
    expect(res.body.resolved).not.toBe('198.51.100.9');
  });
});
