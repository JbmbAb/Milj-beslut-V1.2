import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  BindingStoreUnreadable,
  type ValidatorBindingRecord,
  type ValidatorBindingStore,
  type ValidatorClass,
} from "./ValidatorBindingStore";
import {
  acquireValidatorBindingLease,
  type ValidatorBindingLease,
} from "./ValidatorBindingLease";

/**
 * Durable recall of one validator binding per source, locator, and target.
 *
 * The store root's named pipe is the single-writer lease. Records in this
 * directory are metadata. A leftover file does not grant or block ownership.
 * This is not CAS, not a download manifest, and not an authority.
 */

const VALIDATOR_CLASSES = new Set<ValidatorClass>([
  "STRONG_ETAG",
  "UPSTREAM_CONTENT_DIGEST",
  "IMMUTABLE_REVISION_ID",
]);

export class FileValidatorBindingStore implements ValidatorBindingStore {
  private readonly tails = new Map<string, Promise<void>>();

  private constructor(
    private readonly rootPath: string,
    private readonly lease: ValidatorBindingLease,
  ) {}

  static async open(rootPath: string): Promise<FileValidatorBindingStore> {
    const lease = await acquireValidatorBindingLease(rootPath);
    await mkdir(rootPath, { recursive: true });
    return new FileValidatorBindingStore(rootPath, lease);
  }

  get pipeName(): string {
    return this.lease.pipeName;
  }

  async close(): Promise<void> {
    await this.lease.release();
  }

  async resolve(
    sourceId: string,
    locatorIdentity: string,
    targetIdentity: string,
  ): Promise<readonly ValidatorBindingRecord[]> {
    const key = keyOf(sourceId, locatorIdentity, targetIdentity);
    return this.withKey(key, async () => this.readKey(key));
  }

  async replace(record: ValidatorBindingRecord): Promise<void> {
    const key = keyOf(record.sourceId, record.locatorIdentity, record.targetIdentity);
    await this.withKey(key, async () => {
      const previous = await this.readKey(key);
      const previousToken = previous.length === 1 ? previous[0]?.validatorToken : undefined;
      try {
        await this.writeBody(key, record);
      } catch (error) {
        if (previousToken !== undefined && previousToken !== record.validatorToken) {
          try {
            await this.writeBody(key, { tombstone: true, key });
          } catch {
            throw new BindingStoreUnreadable(
              `Binding replace failed and the previous token could not be tombstoned for '${key}'.`,
            );
          }
          throw error;
        }
        throw error;
      }
    });
  }

  async touchObservedAt(
    sourceId: string,
    locatorIdentity: string,
    targetIdentity: string,
    observedAt: string,
    expectedValidatorToken?: string,
  ): Promise<boolean> {
    const key = keyOf(sourceId, locatorIdentity, targetIdentity);
    return this.withKey(key, async () => {
      const current = await this.readKey(key);
      const existing = current[0];
      if (current.length !== 1 || existing === undefined) return false;
      if (expectedValidatorToken !== undefined && existing.validatorToken !== expectedValidatorToken) {
        return false;
      }
      await this.writeBody(key, { ...existing, observedAt });
      return true;
    });
  }

  private async readKey(key: string): Promise<readonly ValidatorBindingRecord[]> {
    let raw: string;
    try {
      raw = await readFile(this.pathFor(key), "utf8");
    } catch (error) {
      if (isNotFound(error)) return [];
      throw new BindingStoreUnreadable(`Binding record for '${key}' could not be read.`);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch {
      throw new BindingStoreUnreadable(`Binding record for '${key}' is not JSON.`);
    }

    if (isTombstone(parsed)) {
      throw new BindingStoreUnreadable(`Binding record for '${key}' is tombstoned.`);
    }

    const candidates = Array.isArray(parsed) ? parsed : [parsed];
    if (candidates.length === 0) {
      throw new BindingStoreUnreadable(`Binding record for '${key}' is empty.`);
    }

    const records: ValidatorBindingRecord[] = [];
    for (const candidate of candidates) {
      const record = asRecord(candidate);
      if (record === null || keyOf(record.sourceId, record.locatorIdentity, record.targetIdentity) !== key) {
        throw new BindingStoreUnreadable(`Binding record for '${key}' does not match its key.`);
      }
      records.push(record);
    }
    return records;
  }

  private async writeBody(key: string, body: unknown): Promise<void> {
    const path = this.pathFor(key);
    const temporary = `${path}.${process.pid}.tmp`;
    await mkdir(this.rootPath, { recursive: true });
    await writeFile(temporary, JSON.stringify(body), "utf8");
    await rename(temporary, path);
  }

  private pathFor(key: string): string {
    const digest = createHash("sha256").update(key, "utf8").digest("hex");
    return join(this.rootPath, `${digest}.json`);
  }

  private async withKey<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    let release: () => void = () => {};
    const gate = new Promise<void>((resolveGate) => {
      release = resolveGate;
    });
    const tail = previous.then(() => gate);
    this.tails.set(key, tail);
    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (this.tails.get(key) === tail) this.tails.delete(key);
    }
  }
}

function keyOf(sourceId: string, locatorIdentity: string, targetIdentity: string): string {
  return JSON.stringify([sourceId, locatorIdentity, targetIdentity]);
}

function isTombstone(value: unknown): boolean {
  return typeof value === "object" && value !== null && (value as { tombstone?: unknown }).tombstone === true;
}

function asRecord(value: unknown): ValidatorBindingRecord | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (
    typeof record.sourceId !== "string" ||
    typeof record.sourceContentHash !== "string" ||
    typeof record.registryArtifactId !== "string" ||
    typeof record.locatorIdentity !== "string" ||
    typeof record.targetIdentity !== "string" ||
    (record.fileName !== null && typeof record.fileName !== "string") ||
    typeof record.validatorToken !== "string" ||
    typeof record.observedAt !== "string" ||
    typeof record.validatorClass !== "string" ||
    !VALIDATOR_CLASSES.has(record.validatorClass as ValidatorClass)
  ) {
    return null;
  }
  return {
    sourceId: record.sourceId,
    sourceContentHash: record.sourceContentHash,
    registryArtifactId: record.registryArtifactId,
    locatorIdentity: record.locatorIdentity,
    targetIdentity: record.targetIdentity,
    fileName: record.fileName as string | null,
    validatorClass: record.validatorClass as ValidatorClass,
    validatorToken: record.validatorToken,
    observedAt: record.observedAt,
  };
}

function isNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "ENOENT";
}
