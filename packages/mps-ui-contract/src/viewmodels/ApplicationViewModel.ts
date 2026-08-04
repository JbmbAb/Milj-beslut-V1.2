import { ContentReference } from "@miljobeslut/mps-evolution/src/core/types.js";

export interface ApplicationViewModel {
    id: string;
    title: string;
    family: "REPORT" | "ANALYSIS" | "SCENARIO" | "EXPORT";
    generated_at: string;
    data: any; // presentation data
    artifact_ref: ContentReference;
}
