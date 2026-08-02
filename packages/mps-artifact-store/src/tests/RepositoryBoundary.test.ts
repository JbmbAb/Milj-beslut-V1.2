/**
 * RepositoryBoundary.test.ts
 *
 * NORMATIVE
 *
 * Application code SHALL interact exclusively
 * through ArtifactRepository.
 */

import { describe, expect, it } from "vitest";
import { createRepository } from "./helpers/index.js";

describe("Repository boundary", () => {

  it("SHALL expose only public contracts", () => {

    const repository = createRepository();

    expect("store" in repository).toBe(false);
    expect("builder" in repository).toBe(false);
    expect("deserializer" in repository).toBe(false);
    expect("hashVerifier" in repository).toBe(false);
    expect("schemaVerifier" in repository).toBe(false);
    expect("snapshotFactory" in repository).toBe(false);

  });

});
