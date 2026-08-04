import { ContentReference } from "@miljobeslut/mps-evolution/src/core/types.js";

export interface CapabilityViewModel {
    id: string;
    name: string;
    description: string;
    version: string;
    status: "AVAILABLE" | "DEPRECATED";
    inputs: { name: string; type: string }[];
    outputs: { name: string; type: string }[];
    definition_ref: ContentReference;
}
