import { ContentReference } from "@miljobeslut/mps-evolution";
import { ApprovalProvenance } from "./ApprovalProvenance.js";

export interface DecisionProvenance extends ApprovalProvenance {
  readonly approval_ref: ContentReference;
}
