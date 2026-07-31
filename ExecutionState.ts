import { RegistryReference } from '../types';
import { ExecutionManifest } from '../identity/ExecutionManifest';

export type ExecutionStatus =
  | 'PLANNED'
  | 'VERIFIED'
  | 'ADMITTED'
  | 'EXECUTING'
  | 'VERIFYING'
  | 'COMPLETED'
  | 'FAILED'
  | 'REPLANNING'
  | 'COMPENSATING'
  | 'COMPENSATED'
  | 'HUMAN_APPROVAL';

export interface ExecutionState {
  execution_id: string;
  manifest_ref: RegistryReference; // Reference to the content-addressed ExecutionManifest
  status: ExecutionStatus;
  current_step?: string;
  started_at: string;
  updated_at: string;
  checkpoints: RegistryReference[]; // References to artifacts representing intermediate results
}
