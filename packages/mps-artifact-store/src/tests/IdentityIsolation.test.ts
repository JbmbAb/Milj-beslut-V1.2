/**
 * IdentityIsolation.test.ts
 *
 * NORMATIVE
 *
 * Metrics, telemetry, logging, timestamps,
 * locale, timezone and environment SHALL NOT
 * influence canonical identity.
 */

import { describe, expect, it } from "vitest";
import { createRepository, createCanonicalArtifact, createMetrics } from "./helpers/index.js";

describe("Identity isolation", () => {

    it("runtime diagnostics SHALL NOT influence identity", async () => {

        const repositoryA = createRepository({
            metrics: createMetrics("A"),
            traceId: "trace-a",
            correlationId: "corr-a"
        });

        const repositoryB = createRepository({
            metrics: createMetrics("B"),
            traceId: "trace-b",
            correlationId: "corr-b"
        });

        const artifact = createCanonicalArtifact();

        await repositoryA.append(artifact);

        const first = await repositoryA.read(artifact.ref);

        await repositoryB.append(artifact);

        const second = await repositoryB.read(artifact.ref);

        expect(first.bytes).toEqual(second.bytes);
        expect(first.ref.hash).toEqual(second.ref.hash);
        expect(first.ref.artifactId).toEqual(second.ref.artifactId);

    });

});
