import { ContentReference } from "./types.js";

export type ActorRole =
    | "EVOLUTION_AGENT"
    | "HUMAN_OPERATOR"
    | "SYSTEM_PROCESS"
    | "GOVERNANCE_REVIEWER";

export interface ActorReference {
    identity_ref: ContentReference;
    role: ActorRole;
}

export const SYSTEM_ACTOR: ActorReference = {
    identity_ref: {
        hash: "system-core-identity",
        artifact_type: "PLAN" // Placeholder type for system identity
    },
    role: "SYSTEM_PROCESS"
};
