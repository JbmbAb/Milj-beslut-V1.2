/**
 * WORKSPACE-LIFECYCLE-CONTROLLER-V1 — the Observer's only I/O boundary.
 *
 * Three test layers run the SAME Observer against three different implementations of this port:
 *
 *   raw transcript -> Observer   the replay transport (CI, any OS)
 *   snapshot       -> Classifier no port at all; the Classifier is pure
 *   live disk      -> Observer   the process/OS port (target machine only)
 *
 * The port answers exactly what a live process or filesystem call would have returned, including
 * failures. It never invents a response, and it never hands back a transport failure code as data:
 * NOT_IN_CORPUS, NOT_CAPTURED_BY_PRECONDITION and REQUEST_OUTSIDE_COMMAND_SURFACE are raised out of
 * band and abort the run before a snapshot exists. That is the whole point — an Observer that could
 * receive "no recording" as a value would emit UNKNOWN for a workspace it never observed, classify
 * as BLOCKED, and look correctly fail-closed while being starved of data (A4).
 *
 * Conversely, a recorded TIMEOUT, SPAWN_ERROR or non-zero exit IS data and is replayed as such.
 * Deriving UNKNOWN from those is the Observer's job, not the port's.
 */
import type { FilesystemRequest, ProcessRequest } from '../surface/CommandSurface.js';

/**
 * Captured bytes. `utf8` when the bytes are strictly valid UTF-8, otherwise `base64`.
 *
 * The Observer must handle both: parsing base64 stdout as text would silently produce a wrong
 * observation rather than an inconclusive one.
 */
export interface BytesField {
  readonly encoding: 'utf8' | 'base64';
  readonly data: string;
}

export interface TruncationInfo {
  readonly rule: string;
  readonly [k: string]: unknown;
}

export interface ProcessResponse {
  readonly outcome: 'COMPLETED' | 'TIMEOUT' | 'SPAWN_ERROR';
  readonly exitCode: number | null;
  readonly signal: string | null;
  readonly spawnErrorCode: string | null;
  readonly stdout: BytesField;
  readonly stderr: BytesField;
  /** Present when TR1, TR2 or the 64 MiB output limit applied; carries the preserved counts. */
  readonly truncation?: TruncationInfo;
}

export interface DirectoryEntry {
  readonly name: string;
  readonly type: 'file' | 'dir' | 'symlink' | 'other';
  readonly size?: number | null;
  readonly mtimeMs?: number | null;
}

export interface FilesystemResponse {
  readonly outcome: 'COMPLETED' | 'TIMEOUT' | 'ERROR';
  readonly errorCode?: string | null;
  readonly exists?: boolean;
  readonly type?: 'file' | 'dir' | 'symlink' | 'other' | null;
  readonly size?: number | null;
  readonly mtimeMs?: number | null;
  readonly realpath?: string | null;
  readonly entries?: readonly DirectoryEntry[];
  /** Unfiltered size of the listing, so the size of a name-filter blind spot stays visible. */
  readonly totalEntryCount?: number;
  readonly matchedEntryCount?: number;
  /** READDIR_COUNT records only the number of entries, never their names. */
  readonly entryCount?: number;
  readonly content?: BytesField;
  readonly truncated?: boolean;
  readonly originalSize?: number;
}

/**
 * Timing for one recorded request, supplied by the port rather than read from a clock.
 *
 * The Observer has no clock of its own: A9 keeps observedAt and durations out of the identity
 * digest precisely so that re-observing an untouched machine reproduces the digest, and A16 still
 * requires an observationWindow. Both hold only if the window comes from the same source as the
 * observations. In replay that source is the corpus metadata; live, it is the port's own measurement.
 */
export interface RequestTiming {
  readonly startedAt: string;
  readonly endedAt: string;
  readonly durationMs: number;
}

export interface RequestPort {
  /**
   * The repository root the Observer was given. Every process request runs with this cwd, and the
   * transport rejects any other (cwdPolicy).
   */
  readonly repoRoot: string;

  executeProcess(request: ProcessRequest): Promise<ProcessResponse>;

  executeFilesystem(request: FilesystemRequest): Promise<FilesystemResponse>;

  /**
   * Timing for the most recently answered request, keyed by the same triple the corpus uses.
   * Returns undefined when the port has no timing source, in which case the Observer records the
   * observation window as unavailable rather than inventing one.
   */
  timingFor(requestId: string, instanceKey: string, opKey: string): RequestTiming | undefined;
}
