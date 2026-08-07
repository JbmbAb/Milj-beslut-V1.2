/**
 * Package 22.2 — FailureArtifactBuilder
 * Separates identity inputs from metadata before hashing.
 */

import {
  createFailureArtifact,
  type FailureArtifact,
  type FailureArtifactReference,
  toFailureArtifactReference,
} from "./FailureArtifact.js";
import type {
  DiagnosticArtifactReference,
  DiagnosticContentReference,
  ExecutionStage,
  Timestamp,
} from "./types.js";

export class FailureArtifactBuilder {
  private failure_code?: string;
  private stage?: ExecutionStage;
  private execution_id?: string;
  private input_refs: DiagnosticContentReference[] = [];
  private evidence_refs: DiagnosticArtifactReference[] = [];
  private failed_controls: string[] = [];
  private diagnostics: unknown = {};
  private created_at?: Timestamp;
  private host?: string;
  private runtime_version?: string;
  private request_id?: string;

  withFailureCode(code: string): this {
    this.failure_code = code;
    return this;
  }

  withStage(stage: ExecutionStage): this {
    this.stage = stage;
    return this;
  }

  withExecutionId(execution_id: string): this {
    this.execution_id = execution_id;
    return this;
  }

  withInputRefs(refs: readonly DiagnosticContentReference[]): this {
    this.input_refs = [...refs];
    return this;
  }

  addInputRef(ref: DiagnosticContentReference): this {
    this.input_refs.push(ref);
    return this;
  }

  withEvidenceRefs(refs: readonly DiagnosticArtifactReference[]): this {
    this.evidence_refs = [...refs];
    return this;
  }

  addEvidenceRef(ref: DiagnosticArtifactReference): this {
    this.evidence_refs.push(ref);
    return this;
  }

  withFailedControls(controls: readonly string[]): this {
    this.failed_controls = [...controls];
    return this;
  }

  withDiagnostics(diagnostics: unknown): this {
    this.diagnostics = diagnostics;
    return this;
  }

  withCreatedAt(created_at: Timestamp): this {
    this.created_at = created_at;
    return this;
  }

  withHost(host: string): this {
    this.host = host;
    return this;
  }

  withRuntimeVersion(runtime_version: string): this {
    this.runtime_version = runtime_version;
    return this;
  }

  withRequestId(request_id: string): this {
    this.request_id = request_id;
    return this;
  }

  build(): FailureArtifact {
    if (!this.failure_code) throw new Error("FailureArtifactBuilder: failure_code required");
    if (!this.stage) throw new Error("FailureArtifactBuilder: stage required");
    if (!this.execution_id) throw new Error("FailureArtifactBuilder: execution_id required");
    if (!this.created_at) throw new Error("FailureArtifactBuilder: created_at required");

    return createFailureArtifact({
      failure_code: this.failure_code,
      stage: this.stage,
      execution_id: this.execution_id,
      input_refs: this.input_refs,
      evidence_refs: this.evidence_refs,
      failed_controls: this.failed_controls,
      diagnostics: this.diagnostics,
      created_at: this.created_at,
      host: this.host,
      runtime_version: this.runtime_version,
      request_id: this.request_id,
    });
  }

  buildReference(): FailureArtifactReference {
    return toFailureArtifactReference(this.build());
  }
}
