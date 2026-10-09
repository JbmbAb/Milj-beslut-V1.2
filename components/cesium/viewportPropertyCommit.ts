/**
 * Generation-owned viewport property commit.
 *
 * Correctness is semantic (monotone generation ownership), not abort/timing dependent.
 * Only the currently owned generation may clear/replace/append viewport datasources
 * or report a committed presentation count.
 */

export type ViewportPropertyCommitResult = {
  readonly committed: boolean;
  readonly count: number;
};

export type ViewportPropertyCommitDeps<TLoaded> = {
  readonly generation: number;
  readonly isCurrent: (generation: number) => boolean;
  readonly isDestroyed: () => boolean;
  /** Remove the currently displayed viewport datasource (must be a no-op if none). */
  readonly clearViewportLayer: () => void;
  /** Async parse/load — may outlive ownership; must not mutate the scene. */
  readonly loadGeoJson: (geojson: unknown) => Promise<TLoaded>;
  /** Attach a previously loaded datasource to the scene. */
  readonly attachLoaded: (loaded: TLoaded) => void | Promise<void>;
  /** Drop a loaded-but-never-attached datasource. */
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
 * Stale generations never clear, never attach, never claim commit.
 */
export async function commitViewportPropertyFeatures<TLoaded>(
  geojson: unknown,
  deps: ViewportPropertyCommitDeps<TLoaded>,
): Promise<ViewportPropertyCommitResult> {
  const { generation, isCurrent, isDestroyed } = deps;

  if (!canCommit(generation, isCurrent, isDestroyed)) {
    return { committed: false, count: 0 };
  }

  // Clear is a mutation — only the current owner may do it.
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

  await Promise.resolve(deps.attachLoaded(loaded));

  if (!canCommit(generation, isCurrent, isDestroyed)) {
    // Lost ownership during attach — roll back mutation.
    deps.clearViewportLayer();
    deps.discardLoaded(loaded);
    return { committed: false, count: 0 };
  }

  return { committed: true, count: features.length };
}
