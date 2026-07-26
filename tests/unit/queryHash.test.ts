import { describe, test, expect } from 'vitest';
import { queryHash, getQueryHashSaltVersion } from '../../server/lib/queryHash';

describe('queryHash', () => {
  test('is deterministic for normalized input with same salt', () => {
    process.env.QUERY_HASH_SALT = 'salt1';
    expect(queryHash('  HeLLo ')).toBe(queryHash('hello'));
  });

  test('changes when salt rotates', () => {
    process.env.QUERY_HASH_SALT = 'saltA';
    const a = queryHash('hello');
    process.env.QUERY_HASH_SALT = 'saltB';
    const b = queryHash('hello');
    expect(a).not.toBe(b);
  });

  test('exposes salt version for log metadata', () => {
    process.env.QUERY_HASH_SALT_VERSION = 'v2';
    expect(getQueryHashSaltVersion()).toBe('v2');
    delete process.env.QUERY_HASH_SALT_VERSION;
    expect(getQueryHashSaltVersion()).toBe('v1');
  });
});
