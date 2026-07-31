import { RegistryReference } from "../types";

export interface RecoveryContext {
  recovery_id: string;
  actor: RegistryReference;
  requested_at: string;
}
