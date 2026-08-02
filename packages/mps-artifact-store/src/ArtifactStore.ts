import type { ContentReference } from '@miljobeslut/mps-core';

export interface ArtifactStore {
  get<T>(reference: ContentReference): Promise<T>;
  put<TEnvelope>(envelope: TEnvelope): Promise<any>;
  has(reference: ContentReference): Promise<boolean>;
}
