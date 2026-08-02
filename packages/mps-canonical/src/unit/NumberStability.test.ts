import { describe, it, expect } from "vitest";
import { DefaultCanonicalNumber } from "../CanonicalNumber.js";

describe("NumberStability", () => {
    it("should canonicalize IEEE754 properly", () => {
        const num = new DefaultCanonicalNumber();
        
        // Inga NaN-variationer
        expect(num.canonicalize(Number.NaN)).toBeNaN();
        
        // Inga -0/+0 variationer
        expect(Object.is(num.canonicalize(-0), +0)).toBe(true);
        expect(Object.is(num.canonicalize(+0), +0)).toBe(true);
        
        // Float consistency
        expect(num.canonicalize(3.14159265359)).toBe(3.14159265359);
    });
});
