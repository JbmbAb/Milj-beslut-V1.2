import { ProvenanceBuilder } from "./ProvenanceBuilder";

export interface ProvenanceBuilderFactory {
  create(): ProvenanceBuilder;
}
