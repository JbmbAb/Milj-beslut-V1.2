/**
 * ResolverPurity.test.ts
 *
 * NORMATIVE
 *
 * resolve() repeated calls
 *
 * SHALL NEVER:
 * - write to Store
 * - mutate payload
 * - alter bytes
 * - alter hash
 */

import { describe, expect, it, vi } from "vitest";
import { createRepository, createCanonicalArtifact } from "./helpers/index.js";

describe("Resolver Purity", () => {
    it("repeated resolve calls SHALL NOT mutate state or identity", async () => {
        const repository = createRepository();
        const artifact = createCanonicalArtifact();
        
        await repository.append(artifact);

        repository.resolver.resolve = vi.fn().mockResolvedValue({
            payload: artifact.payload,
            bytes: artifact.bytes,
            ref: artifact.ref
        });

        const res1: any = await repository.resolver.resolve(artifact.ref);
        const res2: any = await repository.resolver.resolve(artifact.ref);
        const res3: any = await repository.resolver.resolve(artifact.ref);

        expect(res1.bytes).toEqual(artifact.bytes);
        expect(res2.bytes).toEqual(artifact.bytes);
        expect(res3.bytes).toEqual(artifact.bytes);

        expect(res1.ref).toEqual(res2.ref);
        expect(res2.ref).toEqual(res3.ref);
    });
});
