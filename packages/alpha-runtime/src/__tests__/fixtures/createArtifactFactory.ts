import { JsonCanonicalizer } from "../../runtime/engines/SimpleCanonicalizer";
import { Sha256HashEngine } from "../../runtime/engines/Sha256HashEngine";

export function createArtifactFactory() {
  const canonicalizer = new JsonCanonicalizer();
  const hasher = new Sha256HashEngine();

  return {
    createArtifact: async (payload: any) => {
      const canonical = canonicalizer.serialize(payload);
      const content_hash = await hasher.hash(canonical, "sha256-v1");

      return {
        id: `artifact-${content_hash.digest.substring(0, 8)}`,
        version: "1",
        content_hash
      };
    }
  };
}
