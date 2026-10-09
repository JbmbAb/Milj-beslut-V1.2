/**
 * Generation-owned viewport property commit.
 *
 * Correctness is semantic (monotone generation ownership), not abort/timing dependent.
 * Only the currently owned generation may clear/replace/append viewport datasources
 * or report a committed presentation count.
 *
 * F-001-R2: a stale/destroyed generation may only detach the exact resource it owns.
 * Shared/global clear after a lost attach race is forbidden.
 */

export type ViewportPropertyCommitResult = {
  readonly committed: boolean;
  readonly count: number;
};

export type ViewportPropertyCommitDeps<TLoaded> = {
  readonly generation: number;
  readonly isCurrent: (generation: number) => boolean;
  readonly isDestroyed: () => boolean;
  /**
   * Remove the currently displayed viewport datasource.
   * May ONLY be called while this generation still owns the viewport (pre-attach).
   */
  readonly clearViewportLayer: () => void;
  /** Async parse/load — may outlive ownership; must not mutate the scene. */
  readonly loadGeoJson: (geojson: unknown) => Promise<TLoaded>;
  /**
   * Attach a previously loaded datasource to the scene.
   * The `loaded` instance is the ownership handle for this generation.
   */
  readonly attachLoaded: (loaded: TLoaded) => void | Promise<void>;
  /**
   * Identity-scoped detach of exactly `owned`.
   * Must never clear/remove a different generation's displayed datasource.
   */
  readonly detachOwned: (owned: TLoaded) => void;
  /** Drop a loaded-but-never-needed datasource (not displayed / already detached). */
  readonly discardLoaded: (loaded: TLoaded) => void;
};

function canCommit(
  generation: number,
  isCurrent: (generation: number) => boolean,
  isDestroyed: () => boolean,
): boolean {
  return !isDestroyed() && isCurrent(generation);
}

/**
 * Commit a viewport FeatureCollection under generation ownership.
 * Stale generations never clear shared display state; they may only detach their own resource.
 */
export async function commitViewportPropertyFeatures<TLoaded>(
  geojson: unknown,
  deps: ViewportPropertyCommitDeps<TLoaded>,
): Promise<ViewportPropertyCommitResult> {
  const { generation, isCurrent, isDestroyed } = deps;

  if (!canCommit(generation, isCurrent, isDestroyed)) {
    return { committed: false, count: 0 };
  }

  // Shared clear is allowed only while this generation is still the current owner.
  deps.clearViewportLayer();

  if (!canCommit(generation, isCurrent, isDestroyed)) {
    return { committed: false, count: 0 };
  }

  const features = (geojson as { features?: unknown } | null | undefined)?.features;
  if (!Array.isArray(features) || features.length === 0) {
    // Current generation explicitly commits EMPTY.
    return { committed: true, count: 0 };
  }

  let loaded: TLoaded;
  try {
    loaded = await deps.loadGeoJson(geojson);
  } catch (err) {
    if (!canCommit(generation, isCurrent, isDestroyed)) {
      // Stale rejection must not surface as current-state corruption.
      return { committed: false, count: 0 };
    }
    throw err;
  }

  if (!canCommit(generation, isCurrent, isDestroyed)) {
    deps.discardLoaded(loaded);
    return { committed: false, count: 0 };
  }

  // Attach may await; ownership can change inside the await.
  await Promise.resolve(deps.attachLoaded(loaded));

  if (!canCommit(generation, isCurrent, isDestroyed)) {
    // F-001-R2: remove ONLY the resource this generation attached — never shared clear.
    deps.detachOwned(loaded);
    deps.discardLoaded(loaded);
    return { committed: false, count: 0 };
  }

  return { committed: true, count: features.length };
}
