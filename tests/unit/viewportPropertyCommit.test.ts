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

/**
 * Simulated scene display pointer + identity-scoped detach.
 * Mirrors CesiumAdapter: assign before await; detachOwned only clears if pointer === owned.
 */
function createDisplayHarness(isCurrent: (generation: number) => boolean, isDestroyed: () => boolean) {
  let displayed: string | null = null;
  const clear = vi.fn(() => {
    displayed = null;
  });
  const detachOwned = vi.fn((owned: string) => {
    if (displayed === owned) {
      displayed = null;
    }
  });
  const discard = vi.fn();
  return {
    getDisplayed: () => displayed,
    clear,
    detachOwned,
    discard,
    attachSync: (generation: number) => (v: string) => {
      if (!isCurrent(generation) || isDestroyed()) return;
      displayed = v;
    },
    attachDelayed: (generation: number, gate: Deferred<void>) => async (v: string) => {
      if (!isCurrent(generation) || isDestroyed()) return;
      displayed = v;
      await gate.promise;
      // Mid-await ownership loss is rolled back by detachOwned(v), not shared clear.
    },
  };
}

describe('F-001 viewport generation ownership', () => {
  it('A: old request resolves AFTER new request — only new result remains', async () => {
    let current = 1;
    const clear = vi.fn();
    const attach = vi.fn();
    const detachOwned = vi.fn();
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
      detachOwned,
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
      detachOwned,
      discardLoaded: discard,
    });

    loadB.resolve('loaded-B');
    await expect(pB).resolves.toEqual({ committed: true, count: 1 });
    expect(attach).toHaveBeenCalledWith('loaded-B');

    loadA.resolve('loaded-A');
    await expect(pA).resolves.toEqual({ committed: false, count: 0 });
    expect(attach).not.toHaveBeenCalledWith('loaded-A');
    expect(discard).toHaveBeenCalledWith('loaded-A');
    expect(detachOwned).not.toHaveBeenCalled();
  });

  it('B: old request rejects AFTER new succeeds — current stays uncorrupted', async () => {
    let current = 1;
    const clear = vi.fn();
    const attach = vi.fn();
    const detachOwned = vi.fn();
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
      detachOwned,
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
      detachOwned,
      discardLoaded: discard,
    });

    loadB.resolve('loaded-B');
    await pB;
    expect(attach.mock.calls).toEqual([['loaded-B']]);

    loadA.reject(new Error('stale network failure'));
    await expect(pA).resolves.toEqual({ committed: false, count: 0 });
    expect(attach.mock.calls).toEqual([['loaded-B']]);
    expect(clear.mock.calls.length).toBeGreaterThanOrEqual(1);
    expect(detachOwned).not.toHaveBeenCalled();
  });

  it('C: old EMPTY resolves AFTER newer non-empty — EMPTY cannot erase current', async () => {
    let current = 1;
    const clear = vi.fn();
    const attach = vi.fn();
    const detachOwned = vi.fn();
    const discard = vi.fn();
    const loadNew = deferred<string>();

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
      detachOwned,
      discardLoaded: discard,
    });

    const pNew = commitViewportPropertyFeatures(collection(['N']), {
      generation: 2,
      isCurrent: (g) => g === current,
      isDestroyed: () => false,
      clearViewportLayer: clear,
      loadGeoJson: () => loadNew.promise,
      attachLoaded: attach,
      detachOwned,
      discardLoaded: discard,
    });

    loadNew.resolve('loaded-N');
    await expect(pNew).resolves.toEqual({ committed: true, count: 1 });
    await expect(pEmpty).resolves.toEqual({ committed: false, count: 0 });
    expect(clear).toHaveBeenCalledTimes(1); // only gen2 cleared
    expect(attach).toHaveBeenCalledWith('loaded-N');
    expect(detachOwned).not.toHaveBeenCalled();
  });

  it('D: old non-empty resolves AFTER newer EMPTY — old data cannot reappear', async () => {
    let current = 1;
    const attached: string[] = [];
    const clear = vi.fn(() => {
      attached.length = 0;
    });
    const detachOwned = vi.fn();
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
      detachOwned,
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
      detachOwned,
      discardLoaded: vi.fn(),
    });

    await expect(pEmpty).resolves.toEqual({ committed: true, count: 0 });
    expect(attached).toEqual([]);

    loadOld.resolve('loaded-OLD');
    await expect(pOld).resolves.toEqual({ committed: false, count: 0 });
    expect(attached).toEqual([]);
    expect(detachOwned).not.toHaveBeenCalled();
  });

  it('E: rapid N, N+1, N+2 — only N+2 may commit', async () => {
    let current = 0;
    const attach = vi.fn();
    const detachOwned = vi.fn();
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
        detachOwned,
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
    expect(detachOwned).not.toHaveBeenCalled();
  });

  it('F: destroy/unmount with pending request — no post-unmount mutation', async () => {
    let destroyed = false;
    let current = 1;
    const clear = vi.fn();
    const attach = vi.fn();
    const detachOwned = vi.fn();
    const discard = vi.fn();
    const load = deferred<string>();

    const pending = commitViewportPropertyFeatures(collection(['X']), {
      generation: 1,
      isCurrent: (g) => !destroyed && g === current,
      isDestroyed: () => destroyed,
      clearViewportLayer: clear,
      loadGeoJson: () => load.promise,
      attachLoaded: attach,
      detachOwned,
      discardLoaded: discard,
    });

    destroyed = true;
    load.resolve('loaded-X');
    await expect(pending).resolves.toEqual({ committed: false, count: 0 });
    expect(attach).not.toHaveBeenCalled();
    expect(discard).toHaveBeenCalledWith('loaded-X');
    expect(detachOwned).not.toHaveBeenCalled();
    // clear may have run while still current before destroy; must not run again after.
  });
});

