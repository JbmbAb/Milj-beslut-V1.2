/**
 * TELEMETRY — DIAGNOSTIC OBSERVATION ONLY. NEVER AUTHORITY.
 *
 * Everything in this file describes what the control plane *saw* on a remote
 * system. Nothing in this file may ever authorize a state advance.
 *
 * A GitHub commit status is a repository-scoped, shared, mutable label. Any
 * actor with repo write access — human, bot, App, or a compromised producer
 * agent — can POST an arbitrary `context` + `state: success` onto an arbitrary
 * SHA. It carries no proof of who executed what, against which unit revision,
 * in which workflow run. It is therefore useful for dashboards and for
 * explaining *why* the controller is waiting, and useless as evidence that a
 * DEV-GOV gate actually passed.
 *
 * The naming here is deliberate and load-bearing. These types are called
 * observations, never proofs or results, so that a future caller cannot reach
 * for one of them believing it carries authority. The authority-bearing
 * counterpart lives in `DevGovAuthoritativeProof.ts` and is the only thing the
 * reconciler will accept as a basis for a gate-complete proposal.
 *
 * Directional rule enforced by `DevGovReconciler`:
 *   telemetry and remote observations may DENY or explain; only an
 *   authoritative proof may AUTHORIZE.
 */

export type TelemetryStatusState = 'success' | 'failure' | 'error' | 'pending';

/**
 * One commit-status reading, recorded verbatim for audit/diagnostics.
 *
 * `creatorLogin` and `targetUrl` are retained precisely because they are the
 * fields a spoofed status would carry; keeping them makes a hostile status
 * legible in the audit trail. They are never consulted to grant anything —
 * a status from the "right" actor pointing at the "right" URL is still not
 * proof, so there is deliberately no allow-list on either field.
 */
export interface TelemetryStatusObservation {
  readonly context: string;
  readonly state: TelemetryStatusState;
  readonly targetUrl?: string;
  readonly creatorLogin?: string;
  readonly observedAt?: string;
}

/**
 * Optional diagnostic port. The reconciler works fully without it; when it is
 * absent no behaviour changes, which is itself the clearest statement that no
 * decision depends on it.
 */
export interface DevGovTelemetryStatusPort {
  observeStatus(sha: string, context: string): Promise<TelemetryStatusObservation | undefined>;
}

/**
 * Remote execution facts (a workflow run's own reported status/conclusion).
 *
 * Same rule: this may only ever narrow what is acceptable. A run that GitHub
 * reports as failed can veto a proof that claims success; a run GitHub reports
 * as successful authorizes nothing on its own, because "a run succeeded" is not
 * "this unit's gate proof passed for this exact candidate and revision".
 */
export interface RemoteExecutionObservation {
  readonly workflow: string;
  readonly runId: string;
  readonly status: 'queued' | 'in_progress' | 'completed';
  readonly conclusion?: 'success' | 'failure' | 'cancelled' | 'timed_out' | 'action_required' | null;
}
