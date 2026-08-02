/**
 * SnapshotReplay.test.ts
 *
 * NORMATIVE
 *
 * Snapshot replay SHALL preserve identity.
 */

import { describe, expect, it } from "vitest";
import {
  createRepository,
  createCanonicalArtifact
} from "./helpers/index.js";

describe("Snapshot replay", () => {

  it("restore SHALL reproduce identical repository state", async () => {

    const repository = createRepository();

    const artifact = createCanonicalArtifact();

    await repository.append(artifact);

    const snapshot = await repository.snapshots.createSnapshot();

    await repository.snapshots.restoreSnapshot(snapshot.ref);

    const resolved = await repository.read(artifact.ref);

    expect(resolved.ref.hash).toEqual(artifact.ref.hash);
    expect(resolved.bytes).toEqual(artifact.bytes);

  });

});
