/**
 * RepositoryDeterminism.test.ts
 *
 * NORMATIVE
 *
 * ArtifactRepository SHALL preserve canonical bytes exactly as stored.
 * ArtifactRepository SHALL remain replay deterministic.
 */

import { describe, expect, it } from "vitest";
import { createRepository, createCanonicalArtifact } from "./helpers/index.js";

describe("Repository determinism", () => {
  it("append → read → append → read SHALL preserve canonical identity", async () => {
    const repository = createRepository();

    const artifact = createCanonicalArtifact();

    await repository.append(artifact);

    const first = await repository.read(artifact.ref);
    const second = await repository.read(artifact.ref);
    const third = await repository.read(artifact.ref);

    expect(second.bytes).toEqual(first.bytes);
    expect(second.ref.hash).toBe(first.ref.hash);
    expect(second.ref.artifactId).toBe(first.ref.artifactId);
    
    expect(third.bytes).toEqual(first.bytes);
    expect(third.ref.hash).toBe(first.ref.hash);
    expect(third.ref.artifactId).toBe(first.ref.artifactId);
  });
});
