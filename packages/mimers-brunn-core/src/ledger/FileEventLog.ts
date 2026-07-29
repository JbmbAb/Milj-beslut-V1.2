import { randomBytes } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { DurabilityError, isNodeError, type DurabilityMode } from '../cas/CASRepository';
import { canonicalizeStrict } from '../serialization';
import type { EventLog, LedgerEventInput } from './EventLog';
import type { MimersLedgerEvent } from './Merkle';
import { parseLedgerEvent, sealLedgerEvent } from './sealLedgerEvent';
import { verifyLedgerHashChain } from './InMemoryEventLog';

export class LedgerCorruptionError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'LedgerCorruptionError';
  }
}

/**
 * Append-only file EventLog (ADR-042).
 * Layout: `<baseDir>/events/00000001.json` … plus `<baseDir>/tmp/` for durable commits.
 * Survives process crash: reload verifies the hash chain before serving.
 */
export class FileEventLog implements EventLog {
  private readonly baseDir: string;
  private readonly eventsDir: string;
  private readonly tmpDir: string;
  private readonly durabilityMode: DurabilityMode;

  private events: MimersLedgerEvent[] = [];
  private byPromotion = new Map<string, MimersLedgerEvent>();
  private nextSequence = 1;
  private loaded = false;
  private appendTail: Promise<unknown> = Promise.resolve();

  constructor(
    baseDir: string,
    options: {
      readonly durabilityMode?: DurabilityMode;
    } = {},
  ) {
    this.baseDir = path.resolve(baseDir);
    this.eventsDir = path.join(this.baseDir, 'events');
    this.tmpDir = path.join(this.baseDir, 'tmp');
    this.durabilityMode = options.durabilityMode ?? 'strict';
  }

  async initialize(): Promise<void> {
    await fs.mkdir(this.eventsDir, { recursive: true });
    await fs.mkdir(this.tmpDir, { recursive: true });
    await this.cleanupTmp();
    await this.reloadFromDisk();
  }

  async append(event: LedgerEventInput): Promise<MimersLedgerEvent> {
    return this.serialize(() => this.appendUnlocked(event));
  }

  async getHead(): Promise<MimersLedgerEvent | null> {
    await this.ensureLoaded();
    return this.events.length === 0 ? null : this.events[this.events.length - 1]!;
  }

  async getAllEvents(): Promise<MimersLedgerEvent[]> {
    await this.ensureLoaded();
    return [...this.events];
  }

  async findByPromotionHash(promotionHash: string): Promise<MimersLedgerEvent | null> {
    await this.ensureLoaded();
    return this.byPromotion.get(promotionHash) ?? null;
  }

  /** Force re-read from disk (tests / crash recovery). */
  async reloadFromDisk(): Promise<void> {
    const entries = await fs.readdir(this.eventsDir, { withFileTypes: true });
    const files = entries
      .filter((e) => e.isFile() && /^\d{8}\.json$/.test(e.name))
      .map((e) => e.name)
      .sort();

    const loaded: MimersLedgerEvent[] = [];
    for (const name of files) {
      const seq = Number.parseInt(name.slice(0, 8), 10);
      const rawText = await fs.readFile(path.join(this.eventsDir, name), 'utf-8');
      let parsed: unknown;
      try {
        parsed = JSON.parse(rawText);
      } catch (err: unknown) {
        throw new LedgerCorruptionError(`Truncated or invalid JSON at ${name}`, { cause: err });
      }
      const event = parseLedgerEvent(parsed);
      if (event.sequence !== seq) {
        throw new LedgerCorruptionError(
          `Filename sequence ${seq} does not match event.sequence ${event.sequence}`,
        );
      }
      loaded.push(event);
    }

    for (let i = 0; i < loaded.length; i += 1) {
      const expectedSeq = i + 1;
      if (loaded[i]!.sequence !== expectedSeq) {
        throw new LedgerCorruptionError(
          `Sequence gap: expected ${expectedSeq}, found ${loaded[i]!.sequence}`,
        );
      }
    }

    const chain = verifyLedgerHashChain(loaded);
    if (!chain.ok) {
      throw new LedgerCorruptionError(`Hash chain broken: ${chain.errors.join('; ')}`);
    }

    this.events = loaded;
    this.byPromotion = new Map(loaded.map((e) => [e.promotionHash, e]));
    this.nextSequence = loaded.length + 1;
    this.loaded = true;
  }

  private async appendUnlocked(event: LedgerEventInput): Promise<MimersLedgerEvent> {
    await this.ensureLoaded();
    const previousEventHash =
      this.events.length === 0 ? null : this.events[this.events.length - 1]!.eventHash;
    const full = sealLedgerEvent(event, this.nextSequence, previousEventHash);
    const dest = this.eventPath(full.sequence);
    const tempName = `tmp_${full.sequence}_${process.pid}_${randomBytes(6).toString('hex')}.json`;
    const tempPath = path.join(this.tmpDir, tempName);
    const serialized = canonicalizeStrict(full);

    let handle: fs.FileHandle | null = null;
    try {
      handle = await fs.open(tempPath, 'w');
      await handle.write(serialized, 0, 'utf-8');
      if (this.durabilityMode !== 'none') {
        await handle.datasync();
      }
      await handle.close();
      handle = null;

      try {
        await fs.link(tempPath, dest);
      } catch (err: unknown) {
        if (isNodeError(err) && err.code === 'EEXIST') {
          throw new LedgerCorruptionError(
            `Refusing overwrite of immutable ledger event ${full.sequence}`,
          );
        }
        throw err;
      }
      await this.syncDirectory(this.eventsDir);
    } catch (err: unknown) {
      if (handle) {
        try {
          await handle.close();
        } catch {
          /* ignore */
        }
      }
      throw err;
    } finally {
      try {
        await fs.unlink(tempPath);
      } catch {
        /* ignore */
      }
    }

    this.events.push(full);
    this.byPromotion.set(full.promotionHash, full);
    this.nextSequence += 1;
    return full;
  }

  private eventPath(sequence: number): string {
    return path.join(this.eventsDir, `${sequence.toString().padStart(8, '0')}.json`);
  }

  private async ensureLoaded(): Promise<void> {
    if (!this.loaded) {
      await this.initialize();
    }
  }

  private serialize<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.appendTail.then(fn, fn);
    this.appendTail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async cleanupTmp(): Promise<void> {
    let entries: Awaited<ReturnType<typeof fs.readdir>>;
    try {
      entries = await fs.readdir(this.tmpDir, { withFileTypes: true });
    } catch (err: unknown) {
      if (isNodeError(err) && err.code === 'ENOENT') return;
      throw err;
    }
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      try {
        await fs.unlink(path.join(this.tmpDir, entry.name));
      } catch {
        /* ignore */
      }
    }
  }

  private async syncDirectory(dir: string): Promise<void> {
    if (this.durabilityMode === 'none') return;
    let dirHandle: fs.FileHandle | null = null;
    try {
      dirHandle = await fs.open(dir, 'r');
      await dirHandle.sync();
    } catch (syncErr: unknown) {
      if (this.durabilityMode === 'strict') {
        const msg = syncErr instanceof Error ? syncErr.message : String(syncErr);
        throw new DurabilityError(`[P-02] Ledger directory fsync failed for '${dir}': ${msg}`, {
          cause: syncErr,
        });
      }
    } finally {
      if (dirHandle) await dirHandle.close();
    }
  }
}
