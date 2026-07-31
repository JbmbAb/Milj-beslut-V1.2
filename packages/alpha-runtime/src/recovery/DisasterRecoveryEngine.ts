import { RecoveryPoint, RecoveryResult } from "./RecoveryTypes";
import { RecoveryContext } from "./RecoveryContext";

export interface DisasterRecoveryEngine {
  findLatestTrustedSnapshot(): Promise<RecoveryPoint | null>;
  restore(context: RecoveryContext): Promise<RecoveryResult>;
}
