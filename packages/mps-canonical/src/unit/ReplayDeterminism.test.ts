import { describe, it, expect } from "vitest";
import { DefaultCanonicalArtifactFactory } from "../CanonicalArtifactFactory.js";
import { DefaultCanonicalSerializer } from "../CanonicalSerializer.js";

describe("ReplayDeterminism", () => {
    it("canonicalize -> hash -> deserialize -> canonicalize -> hash must be identical", async () => {
        const factory = new DefaultCanonicalArtifactFactory();
        const serializer = new DefaultCanonicalSerializer();
        
        const logicalObject = { a: 1, b: "test", c: [1, 2, 3] };
        
        // 1. canonicalize -> hash
        const artifact1 = await factory.create("v1", logicalObject, "CBOR");
        
        // 2. deserialize (Artifacts are wrapped in { _schema, _data })
        const deserializedPayload = serializer.deserializeCanonical<{_schema: string, _data: {a: number, b: string, c: number[]}}>(artifact1.bytes, "CBOR");
        const deserialized = deserializedPayload._data;
        expect(deserialized.a).toBe(1);
        expect(deserialized.b).toBe("test");
        
        // 3. canonicalize -> hash (again)
        const artifact2 = await factory.create("v1", deserialized, "CBOR");
        
        // MÅSTE ge identiskt resultat (Replay Determinism)
        expect(artifact1.content_hash).toEqual(artifact2.content_hash);
        expect(Buffer.from(artifact1.bytes).toString('hex')).toEqual(Buffer.from(artifact2.bytes).toString('hex'));
    });
});
