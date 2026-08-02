import { describe, it, expect } from "vitest";
import { DefaultCanonicalPipeline } from "../CanonicalPipeline.js";

describe("ObjectSorting", () => {
    it("should order keys lexicographically", () => {
        const pipeline = new DefaultCanonicalPipeline();
        
        const obj1 = { b: 2, a: 1, c: 3 };
        const obj2 = { c: 3, b: 2, a: 1 };
        
        const bytes1 = pipeline.canonicalize(obj1, "JSON");
        const bytes2 = pipeline.canonicalize(obj2, "JSON");
        
        expect(bytes1).toEqual(bytes2);
        
        const str = new TextDecoder().decode(bytes1);
        expect(str).toBe('{"a":1,"b":2,"c":3}');
    });

    it("should ignore undefined values", () => {
        const pipeline = new DefaultCanonicalPipeline();
        
        const obj1 = { a: 1, b: undefined };
        const obj2 = { a: 1 };
        
        const bytes1 = pipeline.canonicalize(obj1, "JSON");
        const bytes2 = pipeline.canonicalize(obj2, "JSON");
        
        expect(bytes1).toEqual(bytes2);
    });
});
