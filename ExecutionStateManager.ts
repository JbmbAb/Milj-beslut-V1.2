import { ExecutionState, ExecutionStatus } from './ExecutionState';
import { RegistryReference } from '../types';

export interface ExecutionStateManager {
  get(executionId: string): Promise<ExecutionState | null>;
  create(manifest: ExecutionManifest): Promise<ExecutionState>;
  updateStatus(
    executionId: string,
    newStatus: ExecutionStatus,
    currentStep?: string,
  ): Promise<ExecutionState>;
  addCheckpoint(executionId: string, checkpointRef: RegistryReference): Promise<ExecutionState>;
}

export class InMemoryExecutionStateManager implements ExecutionStateManager {
  private states = new Map<string, ExecutionState>();

  async get(executionId: string): Promise<ExecutionState | null> {
    return this.states.get(executionId) ?? null;
  }
  async create(manifest: ExecutionManifest): Promise<ExecutionState> {
    /* ... */ throw new Error('Not implemented');
  }
  async updateStatus(
    executionId: string,
    newStatus: ExecutionStatus,
    currentStep?: string,
  ): Promise<ExecutionState> {
    /* ... */ throw new Error('Not implemented');
  }
  async addCheckpoint(executionId: string, checkpointRef: RegistryReference): Promise<ExecutionState> {
    /* ... */ throw new Error('Not implemented');
  }
}
