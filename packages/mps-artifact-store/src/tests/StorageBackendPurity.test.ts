/**
 * StorageBackendPurity.test.ts
 *
 * NORMATIVE
 *
 * Storage backend SHALL preserve canonical bytes exactly.
 */

import { describe, expect, it } from "vitest";
import {
  createRepository,
  createCanonicalArtifact
} from "./helpers/index.js";

describe("Storage purity", () => {

  it("stored bytes SHALL equal retrieved bytes", async () => {

    const repository = createRepository();

    const artifact = createCanonicalArtifact();

    await repository.append(artifact);

    const stored = await repository.read(artifact.ref);

    expect(stored.bytes).toEqual(artifact.bytes);

  });

});
