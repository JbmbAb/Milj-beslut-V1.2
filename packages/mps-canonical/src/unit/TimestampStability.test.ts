import { describe, it, expect } from "vitest";
import { DefaultCanonicalTimestamp } from "../CanonicalTimestamp.js";

describe("TimestampStability", () => {
    it("should format to RFC3339 UTC without milliseconds", () => {
        const ts = new DefaultCanonicalTimestamp();
        const date = new Date(Date.UTC(2026, 7, 1, 14, 30, 45, 123)); // August 1st, 2026, 14:30:45.123
        const canonical = ts.canonicalFrom(date);
        
        expect(canonical).toBe("2026-08-01T14:30:45Z");
        expect(canonical).not.toContain(".");
        expect(canonical.endsWith("Z")).toBe(true);
    });

    it("should throw on Invalid Date", () => {
        const ts = new DefaultCanonicalTimestamp();
        expect(() => ts.canonicalFrom(new Date(NaN))).toThrow();
    });
});
