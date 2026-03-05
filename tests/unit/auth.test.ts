import { describe, expect, it } from 'vitest';
import { createTokenPair, getUserFromAccessToken, rotateRefreshToken } from '../../server/security/auth';

describe('auth', () => {
  const user = {
    id: 'user-1',
    organisationId: 'org-1',
    bankidId: 'bankid-1',
    role: 'ADMIN' as const,
  };

  it('creates valid access and refresh tokens', () => {
    const tokens = createTokenPair(user);

    const decoded = getUserFromAccessToken(tokens.accessToken);
    expect(decoded.id).toBe(user.id);
    expect(decoded.organisationId).toBe(user.organisationId);
    expect(tokens.refreshToken.length).toBeGreaterThan(20);
  });

  it('rejects tampered access token', () => {
    const tokens = createTokenPair(user);
    const tampered = `${tokens.accessToken}tamper`;

    expect(() => getUserFromAccessToken(tampered)).toThrow();
  });

  it('rejects refresh token when used as access token', () => {
    const tokens = createTokenPair(user);
    expect(() => getUserFromAccessToken(tokens.refreshToken)).toThrow();
  });

  it('rejects malformed tokens', () => {
    expect(() => getUserFromAccessToken('malformed-token')).toThrow(/Malformed token/);
  });

  it('rotates refresh token and detects reuse', () => {
    const tokens = createTokenPair(user);

    const rotated = rotateRefreshToken(tokens.refreshToken);
    expect(rotated.accessToken.length).toBeGreaterThan(20);

    expect(() => rotateRefreshToken(tokens.refreshToken)).toThrow(/reuse/i);
  });
});
