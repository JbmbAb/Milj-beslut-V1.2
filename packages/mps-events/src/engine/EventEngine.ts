import { ContentReference } from "@miljobeslut/mps-evolution";
import { EventArtifact } from "../contracts/EventArtifact.js";

export interface EventEngine {
  createEvent(
    event_key: string,
    event_version: string,
    subject_ref: ContentReference,
    payload_ref: ContentReference
  ): Promise<EventArtifact>;
}
