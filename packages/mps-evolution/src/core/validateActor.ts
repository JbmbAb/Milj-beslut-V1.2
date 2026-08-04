import { ActorReference, ActorRole } from "./ActorReference.js";

const VALID_ROLES: Set<string> = new Set([
    "EVOLUTION_AGENT",
    "HUMAN_OPERATOR",
    "SYSTEM_PROCESS",
    "GOVERNANCE_REVIEWER"
]);

export function validateActor(actor: any): asserts actor is ActorReference {
    if (!actor || typeof actor !== "object") {
        throw new Error("INVALID_ACTOR_FORMAT");
    }

    if (!VALID_ROLES.has(actor.role)) {
        throw new Error(`UNKNOWN_ACTOR_ROLE: ${actor.role}`);
    }

    if (!actor.identity_ref || !actor.identity_ref.hash) {
        throw new Error("ACTOR_IDENTITY_REQUIRED");
    }
}
