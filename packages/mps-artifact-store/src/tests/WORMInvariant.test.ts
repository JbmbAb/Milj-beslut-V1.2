/**
 * WORMInvariant.test.ts
 *
 * NORMATIVE
 *
 * ArtifactStore SHALL be append-only.
 * ArtifactStore SHALL NOT overwrite existing artifacts.
 */

import { describe, expect, it } from "vitest";
import {
  createRepository,
  createCanonicalArtifact
} from "./helpers/index.js";

describe("WORM invariant", () => {

  it("SHALL reject overwrite attempts", async () => {

    const repository = createRepository();

    const artifact = createCanonicalArtifact();

    await repository.append(artifact);

    await expect(
      repository.append(artifact)
    ).rejects.toThrow();

  });

});
