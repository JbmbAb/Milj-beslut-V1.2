import { ContentReference } from "../core/types.js";

export interface PromotionRequest {
    candidate_ref: ContentReference;
    evaluation_ref: ContentReference;
    constraints_ref: ContentReference;
}
