import crypto from 'node:crypto';

/** Salt version for log correlation during rotation — never log the salt itself. */
export function getQueryHashSaltVersion(): string {
  return process.env.QUERY_HASH_SALT_VERSION || 'v1';
}

/** GDPR-safe query fingerprint: salted SHA-256 of normalized query text. */
export function queryHash(query: string): string {
  const salt = process.env.QUERY_HASH_SALT || 'default-salt-v1';
  const normalized = (query || '').trim().toLowerCase();
  return crypto.createHash('sha256').update(salt + normalized).digest('hex');
}
