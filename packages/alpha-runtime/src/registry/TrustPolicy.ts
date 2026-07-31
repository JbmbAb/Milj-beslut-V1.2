export interface TrustPolicy {
  requireSignature: boolean;
  requireProvenance: boolean;
  requireSchemaValidation: boolean;
  allowedOperations: Array<
    "created" | "mutated" | "promoted" | "deprecated" | "restored"
  >;
}
