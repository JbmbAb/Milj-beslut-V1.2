import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { AgentDispatchPort, AgentWorkItem } from "./Ports";

export interface AgentMailboxRecord {
  readonly dispatchKey: string;
  readonly dispatchId: string;
  readonly item: AgentWorkItem;
  readonly status: "PENDING" | "LEASED" | "COMPLETED";
  readonly leasedBy?: string;
  readonly leasedAt?: string;
}

interface MailboxFile {
  readonly schemaVersion: "multi-agent-agent-mailbox-v1";
  readonly records: readonly AgentMailboxRecord[];
}

const EMPTY: MailboxFile = { schemaVersion: "multi-agent-agent-mailbox-v1", records: [] };

export class AgentMailboxConflictError extends Error {}

export class FileAgentMailbox implements AgentDispatchPort {
  constructor(private readonly filePath: string) {}

  async dispatch(item: AgentWorkItem): Promise<string> {
    const box = this.read();
    const existing = box.records.find((record) => record.dispatchKey === item.dispatchKey);
    if (existing) {
      if (JSON.stringify(existing.item) !== JSON.stringify(item)) {
        throw new AgentMailboxConflictError(
          `dispatch key ${item.dispatchKey} already exists with different agent work`,
        );
      }
      return existing.dispatchId;
    }

    const dispatchId = `agent-mailbox:${item.dispatchKey}`;
    this.write({
      ...box,
      records: [...box.records, { dispatchKey: item.dispatchKey, dispatchId, item, status: "PENDING" }],
    });
    return dispatchId;
  }

  reserve(role: AgentWorkItem["role"], workerId: string, now = new Date()): AgentMailboxRecord | undefined {
    const box = this.read();
    const index = box.records.findIndex(
      (record) => record.status === "PENDING" && record.item.role === role,
    );
    if (index < 0) return undefined;
    const record: AgentMailboxRecord = {
      ...box.records[index],
      status: "LEASED",
      leasedBy: workerId,
      leasedAt: now.toISOString(),
    };
    const records = [...box.records];
    records[index] = record;
    this.write({ ...box, records });
    return record;
  }

  complete(dispatchKey: string, workerId: string): void {
    const box = this.read();
    const index = box.records.findIndex((record) => record.dispatchKey === dispatchKey);
    if (index < 0) throw new AgentMailboxConflictError(`unknown dispatch key ${dispatchKey}`);
    const current = box.records[index];
    if (current.status === "COMPLETED") return;
    if (current.status !== "LEASED" || current.leasedBy !== workerId) {
      throw new AgentMailboxConflictError(
        `dispatch ${dispatchKey} is not leased by worker ${workerId}`,
      );
    }
    const records = [...box.records];
    records[index] = { ...current, status: "COMPLETED" };
    this.write({ ...box, records });
  }

  list(): readonly AgentMailboxRecord[] {
    return this.read().records;
  }

  private read(): MailboxFile {
    mkdirSync(path.dirname(this.filePath), { recursive: true });
    if (!existsSync(this.filePath)) return EMPTY;
    const parsed = JSON.parse(readFileSync(this.filePath, "utf8")) as Partial<MailboxFile>;
    if (parsed.schemaVersion !== "multi-agent-agent-mailbox-v1" || !Array.isArray(parsed.records)) {
      throw new AgentMailboxConflictError("agent mailbox is invalid or unsupported");
    }
    return parsed as MailboxFile;
  }

  private write(value: MailboxFile): void {
    mkdirSync(path.dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp-${process.pid}-${Date.now()}`;
    writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    renameSync(tmp, this.filePath);
  }
}
