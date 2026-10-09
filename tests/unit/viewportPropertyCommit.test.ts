import { describe, expect, it, vi } from 'vitest';
import { commitViewportPropertyFeatures } from '../../components/cesium/viewportPropertyCommit';

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function collection(ids: string[]) {
  return {
    type: 'FeatureCollection',
    features: ids.map((id) => ({
      type: 'Feature',
      properties: { feature_ref: id },
      geometry: { type: 'Point', coordinates: [14.4, 61.1] },
    })),
  };
}

describe('F-001 viewport generation ownership', () => {
  it('A: old request resolves AFTER new request — only new result remains', async () => {
    let current = 1;
    const clear = vi.fn();
    const attach = vi.fn();
    const discard = vi.fn();
    const loadA = deferred<string>();
    const loadB = deferred<string>();

    const pA = commitViewportPropertyFeatures(collection(['A']), {
      generation: 1,
      isCurrent: (g) => g === current,
      isDestroyed: () => false,
      clearViewportLayer: clear,
      loadGeoJson: () => loadA.promise,
      attachLoaded: attach,
      discardLoaded: discard,
    });

    current = 2;
    const pB = commitViewportPropertyFeatures(collection(['B']), {
      generation: 2,
      isCurrent: (g) => g === current,
      isDestroyed: () => false,
      clearViewportLayer: clear,
      loadGeoJson: () => loadB.promise,
      attachLoaded: attach,
      discardLoaded: discard,
    });

    loadB.resolve('loaded-B');
    await expect(pB).resolves.toEqual({ committed: true, count: 1 });
    expect(attach).toHaveBeenCalledWith('loaded-B');

    loadA.resolve('loaded-A');
    await expect(pA).resolves.toEqual({ committed: false, count: 0 });
    expect(attach).not.toHaveBeenCalledWith('loaded-A');
    expect(discard).toHaveBeenCalledWith('loaded-A');
  });

  it('B: old request rejects AFTER new succeeds — current stays uncorrupted', async () => {
    let current = 1;
    const clear = vi.fn();
    const attach = vi.fn();
    const discard = vi.fn();
    const loadA = deferred<string>();
    const loadB = deferred<string>();

    const pA = commitViewportPropertyFeatures(collection(['A']), {
      generation: 1,
      isCurrent: (g) => g === current,
      isDestroyed: () => false,
      clearViewportLayer: clear,
      loadGeoJson: () => loadA.promise,
      attachLoaded: attach,
      discardLoaded: discard,
    });

    current = 2;
    const pB = commitViewportPropertyFeatures(collection(['B']), {
      generation: 2,
      isCurrent: (g) => g === current,
      isDestroyed: () => false,
      clearViewportLayer: clear,
      loadGeoJson: () => loadB.promise,
      attachLoaded: attach,
      discardLoaded: discard,
    });

    loadB.resolve('loaded-B');
    await pB;
    expect(attach.mock.calls).toEqual([['loaded-B']]);

    loadA.reject(new Error('stale network failure'));
    await expect(pA).resolves.toEqual({ committed: false, count: 0 });
    expect(attach.mock.calls).toEqual([['loaded-B']]);
  });

  it('C: old EMPTY resolves AFTER newer non-empty — EMPTY cannot erase current', async () => {
    let current = 1;
    const clear = vi.fn();
    const attach = vi.fn();
    const discard = vi.fn();
    const loadNew = deferred<string>();

    // Start empty gen1 (no await in empty path after clear) — simulate race by
    // advancing generation before empty commit's clear ownership check via pre-bump.
    current = 2;
    const pEmpty = commitViewportPropertyFeatures(collection([]), {
      generation: 1,
      isCurrent: (g) => g === current,
      isDestroyed: () => false,
      clearViewportLayer: clear,
      loadGeoJson: async () => {
        throw new Error('empty must not load');
      },
      attachLoaded: attach,
      discardLoaded: discard,
    });

    const pNew = commitViewportPropertyFeatures(collection(['N']), {
      generation: 2,
      isCurrent: (g) => g === current,
      isDestroyed: () => false,
      clearViewportLayer: clear,
      loadGeoJson: () => loadNew.promise,
      attachLoaded: attach,
      discardLoaded: discard,
    });

    loadNew.resolve('loaded-N');
    await expect(pNew).resolves.toEqual({ committed: true, count: 1 });
    await expect(pEmpty).resolves.toEqual({ committed: false, count: 0 });
    expect(clear).toHaveBeenCalledTimes(1); // only gen2 cleared
    expect(attach).toHaveBeenCalledWith('loaded-N');
  });

  it('D: old non-empty resolves AFTER newer EMPTY — old data cannot reappear', async () => {
    let current = 1;
    const attached: string[] = [];
    const clear = vi.fn(() => {
      attached.length = 0;
    });
    const loadOld = deferred<string>();

    const pOld = commitViewportPropertyFeatures(collection(['OLD']), {
      generation: 1,
      isCurrent: (g) => g === current,
      isDestroyed: () => false,
      clearViewportLayer: clear,
      loadGeoJson: () => loadOld.promise,
      attachLoaded: (v) => {
        attached.push(String(v));
      },
      discardLoaded: vi.fn(),
    });

    current = 2;
    const pEmpty = commitViewportPropertyFeatures(collection([]), {
      generation: 2,
      isCurrent: (g) => g === current,
      isDestroyed: () => false,
      clearViewportLayer: clear,
      loadGeoJson: async () => {
        throw new Error('empty must not load');
      },
      attachLoaded: (v) => {
        attached.push(String(v));
      },
      discardLoaded: vi.fn(),
    });

    await expect(pEmpty).resolves.toEqual({ committed: true, count: 0 });
    expect(attached).toEqual([]);

    loadOld.resolve('loaded-OLD');
    await expect(pOld).resolves.toEqual({ committed: false, count: 0 });
    expect(attached).toEqual([]);
  });

  it('E: rapid N, N+1, N+2 — only N+2 may commit', async () => {
    let current = 0;
    const attach = vi.fn();
    const discard = vi.fn();
    const loads = [deferred<string>(), deferred<string>(), deferred<string>()];

    const starts = [1, 2, 3].map((g) => {
      current = g;
      return commitViewportPropertyFeatures(collection([`G${g}`]), {
        generation: g,
        isCurrent: (gen) => gen === current,
        isDestroyed: () => false,
        clearViewportLayer: vi.fn(),
        loadGeoJson: () => loads[g - 1]!.promise,
        attachLoaded: attach,
        discardLoaded: discard,
      });
    });

    current = 3;
    loads[0]!.resolve('L1');
    loads[1]!.resolve('L2');
    loads[2]!.resolve('L3');

    const results = await Promise.all(starts);
    expect(results).toEqual([
      { committed: false, count: 0 },
      { committed: false, count: 0 },
      { committed: true, count: 1 },
    ]);
    expect(attach).toHaveBeenCalledTimes(1);
    expect(attach).toHaveBeenCalledWith('L3');
    expect(discard).toHaveBeenCalledWith('L1');
    expect(discard).toHaveBeenCalledWith('L2');
  });

  it('F: destroy/unmount with pending request — no post-unmount mutation', async () => {
    let destroyed = false;
    let current = 1;
    const attach = vi.fn();
    const discard = vi.fn();
    const load = deferred<string>();

    const pending = commitViewportPropertyFeatures(collection(['X']), {
      generation: 1,
      isCurrent: (g) => !destroyed && g === current,
      isDestroyed: () => destroyed,
      clearViewportLayer: vi.fn(),
      loadGeoJson: () => load.promise,
      attachLoaded: attach,
      discardLoaded: discard,
    });

    destroyed = true;
    load.resolve('loaded-X');
    await expect(pending).resolves.toEqual({ committed: false, count: 0 });
    expect(attach).not.toHaveBeenCalled();
    expect(discard).toHaveBeenCalledWith('loaded-X');
  });
});
