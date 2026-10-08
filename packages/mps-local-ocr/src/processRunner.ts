import { spawn as nodeSpawn, type ChildProcess } from "node:child_process";

export interface ProcessRunResult {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stderr: string;
  readonly stdout: string;
  readonly timedOut: boolean;
  readonly spawnError?: string;
}

export interface SpawnOptions {
  readonly cwd?: string;
}

export type SpawnFn = (
  command: string,
  args: readonly string[],
  options: SpawnOptions,
) => ChildProcess;

export const PROCESS_SPAWN_OPTIONS = {
  shell: false as const,
  windowsHide: true,
  stdio: ["ignore", "pipe", "pipe"] as ["ignore", "pipe", "pipe"],
};

export function defaultSpawn(
  command: string,
  args: readonly string[],
  options: SpawnOptions,
): ChildProcess {
  return nodeSpawn(command, [...args], {
    cwd: options.cwd,
    shell: PROCESS_SPAWN_OPTIONS.shell,
    windowsHide: PROCESS_SPAWN_OPTIONS.windowsHide,
    stdio: PROCESS_SPAWN_OPTIONS.stdio,
  });
}

export function runProcess(
  spawnFn: SpawnFn,
  command: string,
  args: readonly string[],
  options: { readonly cwd?: string; readonly timeoutMs: number; readonly maxCaptureBytes: number },
): Promise<ProcessRunResult> {
  return new Promise((resolve) => {
    let child: ChildProcess;
    try {
      child = spawnFn(command, args, { cwd: options.cwd });
    } catch (err) {
      resolve({
        code: null,
        signal: null,
        stderr: "",
        stdout: "",
        timedOut: false,
        spawnError: err instanceof Error ? err.message : String(err),
      });
      return;
    }

    const stderrChunks: Buffer[] = [];
    const stdoutChunks: Buffer[] = [];
    let stderrLen = 0;
    let stdoutLen = 0;
    let settled = false;

    const finish = (result: ProcessRunResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        // The process may already be gone. The timeout result still stands.
      }
      child.unref?.();
      finish({
        code: null,
        signal: null,
        stderr: Buffer.concat(stderrChunks).toString("utf8"),
        stdout: Buffer.concat(stdoutChunks).toString("utf8"),
        timedOut: true,
      });
    }, options.timeoutMs);

    const push = (chunks: Buffer[], current: number, chunk: Buffer): number => {
      if (current >= options.maxCaptureBytes) return current;
      const room = options.maxCaptureBytes - current;
      const slice = chunk.length > room ? chunk.subarray(0, room) : chunk;
      chunks.push(slice);
      return current + slice.length;
    };

    child.stdout?.on("data", (chunk: Buffer) => {
      stdoutLen = push(stdoutChunks, stdoutLen, chunk);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderrLen = push(stderrChunks, stderrLen, chunk);
    });

    child.on("error", (err) => {
      finish({
        code: null,
        signal: null,
        stderr: Buffer.concat(stderrChunks).toString("utf8"),
        stdout: Buffer.concat(stdoutChunks).toString("utf8"),
        timedOut: false,
        spawnError: err.message,
      });
    });

    child.on("exit", (code, signal) => {
      finish({
        code,
        signal,
        stderr: Buffer.concat(stderrChunks).toString("utf8"),
        stdout: Buffer.concat(stdoutChunks).toString("utf8"),
        timedOut: false,
      });
    });
  });
}
