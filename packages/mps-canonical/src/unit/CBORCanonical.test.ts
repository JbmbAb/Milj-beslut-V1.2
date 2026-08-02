import { describe, it, expect } from "vitest";
import { DefaultCanonicalPipeline } from "../CanonicalPipeline.js";

describe("CBORCanonical", () => {
    it("should generate stable cbor with ordered keys", () => {
        const pipeline = new DefaultCanonicalPipeline();
        
        const obj1 = { z: 1, x: 2, a: 3 };
        const obj2 = { a: 3, x: 2, z: 1 };
        
        const cbor1 = pipeline.canonicalize(obj1, "CBOR");
        const cbor2 = pipeline.canonicalize(obj2, "CBOR");
        
        expect(cbor1).toEqual(cbor2);
    });
});
