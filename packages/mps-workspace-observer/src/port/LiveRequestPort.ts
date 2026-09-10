/**
 * WORKSPACE-LIFECYCLE-CONTROLLER-V1 — live process/filesystem port (test layer 3).
 *
 * Read-only is not free in Git, so every safety flag the frozen command surface mandates is applied
 * here and none of them is optional:
 *
 *   GIT_OPTIONAL_LOCKS=0        no optional lock is taken
 *   -c gc.auto=0                no background repack is triggered by a read
 *   -c core.quotepath=false     paths are not re-encoded behind our back
 *   -c core.fsmonitor=false     no filesystem-monitor daemon is launched
 *   -c core.longpaths=true      Windows long-path handling is explicit, not machine-dependent
 *   -c credential.helper=       the helper list is reset so no helper program runs
 *   -c credential.interactive=false, -c core.askPass=, GIT_TERMINAL_PROMPT=0,
 *   GIT_ASKPASS=, SSH_ASKPASS=, GCM_INTERACTIVE=never
 *                               every interactive path is closed, so the one network request
 *                               cannot block on a dialog that a process timeout could not kill
 *   -c protocol.version=2       remote output is not machine-dependent
 *   LC_ALL=C, LANG=C            message text is not locale-dependent
 *
 * The child environment is BUILT from an explicit allowlist plus the mandatory keys, never
 * inherited. That is not belt-and-braces: an inherited GIT_DIR, GIT_WORK_TREE, GIT_INDEX_FILE,
 * GIT_CONFIG or GIT_ALTERNATE_OBJECT_DIRECTORIES could retarget a command at another repository or
 * cause a write, and this port exists to observe a machine without touching it.
 *
 * Legacy `execFileSync('git', args)` helpers elsewhere in this repository lack all of the above and
 * are deliberately not reused (B2).
 */
import { spawn } from 'node:child_process';
import { lstat, open, readdir } from 'node:fs/promises';
import { realpath as realpathCallback } from 'node:fs';
import { promisify } from 'node:util';

import type {
  FilesystemRequest,
  ProcessRequest,
} from '../surface/CommandSurface.js';
import type {
  BytesField,
  DirectoryEntry,
  FilesystemResponse,
  ProcessResponse,
  RequestPort,
  RequestTiming,
} from './RequestPort.js';

/** processPolicy.environmentPolicy: the explicit host allowlist. Nothing else is passed through. */
const HOST_ENV_ALLOWLIST = Object.freeze([
  'SystemRoot',
  'SystemDrive',
  'windir',
  'PATH',
  'PATHEXT',
  'COMSPEC',
  'TEMP',
  'TMP',
  'USERPROFILE',
  'HOMEDRIVE',
  'HOMEPATH',
  'APPDATA',
  'LOCALAPPDATA',
  'PROGRAMDATA',
  'PROGRAMFILES',
  'ProgramFiles(x86)',
  'NUMBER_OF_PROCESSORS',
  'PROCESSOR_ARCHITECTURE',
  'OS',
]);

/** capturePolicy.outputLimit: 64 MiB per stream. */
const OUTPUT_LIMIT_BYTES = 67108864;

/**
 * filesystemPolicy.timeoutPoolRule. A timed-out filesystem operation cannot be cancelled, so after
 * three of them the port stops issuing new filesystem requests: everything after that would be a
 * pool-starvation artefact recorded as a genuine observation.
 */
const FS_TIMEOUT_ABORT_THRESHOLD = 3;

export class FilesystemPoolExhausted extends Error {
  readonly code = 'FS_TIMEOUT_POOL_EXHAUSTED';
  constructor(count: number) {
    super(
      `FS_TIMEOUT_POOL_EXHAUSTED: ${count} filesystem timeouts; further results would be pool-starvation artefacts`,
    );
    this.name = 'FilesystemPoolExhausted';
  }
}

/**
 * capturePolicy: bytes are recorded as utf8 when they are strictly valid UTF-8, otherwise base64.
 *
 * "Strictly" matters. Node's decoder substitutes U+FFFD for invalid sequences rather than failing,
 * so the only reliable test is to decode and re-encode and compare bytes.
 */
export function encodeBytes(buf: Buffer): BytesField {
  const text = buf.toString('utf8');
  if (Buffer.from(text, 'utf8').equals(buf)) return { encoding: 'utf8', data: text };
  return { encoding: 'base64', data: buf.toString('base64') };
}

function buildChildEnv(mandatory: Readonly<Record<string, string>>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of HOST_ENV_ALLOWLIST) {
    const v = process.env[key];
    if (v !== undefined) env[key] = v;
  }
  for (const [k, v] of Object.entries(mandatory)) env[k] = v;
  return env;
}

interface Clock {
  nowIso(): string;
  monotonicMs(): number;
}

/**
 * REALPATH_NATIVE is a separate recorded operation, and it must be the NATIVE one: the JavaScript
 * fallback normalises differently from the OS, and the surface names the native call.
 */
