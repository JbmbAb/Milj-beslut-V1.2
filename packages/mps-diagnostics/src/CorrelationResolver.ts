/**
 * Package 22.4 — CorrelationResolver
 * Builds search paths only — does NOT create truth or mutate identity.
 * @see ADR-MPS-022 / F22-7
 */

import {
  CorrelationError,
  createCorrelationContext,
  type CorrelationContext,
  type CorrelationLink,
} from "./CorrelationContext.js";

export interface CorrelationResolver {
  findExecution(request_id: string): string | undefined;
  findArtifacts(execution_id: string): readonly string[];
  findEvents(execution_id: string): readonly number[];
  findLedgerSequence(execution_id: string): number | undefined;
  findTraceRoot(request_id: string): string | undefined;
  /** Assemble full navigation context for a request (references only). */
  resolve(request_id: string): CorrelationContext | undefined;
}

type ExecutionIndex = {
  request_id: string;
  event_sequences: Set<number>;
  artifact_hashes: Set<string>;
  ledger_sequence?: number;
  trace_root_id?: string;
};

/**
 * In-memory correlation index for Diagnostic Governance navigation.
 * Append-only link registration; never recomputes hashes or invents evidence.
 */
export class InMemoryCorrelationResolver implements CorrelationResolver {
  private readonly requestToExecution = new Map<string, string>();
  private readonly byExecution = new Map<string, ExecutionIndex>();

  /**
   * Register a navigation link observed from EventLog / FailureArtifact / ledger.
   * Idempotent for the same references; refuses conflicting request→execution mapping.
   */
  register(link: CorrelationLink): void {
    if (!link.request_id || !link.execution_id) {
      throw new CorrelationError(
        "MPS-DIAG-CORR-LINK-INVALID",
        "CorrelationLink requires request_id and execution_id",
      );
    }

    const existingExec = this.requestToExecution.get(link.request_id);
    if (existingExec && existingExec !== link.execution_id) {
      throw new CorrelationError(
        "MPS-DIAG-CORR-REQUEST-CONFLICT",
        `request_id ${link.request_id} already mapped to ${existingExec}`,
      );
    }
    this.requestToExecution.set(link.request_id, link.execution_id);

    let idx = this.byExecution.get(link.execution_id);
    if (!idx) {
      idx = {
        request_id: link.request_id,
        event_sequences: new Set(),
        artifact_hashes: new Set(),
      };
      this.byExecution.set(link.execution_id, idx);
    } else if (idx.request_id !== link.request_id) {
      throw new CorrelationError(
        "MPS-DIAG-CORR-EXEC-CONFLICT",
        `execution_id ${link.execution_id} already mapped to ${idx.request_id}`,
      );
    }

    if (link.event_sequence !== undefined) {
      idx.event_sequences.add(link.event_sequence);
    }
    if (link.artifact_hash) {
      idx.artifact_hashes.add(link.artifact_hash);
    }
    if (link.ledger_sequence !== undefined) {
      idx.ledger_sequence = link.ledger_sequence;
    }
    if (link.trace_root_id) {
      idx.trace_root_id = link.trace_root_id;
    }
  }

  findExecution(request_id: string): string | undefined {
    return this.requestToExecution.get(request_id);
  }

  findArtifacts(execution_id: string): readonly string[] {
    const idx = this.byExecution.get(execution_id);
    if (!idx) return [];
    return Object.freeze([...idx.artifact_hashes].sort()) as readonly string[];
  }

  findEvents(execution_id: string): readonly number[] {
    const idx = this.byExecution.get(execution_id);
    if (!idx) return [];
    return Object.freeze(
      [...idx.event_sequences].sort((a, b) => a - b),
    ) as readonly number[];
  }

  findLedgerSequence(execution_id: string): number | undefined {
    return this.byExecution.get(execution_id)?.ledger_sequence;
  }

  findTraceRoot(request_id: string): string | undefined {
    const execution_id = this.findExecution(request_id);
    if (!execution_id) return undefined;
    return this.byExecution.get(execution_id)?.trace_root_id;
  }

  resolve(request_id: string): CorrelationContext | undefined {
    const execution_id = this.findExecution(request_id);
    if (!execution_id) return undefined;
    const idx = this.byExecution.get(execution_id);
    if (!idx) return undefined;

    const sequences = [...idx.event_sequences].sort((a, b) => a - b);
    return createCorrelationContext({
      request_id,
      execution_id,
      event_sequence: sequences.length > 0 ? sequences[sequences.length - 1] : undefined,
      artifact_hashes: [...idx.artifact_hashes].sort(),
      ledger_sequence: idx.ledger_sequence,
      trace_root_id: idx.trace_root_id,
    });
  }
}
