import { ContentReference } from "../core/types.js";
import { ShadowEvaluationArtifact } from "./ShadowEvaluationArtifact.js";

export interface ShadowEvaluator {
    evaluate(
        candidate: ContentReference,
        baseline: ContentReference
    ): Promise<ShadowEvaluationArtifact>;
}
