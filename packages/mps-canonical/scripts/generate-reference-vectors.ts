import { DefaultCanonicalArtifactFactory } from "../src/CanonicalArtifactFactory.js";
import fs from "fs";
import path from "path";

async function generate() {
    const factory = new DefaultCanonicalArtifactFactory();
    const logicalObject = { test: 123, message: "Hello MPS", tags: ["alpha", "beta"] };
    
    const artifactJson = await factory.create("v1.0.0", logicalObject, "JSON");
    const artifactCbor = await factory.create("v1.0.0", logicalObject, "CBOR");
    
    const outDir = path.join(process.cwd(), "reference-vectors");
    
    fs.writeFileSync(path.join(outDir, "artifact-001.json"), new TextDecoder().decode(artifactJson.bytes));
    fs.writeFileSync(path.join(outDir, "artifact-001.cbor"), artifactCbor.bytes);
    
    fs.writeFileSync(path.join(outDir, "artifact-001.hash"), JSON.stringify({
        json_hash: artifactJson.content_hash,
        cbor_hash: artifactCbor.content_hash
    }, null, 2));
    
    console.log("Reference vectors generated!");
}

generate().catch(console.error);
