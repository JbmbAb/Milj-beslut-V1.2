import { CapabilityExecutionArtifact } from "../contracts/CapabilityExecutionArtifact.js";
import { DefaultCanonicalPipeline } from "@miljobeslut/mps-canonical";

async function canonicalHash(obj: any): Promise<string> {
    const pipeline = new DefaultCanonicalPipeline();
    await pipeline.initHasher();
    return pipeline.hashCanonical(obj, "JSON").digest;
}

export class DefaultReplayValidator {
  async verifyReplay(run1: CapabilityExecutionArtifact, run2: CapabilityExecutionArtifact): Promise<void> {
    const hash1 = await canonicalHash(run1);
    const hash2 = await canonicalHash(run2);
    
    if (hash1 !== hash2) {
      throw new Error("REPLAY_DETERMINISM_VIOLATION");
    }
  }
}
