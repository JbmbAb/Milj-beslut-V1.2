import { describe, test, expect } from 'vitest';
import { RequestContext } from '../../server/lib/requestContext.ts';

describe('RequestContext with AsyncLocalStorage', () => {
  test('returns undefined when accessed outside of a context run block', () => {
    expect(RequestContext.get()).toBeUndefined();
  });

  test('returns the active store when inside context run block', () => {
    const store = {
      requestId: 'req-123',
      userId: 'user-abc',
      startTs: Date.now(),
    };

    RequestContext.run(store, () => {
      const active = RequestContext.get();
      expect(active).toBeDefined();
      expect(active?.requestId).toBe('req-123');
      expect(active?.userId).toBe('user-abc');
    });
  });

  test('supports nesting and restores previous context', () => {
    const outerStore = {
      requestId: 'outer',
      userId: 'user-1',
      startTs: Date.now(),
    };

    const innerStore = {
      requestId: 'inner',
      userId: 'user-2',
      startTs: Date.now(),
    };

    RequestContext.run(outerStore, () => {
      expect(RequestContext.get()?.requestId).toBe('outer');

      RequestContext.run(innerStore, () => {
        expect(RequestContext.get()?.requestId).toBe('inner');
      });

      expect(RequestContext.get()?.requestId).toBe('outer');
    });
  });

  test('propagates context through async calls', async () => {
    const store = {
      requestId: 'async-req',
      userId: 'async-user',
      startTs: Date.now(),
    };

    await RequestContext.run(store, async () => {
      await Promise.resolve();
      expect(RequestContext.get()?.requestId).toBe('async-req');
    });
  });
});
