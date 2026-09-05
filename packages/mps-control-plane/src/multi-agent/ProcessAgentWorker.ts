import { spawn } from "node:child_process";

import { parseAgentHandoff } from "./AgentHandoffCodec";
import { FileAgentMailbox } from "./FileAgentMailbox";
import type { AgentHandoff } from "./types";
import type { AgentWorkItem } from "./Ports";

export interface AgentHandoffSink {
  accept(handoff: AgentHandoff): Promise<void>;
}

export interface AgentProcessProfile {
  readonly command: string;
  readonly args?: readonly string[];
  readonly cwd?: string;
  readonly inheritEnv?: readonly string[];
  readonly env?: Readonly<Record<string, string>>;
  readonly timeoutMs?: number;
  readonly maxOutputBytes?: number;
}

export interface AgentProcessExecutor {
  execute(work: AgentWorkItem): Promise<string>;
}

function safeBaseEnv(): Record<string, string> {
  const names = ["PATH", "HOME", "USERPROFILE", "TEMP", "TMP", "SystemRoot", "COMSPEC"];
  return Object.fromEntries(
    names.flatMap((name) => (process.env[name] ? [[name, process.env[name] as string]] : [])),
  );
}

export class ChildProcessAgentExecutor implements AgentProcessExecutor {
  constructor(private readonly profiles: Readonly<Record<AgentWorkItem["role"], AgentProcessProfile>>) {}

  execute(work: AgentWorkItem): Promise<string> {
    const profile = this.profiles[work.role];
    if (!profile) return Promise.reject(new Error(`no process profile for role ${work.role}`));

    const env = safeBaseEnv();
    for (const name of profile.inheritEnv ?? []) {
      const value = process.env[name];
      if (value !== undefined) env[name] = value;
    }
    Object.assign(env, profile.env ?? {});

    const envelope = {
      schema_version: "multi-agent-work-item-v1",
      dispatch_key: work.dispatchKey,
      role: work.role,
      verification_mode: work.verificationMode ?? null,
      reason: work.reason,
      unit: work.unit,
      output_contract: {
        format: "JSON_ONLY",
        schema_version: "multi-agent-handoff-v1",
        requirement:
          "Return exactly one JSON object matching the handoff schema. Do not wrap it in markdown or prose.",
      },
    };

    return new Promise((resolve, reject) => {
      const child = spawn(profile.command, [...(profile.args ?? [])], {
        cwd: profile.cwd,
        env,
        shell: false,
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      });
      let stdout = "";
      let stderr = "";
      const limit = profile.maxOutputBytes ?? 4 * 1024 * 1024;
      const timeout = setTimeout(() => {
        child.kill("SIGTERM");
        reject(new Error(`agent process timed out after ${profile.timeoutMs ?? 30 * 60_000}ms`));
      }, profile.timeoutMs ?? 30 * 60_000);

      const append = (current: string, chunk: Buffer): string => {
        const next = current + chunk.toString("utf8");
        if (Buffer.byteLength(next, "utf8") > limit) {
          child.kill("SIGTERM");
          throw new Error(`agent process output exceeded ${limit} bytes`);
        }
        return next;
      };

      child.stdout.on("data", (chunk: Buffer) => {
        try { stdout = append(stdout, chunk); } catch (error) { reject(error); }
      });
      child.stderr.on("data", (chunk: Buffer) => {
        try { stderr = append(stderr, chunk); } catch (error) { reject(error); }
      });
      child.on("error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      child.on("close", (code) => {
        clearTimeout(timeout);
        if (code !== 0) {
          reject(new Error(`agent process exited ${code}: ${stderr.trim().slice(-2000)}`));
          return;
        }
        resolve(stdout);
      });
      child.stdin.end(`${JSON.stringify(envelope)}\n`);
    });
  }
}

export interface ProcessAgentWorkerOptions {
  readonly workerId: string;
  readonly role: AgentWorkItem["role"];
  readonly maxAttempts?: number;
  readonly leaseMs?: number;
  readonly now?: () => Date;
}

export class ProcessAgentWorker {
  private readonly maxAttempts: number;
  private readonly leaseMs: number;
  private readonly now: () => Date;

  constructor(
    private readonly mailbox: FileAgentMailbox,
    private readonly executor: AgentProcessExecutor,
    private readonly sink: AgentHandoffSink,
    private readonly options: ProcessAgentWorkerOptions,
  ) {
    this.maxAttempts = options.maxAttempts ?? 3;
    this.leaseMs = options.leaseMs ?? 15 * 60_000;
    this.now = options.now ?? (() => new Date());
  }

  async runOnce(): Promise<"IDLE" | "COMPLETED" | "RETRY" | "DEAD_LETTER"> {
    const record = this.mailbox.reserve(
      this.options.role,
      this.options.workerId,
      this.now(),
      this.leaseMs,
    );
    if (!record) return "IDLE";

    try {
      const raw = await this.executor.execute(record.item);
      const handoff = parseAgentHandoff(raw, record.item);
      await this.sink.accept(handoff);
      this.mailbox.complete(record.dispatchKey, this.options.workerId);
      return "COMPLETED";
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (record.attempts >= this.maxAttempts) {
        this.mailbox.deadLetter(record.dispatchKey, this.options.workerId, message);
        return "DEAD_LETTER";
      }
      this.mailbox.release(record.dispatchKey, this.options.workerId, message);
      return "RETRY";
    }
  }
}
