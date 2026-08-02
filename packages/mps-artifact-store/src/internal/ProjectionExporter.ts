import { ArtifactExporter, ArtifactResolver } from '../contracts/index.js';
import { ArtifactReference } from '../types/ArtifactReference.js';

export class ProjectionExporter implements ArtifactExporter {
  constructor(private readonly resolver: ArtifactResolver) {}
  async export(ref: ArtifactReference): Promise<any> { return {}; }
}