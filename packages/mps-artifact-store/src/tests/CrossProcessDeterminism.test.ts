/**
 * CrossProcessDeterminism.test.ts
 *
 * NORMATIVE
 *
 * Repository SHALL preserve identity across restarts.
 */

import { describe, expect, it } from "vitest";
import {
  createPersistentBackend,
  createRepository,
  createCanonicalArtifact
} from "./helpers/index.js";

describe("Cross process determinism", () => {

  it("restart SHALL preserve identity", async () => {

    const backend = createPersistentBackend();

    const repoA = createRepository({ backend });

    const artifact = createCanonicalArtifact();

    await repoA.append(artifact);

    const repoB = createRepository({ backend });

    const resolved = await repoB.read(artifact.ref);

    expect(resolved.bytes).toEqual(artifact.bytes);
    expect(resolved.ref.hash).toEqual(artifact.ref.hash);
    expect(resolved.ref.artifactId).toEqual(artifact.ref.artifactId);

  });

});
