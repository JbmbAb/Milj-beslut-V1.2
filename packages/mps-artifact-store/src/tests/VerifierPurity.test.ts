/**
 * VerifierPurity.test.ts
 *
 * NORMATIVE
 *
 * Verification SHALL NOT mutate artifacts.
 */

import { describe, expect, it } from "vitest";
import {
  createRepository,
  createCanonicalArtifact
} from "./helpers/index.js";

describe("Verifier purity", () => {

  it("verification SHALL preserve artifact identity", async () => {

    const repository = createRepository();

    const artifact = createCanonicalArtifact();

    await repository.append(artifact);

    await repository.verifier.verifyArtifact(artifact.ref);

    const resolved = await repository.read(artifact.ref);

    expect(resolved.bytes).toEqual(artifact.bytes);
    expect(resolved.ref.hash).toEqual(artifact.ref.hash);

  });

});
