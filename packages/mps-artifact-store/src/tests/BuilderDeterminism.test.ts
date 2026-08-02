/**
 * BuilderDeterminism.test.ts
 *
 * NORMATIVE
 *
 * RepositoryBuilder SHALL construct
 * functionally equivalent repositories
 * for identical inputs.
 */

import { describe, expect, it } from "vitest";
import { RepositoryBuilder } from "../internal/RepositoryBuilder.js";
import { createRepositoryOptions } from "./helpers/index.js";
import { DefaultCanonicalPipeline } from '@miljobeslut/mps-canonical';

describe("RepositoryBuilder", () => {

    it("identical configuration SHALL produce equivalent repositories", () => {

        const options = createRepositoryOptions();
        const pipeline = new DefaultCanonicalPipeline();
        const index = { has: async () => false };

        const repo1 = new RepositoryBuilder(options, pipeline as any, index).build();

        const repo2 = new RepositoryBuilder(options, pipeline as any, index).build();

        expect(repo1.constructor).toBe(repo2.constructor);

        expect(repo1.resolver.constructor)
            .toBe(repo2.resolver.constructor);

        expect(repo1.verifier.constructor)
            .toBe(repo2.verifier.constructor);

        expect(repo1.exporter.constructor)
            .toBe(repo2.exporter.constructor);

        expect(repo1.lineage.constructor)
            .toBe(repo2.lineage.constructor);

    });

});
