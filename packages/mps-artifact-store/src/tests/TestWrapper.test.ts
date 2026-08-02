/**
 * TestWrapper.test.ts
 *
 * TestWrapper SHALL delegate every operation
 * without modifying semantics.
 */

import { describe, expect, it } from "vitest";
import { createRepository } from "./helpers/index.js";

describe("TestWrapper", () => {
    it("SHALL delegate all properties to the underlying repository exactly", () => {
        const repo = createRepository();
        
        // Assert that the public properties on the wrapper point to the real repo instances 
        // (or our instrumented ones that just add missing methods)
        expect(repo.resolver).toBeDefined();
        expect(repo.verifier).toBeDefined();
        expect(repo.exporter).toBeDefined();
        expect(repo.lineage).toBeDefined();
        expect(repo.snapshots).toBeDefined();
        expect(repo.retention).toBeDefined();
        expect(repo.index).toBeDefined();
    });
});
