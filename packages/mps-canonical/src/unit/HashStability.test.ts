import { describe, it, expect, beforeAll } from "vitest";
import { DefaultCanonicalPipeline } from "../CanonicalPipeline.js";

describe("HashStability", () => {
    it("should generate same hash for same logical object", async () => {
        const pipeline = new DefaultCanonicalPipeline();
        await pipeline.initHasher();
        
        const obj1 = { a: 1, b: "test" };
        const obj2 = { b: "test", a: 1 };
        
        const hash1 = pipeline.hashCanonical(obj1, "CBOR");
        const hash2 = pipeline.hashCanonical(obj2, "CBOR");
        
        expect(hash1).toEqual(hash2);
        expect(hash1.algorithm).toBe("blake3");
        expect(hash1.length).toBeGreaterThan(0);
    });
});
