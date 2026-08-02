import { DefaultCanonicalPipeline, CanonicalPipeline } from "./CanonicalPipeline.js";
import { CanonicalArtifact, CanonicalFormat } from "./CanonicalTypes.js";

export interface CanonicalArtifactFactory {
  create<T>(schemaVersion: string, value: T, format: CanonicalFormat): Promise<CanonicalArtifact<T>>;
}

export class DefaultCanonicalArtifactFactory implements CanonicalArtifactFactory {
  private pipeline: CanonicalPipeline;
  
  constructor(pipeline?: CanonicalPipeline) {
    this.pipeline = pipeline || new DefaultCanonicalPipeline();
  }

  async create<T>(schemaVersion: string, value: T, format: CanonicalFormat): Promise<CanonicalArtifact<T>> {
    if (this.pipeline instanceof DefaultCanonicalPipeline) {
        await this.pipeline.initHasher();
    }
    
    const payload = {
        _schema: schemaVersion,
        _data: value
    };
    
    const bytes = this.pipeline.canonicalize(payload, format);
    const content_hash = this.pipeline.hashCanonical(payload, format);
    
    return {
        value,
        bytes,
        content_hash
    };
  }
}
