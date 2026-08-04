import { ContentReference, ActorReference } from "../types.js";

// Session är mutable runtime state - INTE en artifact
export interface ReviewSession {
    session_id: string;
    artifact_ref: ContentReference;
    opened_at: string;
    active_user: ActorReference;
}
