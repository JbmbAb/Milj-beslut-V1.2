/**
 * HashVerificationPurity.test.ts
 *
 * NORMATIVE
 *
 * Hash verification SHALL NOT regenerate identity.
 */

import { describe, expect, it } from "vitest";
import {
  createRepository,
  createCanonicalArtifact
} from "./helpers/index.js";

describe("Hash verification", () => {

  it("verifyHash SHALL be side-effect free", async () => {

    const repository = createRepository();

    const artifact = createCanonicalArtifact();

    await repository.append(artifact);

    await repository.verifier.verifyHash(artifact.ref);
    await repository.verifier.verifyHash(artifact.ref);
    await repository.verifier.verifyHash(artifact.ref);

    const resolved = await repository.read(artifact.ref);

    expect(resolved.ref.hash).toEqual(artifact.ref.hash);
    expect(resolved.bytes).toEqual(artifact.bytes);

  });

});
