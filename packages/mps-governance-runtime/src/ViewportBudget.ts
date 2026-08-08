/**
 * VIEW-22-I5 — Viewport Bounding.
 * Caps how much graph state a live session may materialize.
 */
export interface ViewportBudget {
  readonly max_inspected_nodes: number;
  readonly max_exported_artifacts: number;
}

export const DEFAULT_VIEWPORT_BUDGET: ViewportBudget = Object.freeze({
  max_inspected_nodes: 500,
  max_exported_artifacts: 50,
});