describe('F-001-R2 identity-scoped attach rollback', () => {
  it('ATTACH INTERLEAVING: stale N attach rollback must not remove B', async () => {
    let current = 1;
    const isCurrent = (g: number) => g === current;
    const isDestroyed = () => false;
    const h = createDisplayHarness(isCurrent, isDestroyed);
    const attachGateA = deferred<void>();
    const loadA = deferred<string>();
    const loadB = deferred<string>();

    const pA = commitViewportPropertyFeatures(collection(['A']), {
      generation: 1,
      isCurrent,
      isDestroyed,
      clearViewportLayer: h.clear,
      loadGeoJson: () => loadA.promise,
      attachLoaded: h.attachDelayed(1, attachGateA),
      detachOwned: h.detachOwned,
      discardLoaded: h.discard,
    });

    loadA.resolve('A');
    // Let N enter attachLoaded (assigns A) and await the gate.
    await Promise.resolve();
    await Promise.resolve();
    expect(h.getDisplayed()).toBe('A');

    current = 2;
    const pB = commitViewportPropertyFeatures(collection(['B']), {
      generation: 2,
      isCurrent,
      isDestroyed,
      clearViewportLayer: h.clear,
      loadGeoJson: () => loadB.promise,
      attachLoaded: h.attachSync(2),
      detachOwned: h.detachOwned,
      discardLoaded: h.discard,
    });

    loadB.resolve('B');
    await expect(pB).resolves.toEqual({ committed: true, count: 1 });
    expect(h.getDisplayed()).toBe('B');

    // N's delayed attach resumes; ownership lost → detachOwned(A), never shared clear of B.
    attachGateA.resolve();
    await expect(pA).resolves.toEqual({ committed: false, count: 0 });

    expect(h.detachOwned).toHaveBeenCalledWith('A');
    expect(h.getDisplayed()).toBe('B');
    // clear runs for N start and N+1 start only — never as stale attach rollback
    expect(h.clear.mock.calls.length).toBe(2);
  });

  it('UNMOUNT DURING ATTACH: destroyed path uses identity detach, not shared clear', async () => {
    let destroyed = false;
    let current = 1;
    const isCurrent = (g: number) => !destroyed && g === current;
    const isDestroyed = () => destroyed;
    const h = createDisplayHarness(isCurrent, isDestroyed);
    const attachGate = deferred<void>();
    const load = deferred<string>();

    const pending = commitViewportPropertyFeatures(collection(['A']), {
      generation: 1,
      isCurrent,
      isDestroyed,
      clearViewportLayer: h.clear,
      loadGeoJson: () => load.promise,
      attachLoaded: h.attachDelayed(1, attachGate),
      detachOwned: h.detachOwned,
      discardLoaded: h.discard,
    });

    load.resolve('A');
    await Promise.resolve();
    await Promise.resolve();
    expect(h.getDisplayed()).toBe('A');

    const clearsAtDestroy = h.clear.mock.calls.length;
    destroyed = true;
    attachGate.resolve();
    await expect(pending).resolves.toEqual({ committed: false, count: 0 });

    expect(h.detachOwned).toHaveBeenCalledWith('A');
    expect(h.discard).toHaveBeenCalledWith('A');
    expect(h.clear.mock.calls.length).toBe(clearsAtDestroy);
    expect(h.getDisplayed()).toBeNull();
  });

  it('MULTI-GENERATION ATTACH: resolve C then A then B — only C remains; A/B detach only self', async () => {
    let current = 1;
    const isCurrent = (g: number) => g === current;
    const isDestroyed = () => false;
    const h = createDisplayHarness(isCurrent, isDestroyed);
    const loadGates = [deferred<string>(), deferred<string>(), deferred<string>()];
    const attachGates = [deferred<void>(), deferred<void>(), deferred<void>()];

    const start = (g: number) =>
      commitViewportPropertyFeatures(collection([`G${g}`]), {
        generation: g,
        isCurrent,
        isDestroyed,
        clearViewportLayer: h.clear,
        loadGeoJson: () => loadGates[g - 1]!.promise,
        attachLoaded: h.attachDelayed(g, attachGates[g - 1]!),
        detachOwned: h.detachOwned,
        discardLoaded: h.discard,
      });

    // Enter each generation's attach await while it is still current.
    current = 1;
    const p1 = start(1);
    loadGates[0]!.resolve('A');
    await Promise.resolve();
    await Promise.resolve();
    expect(h.getDisplayed()).toBe('A');

    current = 2;
    const p2 = start(2);
    loadGates[1]!.resolve('B');
    await Promise.resolve();
    await Promise.resolve();
    expect(h.getDisplayed()).toBe('B');

    current = 3;
    const p3 = start(3);
    loadGates[2]!.resolve('C');
    await Promise.resolve();
    await Promise.resolve();
    expect(h.getDisplayed()).toBe('C');

    // Adversarial attach completion order: C, A, B
    attachGates[2]!.resolve();
    await expect(p3).resolves.toEqual({ committed: true, count: 1 });
    expect(h.getDisplayed()).toBe('C');

    attachGates[0]!.resolve();
    await expect(p1).resolves.toEqual({ committed: false, count: 0 });
    expect(h.detachOwned).toHaveBeenCalledWith('A');
    expect(h.getDisplayed()).toBe('C');

    attachGates[1]!.resolve();
    await expect(p2).resolves.toEqual({ committed: false, count: 0 });
    expect(h.detachOwned).toHaveBeenCalledWith('B');
    expect(h.getDisplayed()).toBe('C');

    expect(h.detachOwned).not.toHaveBeenCalledWith('C');
  });

  it('regression: stale generation must never call shared clear after attach', async () => {
    let current = 1;
    const clear = vi.fn();
    const detachOwned = vi.fn();
    const attachGate = deferred<void>();

    const pA = commitViewportPropertyFeatures(collection(['A']), {
      generation: 1,
      isCurrent: (g) => g === current,
      isDestroyed: () => false,
      clearViewportLayer: clear,
      loadGeoJson: async () => 'A',
      attachLoaded: async () => {
        await attachGate.promise;
      },
      detachOwned,
      discardLoaded: vi.fn(),
    });

    await Promise.resolve();
    const clearsAfterStart = clear.mock.calls.length;
    current = 2;
    attachGate.resolve();
    await pA;
    expect(clear.mock.calls.length).toBe(clearsAfterStart);
    expect(detachOwned).toHaveBeenCalledWith('A');
  });
});
