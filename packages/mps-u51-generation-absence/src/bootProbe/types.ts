/**
 * Shapes shared by the boot-probe preload and the parent harness.
 * No IO. The registration identifier is intentionally absent from this file.
 */

export const REQUIRED_ISOLATION_HOOKS = ['socket.connect', 'server.listen', 'process.spawn', 'fs.write', 'fs.env', 'dns.external'] as const;

export type IsolationHook = (typeof REQUIRED_ISOLATION_HOOKS)[number];

export interface IsolationReport {
  readonly armed: boolean;
  readonly hooks: readonly string[];
  readonly connect_attempts: number;
  readonly listen_attempts: number;
  readonly spawn_attempts: number;
  readonly refused_writes: number;
  readonly dns_external_attempts: number;
}

export interface GenerateAttemptReport {
  readonly outcome: string;
  readonly code?: string;
}

/** What the child writes. The parent trusts it only together with the nonce and the argv it spawned. */
export interface ChildReport {
  readonly nonce: string;
  readonly entry_id: string;
  readonly node_env: string;
  readonly registered_after_boot: boolean;
  readonly generate_attempt: GenerateAttemptReport;
  readonly isolation: IsolationReport;
  readonly subject_commit: string;
  readonly subject_tree: string;
  readonly loaded_entry: string;
  readonly stop_kind: string;
  readonly stop_message: string;
}

export interface DerivedProbeEntry {
  readonly id: string;
  readonly role: 'web' | 'worker';
  readonly argv: readonly string[];
  readonly entry_file: string;
}
