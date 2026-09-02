import { Buffer } from 'node:buffer';
import { createPublicKey, verify as verifyBytes } from 'node:crypto';

import { sha256, validateTrustPolicy } from './trusted-attestation.mjs';

export const GITHUB_OIDC_ISSUER = 'https://token.actions.githubusercontent.com';
export const GITHUB_OIDC_JWKS = `${GITHUB_OIDC_ISSUER}/.well-known/jwks`;
export const DEVGOV_GATE_AUDIENCE = 'devgov-v0-gate';
export const PINNED_VERIFIER_AUTHORITY = Object.freeze({
  type: 'github-oidc-protected-environment',
  repository: 'JbmbAb/Milj-beslut-V1.2',
  workflow_ref: 'JbmbAb/Milj-beslut-V1.2/.github/workflows/devgov-v0-gate.yml@refs/heads/main',
  ref: 'refs/heads/main',
  environment: 'devgov-attestation',
  runner_environment: 'github-hosted',
});

export function trustPolicyAudience(rawPolicy, candidateSha) {
  return `${DEVGOV_GATE_AUDIENCE}:${sha256(rawPolicy)}:${candidateSha}`;
}

function decodeJson(value) {
  return JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
}

function expectedClaim(claims, field, expected, errors) {
  if (!expected || claims?.[field] !== expected) {
    errors.push(`${field} claim mismatch`);
  }
}

function audienceMatches(actual, expected) {
  return Array.isArray(actual) ? actual.includes(expected) : actual === expected;
}

export async function verifyGitHubOidcToken(token, authority, options = {}) {
  const errors = [];
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return { valid: false, errors: ['OIDC token must be a JWT'] };

  let header;
  let claims;
  try {
    header = decodeJson(parts[0]);
    claims = decodeJson(parts[1]);
  } catch {
    return { valid: false, errors: ['OIDC token payload is invalid'] };
  }
  if (header.alg !== 'RS256') errors.push('OIDC alg must be RS256');
  if (header.typ !== 'JWT') errors.push('OIDC typ must be JWT');
  if (!header.kid) errors.push('OIDC kid is required');

  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const response = await fetchImpl(GITHUB_OIDC_JWKS, {
    signal: options.signal || globalThis.AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`GitHub OIDC JWKS lookup failed: HTTP ${response.status}`);
  const jwks = await response.json();
  const jwk = jwks.keys?.find((candidate) => candidate.kid === header.kid && candidate.kty === 'RSA');
  if (!jwk) errors.push('OIDC signing key is not published by GitHub');
  if (jwk && header.alg === 'RS256') {
    try {
      const validSignature = verifyBytes(
        'RSA-SHA256',
        Buffer.from(`${parts[0]}.${parts[1]}`),
        createPublicKey({ key: jwk, format: 'jwk' }),
        Buffer.from(parts[2], 'base64url'),
      );
      if (!validSignature) errors.push('OIDC signature verification failed');
    } catch (error) {
      errors.push(`OIDC signature verification failed: ${error.message}`);
    }
  }

  const now = options.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (claims.iss !== GITHUB_OIDC_ISSUER) errors.push('OIDC issuer mismatch');
  if (!audienceMatches(claims.aud, options.expectedAudience)) errors.push('OIDC audience mismatch');
  if (!Number.isInteger(claims.exp) || claims.exp <= now) errors.push('OIDC token is expired');
  if (!Number.isInteger(claims.nbf) || claims.nbf > now + 30) errors.push('OIDC token is not active');
  if (!Number.isInteger(claims.iat) || claims.iat > now + 30) errors.push('OIDC issued-at is invalid');
  expectedClaim(claims, 'repository', authority?.repository, errors);
  expectedClaim(claims, 'workflow_ref', authority?.workflow_ref, errors);
  expectedClaim(claims, 'ref', authority?.ref, errors);
  expectedClaim(claims, 'environment', authority?.environment, errors);
  expectedClaim(claims, 'runner_environment', authority?.runner_environment, errors);
  if (!claims.run_id) errors.push('run_id claim is required');
  if (!claims.run_attempt) errors.push('run_attempt claim is required');

  return { valid: errors.length === 0, errors, claims };
}

export async function verifyVerifierOwnedTrustPolicy(rawPolicy, oidcToken, options = {}) {
  if (!rawPolicy) {
    return { valid: false, errors: ['protected verifier trust policy is required'] };
  }
  if (!oidcToken) return { valid: false, errors: ['GitHub OIDC gate token is required'] };
  let policy;
  try {
    policy = JSON.parse(rawPolicy);
  } catch {
    return { valid: false, errors: ['protected verifier trust policy is invalid JSON'] };
  }
  const policyErrors = validateTrustPolicy(policy);
  for (const [field, expected] of Object.entries(PINNED_VERIFIER_AUTHORITY)) {
    if (policy?.authority?.[field] !== expected) {
      policyErrors.push(`trust policy authority.${field} is not pinned verifier authority`);
    }
  }
  if (policyErrors.length > 0) return { valid: false, errors: policyErrors, policy };
  if (!options.expectedCandidateSha) {
    return { valid: false, errors: ['expected candidate SHA is required'], policy };
  }
  const trustPolicySha256 = sha256(rawPolicy);
  const oidc = await verifyGitHubOidcToken(oidcToken, policy.authority, {
    ...options,
    expectedAudience: trustPolicyAudience(rawPolicy, options.expectedCandidateSha),
  });
  return {
    valid: oidc.valid,
    errors: oidc.errors,
    policy,
    oidc_claims: oidc.claims,
    trust_policy_sha256: trustPolicySha256,
  };
}
