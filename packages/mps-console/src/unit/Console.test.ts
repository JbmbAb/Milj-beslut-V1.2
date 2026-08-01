import { describe, expect, it } from "vitest";
import { uiReducer } from "../UiState";
import type { UiState, UiAction } from "../UiState";

describe("Mps Console State Reducer Suite", () => {
  it("should process select actions deterministically", () => {
    const initialState: UiState = {
      selectedPipelineId: undefined,
    };

    const action: UiAction = {
      type: "SELECT_PIPELINE",
      pipelineId: "pipe-100",
    };

    const nextState = uiReducer(initialState, action);

    expect(nextState.selectedPipelineId).toBe("pipe-100");
  });

  it("should select artifact hashes and update state cleanly", () => {
    const initialState: UiState = {
      selectedArtifactHash: undefined,
    };

    const action: UiAction = {
      type: "SELECT_ARTIFACT",
      hash: "sha256-abc",
    };

    const nextState = uiReducer(initialState, action);

    expect(nextState.selectedArtifactHash).toBe("sha256-abc");
  });
});
