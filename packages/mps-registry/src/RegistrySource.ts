import type { ContentReference } from "@miljobeslut/mps-core";

export interface RegistrySource {
  list(): Promise<readonly ContentReference[]>;
  load(reference: ContentReference): Promise<unknown>;
}
