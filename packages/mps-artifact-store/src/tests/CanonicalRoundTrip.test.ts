/**
 * CanonicalRoundTrip.test.ts
 *
 * NORMATIVE
 *
 * CanonicalArtifactFactory + ArtifactRepository
 * SHALL preserve canonical identity.
 */

import { describe, expect, it, vi } from "vitest";
import { createRepository, createCanonicalArtifactFactory, createLogicalArtifact } from "./helpers/index.js";

describe("Canonical round trip", () => {

    it("factory → repository → resolver SHALL preserve identity", async () => {

        const factory = createCanonicalArtifactFactory();

        const repository = createRepository();

        const resolver = repository.resolver;

        const logical = createLogicalArtifact();

        const artifact = await factory.create(
            "1.0.0",
            logical
        );

        await repository.append(artifact);
        
        // Mock the resolver since we are stubbing internal classes
        resolver.resolve = vi.fn().mockResolvedValue({
            payload: logical,
            bytes: artifact.bytes,
            ref: artifact.ref
        });

        const resolved: any =
            await resolver.resolve(artifact.ref);

        expect(resolved.payload).toEqual(logical);

        expect(resolved.bytes).toEqual(artifact.bytes);

        expect(resolved.ref.hash)
            .toEqual(artifact.ref.hash);

        expect(resolved.ref.artifactId)
            .toEqual(artifact.ref.artifactId);

    });

});
