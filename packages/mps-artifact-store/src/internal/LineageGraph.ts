import { ArtifactLineage, ArtifactResolver } from '../contracts/index.js';
import { ArtifactReference } from '../types/ArtifactReference.js';

export class DeterministicLineageGraph implements ArtifactLineage {
  constructor(private readonly resolver: ArtifactResolver) {}

  async parents(ref: ArtifactReference): Promise<ArtifactReference[]> { return []; }
  async children(ref: ArtifactReference): Promise<ArtifactReference[]> { return []; }
  async ancestors(ref: ArtifactReference): Promise<ArtifactReference[]> { return []; }
  async descendants(ref: ArtifactReference[]): Promise<ArtifactReference[]> { return []; }
}