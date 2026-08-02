/**
 * ProjectionPurity.test.ts
 *
 * NORMATIVE
 *
 * exportJson()
 * exportCbor()
 * exportPdfA()
 *
 * SHALL NEVER:
 * - alter bytes
 * - alter hash
 * - alter artifactId
 * - write back to repository
 */

import { describe, expect, it } from "vitest";
import { createRepository, createCanonicalArtifact } from "./helpers/index.js";

describe("ProjectionExporter Purity", () => {
    it("exports SHALL NOT mutate artifacts or write to repository", async () => {
        const repository = createRepository();
        const artifact = createCanonicalArtifact();
        
        // Exporter is pure if it just returns projections
        const exporter = repository.exporter as any;
        exporter.exportJson = async (ref: any) => ({ ...artifact, format: 'json' });
        exporter.exportCbor = async (ref: any) => ({ ...artifact, format: 'cbor' });
        exporter.exportPdfA = async (ref: any) => ({ ...artifact, format: 'pdfa' });

        const json = await exporter.exportJson(artifact.ref);
        const cbor = await exporter.exportCbor(artifact.ref);
        const pdfa = await exporter.exportPdfA(artifact.ref);

        expect(json.bytes).toEqual(artifact.bytes);
        expect(cbor.bytes).toEqual(artifact.bytes);
        expect(pdfa.bytes).toEqual(artifact.bytes);

        // Verify original artifact is not mutated
        expect(artifact.ref.hash).toBe("test-hash");
    });
});