const realpathNative = promisify(realpathCallback.native);

const systemClock: Clock = {
  nowIso: () => new Date().toISOString(),
  monotonicMs: () => Number(process.hrtime.bigint() / 1000000n),
};

export class LiveRequestPort implements RequestPort {
  private readonly timings = new Map<string, RequestTiming>();
  private fsTimeouts = 0;

  readonly repoRoot: string;

  private readonly mandatoryEnvironment: Readonly<Record<string, string>>;

  constructor(
    options: {
      readonly repoRoot: string;
      /** Exactly processPolicy.mandatoryEnvironment from the frozen surface. */
      readonly mandatoryEnvironment: Readonly<Record<string, string>>;
    },
    private readonly clock: Clock = systemClock,
  ) {
    this.repoRoot = options.repoRoot;
    this.mandatoryEnvironment = options.mandatoryEnvironment;
  }

  async executeProcess(request: ProcessRequest): Promise<ProcessResponse> {
    const startedAt = this.clock.nowIso();
    const t0 = this.clock.monotonicMs();

    const response = await new Promise<ProcessResponse>((resolve) => {
      const child = spawn(request.executable, [...request.argv], {
        cwd: request.cwd,
        env: buildChildEnv(this.mandatoryEnvironment),
        windowsHide: true,
        // stdin is closed: a git that decides to prompt must fail, not wait.
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      const out: Buffer[] = [];
      const err: Buffer[] = [];
      let outBytes = 0;
      let errBytes = 0;
      let outLimited = false;
      let errLimited = false;
      let settled = false;

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        child.kill();
        // Partial bytes are retained: a timeout is raw evidence, not an absence of evidence.
        resolve({
          outcome: 'TIMEOUT',
          exitCode: null,
          signal: null,
          spawnErrorCode: null,
          stdout: encodeBytes(Buffer.concat(out)),
          stderr: encodeBytes(Buffer.concat(err)),
        });
      }, request.timeoutMs);

      child.stdout.on('data', (chunk: Buffer) => {
        if (outBytes >= OUTPUT_LIMIT_BYTES) {
          outLimited = true;
          return;
        }
        outBytes += chunk.length;
        out.push(chunk);
        if (outBytes > OUTPUT_LIMIT_BYTES) outLimited = true;
      });
      child.stderr.on('data', (chunk: Buffer) => {
        if (errBytes >= OUTPUT_LIMIT_BYTES) {
          errLimited = true;
          return;
        }
        errBytes += chunk.length;
        err.push(chunk);
        if (errBytes > OUTPUT_LIMIT_BYTES) errLimited = true;
      });

      child.on('error', (e: NodeJS.ErrnoException) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({
          outcome: 'SPAWN_ERROR',
          exitCode: null,
          signal: null,
          spawnErrorCode: e.code ?? 'UNKNOWN',
          stdout: encodeBytes(Buffer.concat(out)),
          stderr: encodeBytes(Buffer.concat(err)),
        });
      });

      child.on('close', (code, signal) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        // Exceeding the output limit is COMPLETED with a truncation note, never a spawn failure:
        // a truncated read must not be mistaken for a failed command.
        const truncation =
          outLimited || errLimited
            ? { rule: 'TR4_OUTPUT_LIMIT_EXCEEDED', limitBytes: OUTPUT_LIMIT_BYTES }
            : undefined;
        resolve({
          outcome: 'COMPLETED',
          exitCode: code,
          signal: signal ?? null,
          spawnErrorCode: null,
          stdout: encodeBytes(Buffer.concat(out)),
          stderr: encodeBytes(Buffer.concat(err)),
          truncation,
        });
      });
    });

    this.recordTiming(request.requestId, request.instanceKey, '', startedAt, t0);
    return response;
  }

  async executeFilesystem(request: FilesystemRequest): Promise<FilesystemResponse> {
    if (this.fsTimeouts >= FS_TIMEOUT_ABORT_THRESHOLD) {
      throw new FilesystemPoolExhausted(this.fsTimeouts);
    }
    const startedAt = this.clock.nowIso();
    const t0 = this.clock.monotonicMs();

    const timeoutMs = request.timeoutMs;
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<'TIMEOUT'>((resolve) => {
      timer = setTimeout(() => resolve('TIMEOUT'), timeoutMs);
    });

    let result: FilesystemResponse;
    try {
      const raced = await Promise.race([this.runFsOperation(request), timeout]);
      if (raced === 'TIMEOUT') {
        this.fsTimeouts += 1;
        result = { outcome: 'TIMEOUT', errorCode: 'FS_TIMEOUT' };
      } else {
        result = raced;
      }
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }

    this.recordTiming(request.requestId, request.instanceKey, request.opKey, startedAt, t0);
    return result;
  }

  private async runFsOperation(request: FilesystemRequest): Promise<FilesystemResponse> {
    try {
      switch (request.operation) {
        case 'LSTAT': {
          // lstat never follows a symlink and records the type: a .git symlink is a pointer file,
          // and resolving it here would erase the distinction the conflict table depends on.
          const st = await lstat(request.path);
          return {
            outcome: 'COMPLETED',
            errorCode: null,
            exists: true,
            type: st.isFile()
              ? 'file'
              : st.isDirectory()
                ? 'dir'
                : st.isSymbolicLink()
                  ? 'symlink'
                  : 'other',
            size: st.isFile() ? st.size : null,
            mtimeMs: Math.trunc(st.mtimeMs),
          };
        }
        case 'REALPATH_NATIVE': {
          const rp = await realpathNative(request.path);
          return { outcome: 'COMPLETED', errorCode: null, realpath: rp };
        }
        case 'READDIR_COUNT': {
          // Only the number of entries is recorded, never the names (RD5).
          const entries = await readdir(request.path);
          return { outcome: 'COMPLETED', errorCode: null, entryCount: entries.length };
        }
        case 'READDIR': {
          const dirents = await readdir(request.path, { withFileTypes: true });
          const listing = request.listing;
          // The frozen filter is applied HERE, exactly as the recorder applied it, so that a name
          // the policy says is never recorded never enters the ledger in the first place.
          const nameFilter =
            listing?.nameFilter === undefined || listing.nameFilter === null
              ? undefined
              : new RegExp(listing.nameFilter, listing.nameFilterFlags ?? '');
          const entries: DirectoryEntry[] = [];
          for (const d of dirents) {
            if (listing?.onlyDirectories === true && !d.isDirectory()) continue;
            if (listing?.filesOnly === true && !d.isFile()) continue;
            if (nameFilter !== undefined && !nameFilter.test(d.name)) continue;
            const type = d.isFile()
              ? 'file'
              : d.isDirectory()
                ? 'dir'
                : d.isSymbolicLink()
                  ? 'symlink'
                  : 'other';
            let size: number | null = null;
            let mtimeMs: number | null = null;
            try {
              const st = await lstat(`${request.path}\\${d.name}`);
              size = st.isFile() ? st.size : null;
              mtimeMs = Math.trunc(st.mtimeMs);
            } catch {
              // An entry that vanished between the listing and the stat is left with null
              // metadata rather than dropped: A3 forbids omitting an observation.
            }
            entries.push({ name: d.name, type, size, mtimeMs });
          }
          // Sorted by name with the ECMAScript default comparator, as the surface specifies.
          entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
          // Both counts are kept: the difference between them is the size of the filter's blind
          // spot, which the surface's acceptedLimitation requires to stay visible without recording
          // the names it hides.
          return {
            outcome: 'COMPLETED',
            errorCode: null,
            entries,
            totalEntryCount: dirents.length,
            matchedEntryCount: entries.length,
          };
        }
        case 'READ_FILE': {
          const maxBytes = request.maxBytes ?? 4096;
          const handle = await open(request.path, 'r');
          try {
            const st = await handle.stat();
            const buf = Buffer.alloc(Math.min(maxBytes, st.size));
            const { bytesRead } = await handle.read(buf, 0, buf.length, 0);
            return {
              outcome: 'COMPLETED',
              errorCode: null,
              exists: true,
              type: 'file',
              size: st.size,
              originalSize: st.size,
              truncated: st.size > maxBytes,
              content: encodeBytes(buf.subarray(0, bytesRead)),
            };
          } finally {
            await handle.close();
          }
        }
        default: {
          // Exhaustive by construction: the five operations are frozen and a sixth cannot be
          // silently tolerated.
          const never: never = request.operation;
          throw new Error(`unfrozen filesystem operation ${String(never)}`);
        }
      }
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code ?? 'UNKNOWN';
      // ENOENT and ENOTDIR are conclusive absences; EACCES, EPERM, ELOOP and ENAMETOOLONG are
      // inconclusive. The port records the code; interpreting it is the Observer's job, because
      // "conclusive" is an observation-state decision and belongs above this layer.
      return { outcome: 'ERROR', errorCode: code, exists: code === 'ENOENT' ? false : undefined };
    }
  }

  private recordTiming(
    requestId: string,
    instanceKey: string,
    opKey: string,
    startedAt: string,
    t0: number,
  ): void {
    const endedAt = this.clock.nowIso();
    this.timings.set(`${requestId} ${instanceKey} ${opKey}`, {
      startedAt,
      endedAt,
      durationMs: Math.max(0, this.clock.monotonicMs() - t0),
    });
  }

  timingFor(requestId: string, instanceKey: string, opKey: string): RequestTiming | undefined {
    return this.timings.get(`${requestId} ${instanceKey} ${opKey}`);
  }

  /** Every timing this port measured, in the corpus metadata's own key format. */
  get allTimings(): ReadonlyMap<string, RequestTiming> {
    return this.timings;
  }

  get filesystemTimeoutCount(): number {
    return this.fsTimeouts;
  }
}
