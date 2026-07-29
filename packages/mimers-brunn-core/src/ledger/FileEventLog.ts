import { randomBytes } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { DurabilityError, isNodeError, type DurabilityMode } from '../cas/CASRepository';
import { canonicalizeStrict } from '../serialization';
import type { SigningKeyProvider } from '../signing/SignatureEnvelope';
import type { EventLog, LedgerEventInput } from './EventLog';
import type { MimersLedgerEvent } from './Merkle';
import { parseLedgerEvent, sealLedgerEvent } from './sealLedgerEvent';
import { verifyLedgerHashChain } from './InMemoryEventLog';
import {
  buildChainedLedgerCheckpoint,
  parseChainedLedgerCheckpoint,
  parseSignedChainedLedgerCheckpoint,
  signChainedLedgerCheckpoint,
  verifyChainedCheckpointSequence,
  verifySignedChainedLedgerCheckpoint,
  type ChainedLedgerCheckpoint,
  type SignedChainedLedgerCheckpoint,
} from './chainedCheckpoint';
import {
  DEFAULT_MAX_EVENTS_PER_SEGMENT,
  eventFileName,
  parseSegmentMeta,
  segmentDirName,
  type FileEventLogOptions,
  type LedgerSegmentMeta,
} from './segment';

export class LedgerCorruptionError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'LedgerCorruptionError';
  }
}

type ActiveSegment = {
  readonly segmentId: number;
  readonly dir: string;
  readonly storage: 'segment-dir' | 'legacy-events';
  eventCount: number;
  firstSequence: number;
  lastSequence: number;
  firstEventHash: string | null;
  lastEventHash: string | null;
  closed: boolean;
};

/**
 * Append-only file EventLog with segment rotation + chained Merkle checkpoints
 * (ADR-042 / Fas 4 M4–M5).
 *
 * Layout:
 * ```
 * <baseDir>/
 *   segments/00000001/{NNNNNNNN.json, MANIFEST.json}
 *   checkpoints/00000001.json   # chained merkle root (signed when configured)
 *   events/                     # legacy flat (readable)
 *   tmp/
 * ```
 */
export class FileEventLog implements EventLog {
  private readonly baseDir: string;
  private readonly eventsDir: string;
  private readonly segmentsDir: string;
  private readonly checkpointsDir: string;
  private readonly tmpDir: string;
  private readonly durabilityMode: DurabilityMode;
  private readonly maxEventsPerSegment: number;
  private readonly enableMerkleCheckpoints: boolean;
  private readonly checkpointSigning?: SigningKeyProvider;
  private readonly checkpointPolicy: 'backfill' | 'fail-closed';

  private events: MimersLedgerEvent[] = [];

  private byPromotion = new Map<string, MimersLedgerEvent>();
  private nextSequence = 1;
  private loaded = false;
  private appendTail: Promise<unknown> = Promise.resolve();
  private active: ActiveSegment | null = null;
  private segmentMetas: LedgerSegmentMeta[] = [];
  private checkpoints: ChainedLedgerCheckpoint[] = [];
  private previousCheckpointRoot: string | null = null;

  constructor(baseDir: string, options: FileEventLogOptions = {}) {
    this.baseDir = path.resolve(baseDir);
    this.eventsDir = path.join(this.baseDir, 'events');
    this.segmentsDir = path.join(this.baseDir, 'segments');
    this.checkpointsDir = path.join(this.baseDir, 'checkpoints');
    this.tmpDir = path.join(this.baseDir, 'tmp');
    this.durabilityMode = options.durabilityMode ?? 'strict';
    const max = options.maxEventsPerSegment;
    this.maxEventsPerSegment =
      max === undefined ? DEFAULT_MAX_EVENTS_PER_SEGMENT : Math.max(0, Math.floor(max));
    this.enableMerkleCheckpoints = options.enableMerkleCheckpoints !== false;
    this.checkpointSigning = options.checkpointSigning;
    this.checkpointPolicy = options.checkpointPolicy ?? 'backfill';
  }

  async initialize(): Promise<void> {
    await fs.mkdir(this.eventsDir, { recursive: true });
    await fs.mkdir(this.segmentsDir, { recursive: true });
    await fs.mkdir(this.checkpointsDir, { recursive: true });
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

  /** Closed + active segment metadata (ops / Merkle checkpointing). */
  async listSegments(): Promise<readonly LedgerSegmentMeta[]> {
    await this.ensureLoaded();
    return [...this.segmentMetas];
  }

  /** Chained Merkle checkpoints for closed segments (Fas 4 M5). */
  async listCheckpoints(): Promise<readonly ChainedLedgerCheckpoint[]> {
    await this.ensureLoaded();
    return [...this.checkpoints];
  }

  async getLatestCheckpoint(): Promise<ChainedLedgerCheckpoint | null> {
    await this.ensureLoaded();
    return this.checkpoints.length === 0 ? null : this.checkpoints[this.checkpoints.length - 1]!;
  }

  /** Force re-read from disk (tests / crash recovery). */
  async reloadFromDisk(): Promise<void> {
    const fileEntries = await this.discoverEventFiles();
    const loaded: MimersLedgerEvent[] = [];

    for (const entry of fileEntries) {
      const rawText = await fs.readFile(entry.filePath, 'utf-8');
      let parsed: unknown;
      try {
        parsed = JSON.parse(rawText);
      } catch (err: unknown) {
        throw new LedgerCorruptionError(`Truncated or invalid JSON at ${entry.filePath}`, {
          cause: err,
        });
      }
      const event = parseLedgerEvent(parsed);
      if (event.sequence !== entry.sequence) {
        throw new LedgerCorruptionError(
          `Filename sequence ${entry.sequence} does not match event.sequence ${event.sequence}`,
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
    await this.reconcileSegments(loaded);
    await this.loadCheckpointsFromDisk();
    await this.backfillMissingCheckpoints(loaded);
    await this.verifyLoadedCheckpointChain(loaded);
    this.loaded = true;
  }

  private async appendUnlocked(event: LedgerEventInput): Promise<MimersLedgerEvent> {
    await this.ensureLoaded();
    if (!this.active || this.active.closed) {
      await this.openNextSegment();
    }

    const previousEventHash =
      this.events.length === 0 ? null : this.events[this.events.length - 1]!.eventHash;
    const full = sealLedgerEvent(event, this.nextSequence, previousEventHash);
    const dest = this.eventPathForWrite(full.sequence);
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
      await this.syncDirectory(path.dirname(dest));
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

    const active = this.active!;
    if (active.eventCount === 0) {
      active.firstSequence = full.sequence;
      active.firstEventHash = full.eventHash;
    }
    active.lastSequence = full.sequence;
    active.lastEventHash = full.eventHash;
    active.eventCount += 1;
    await this.persistActiveMeta();

    if (this.shouldRotate(active)) {
      await this.closeActiveSegment();
    }

    return full;
  }

  private shouldRotate(active: ActiveSegment): boolean {
    if (this.maxEventsPerSegment <= 0) return false;
    if (active.storage === 'legacy-events') {
      // Legacy flat dir: rotate into segmented layout once threshold hit.
      return active.eventCount >= this.maxEventsPerSegment;
    }
    return active.eventCount >= this.maxEventsPerSegment;
  }

  private async closeActiveSegment(): Promise<void> {
    if (!this.active || this.active.closed) return;
    this.active.closed = true;
    const meta = this.toMeta(this.active);
    await this.writeSegmentMeta(meta);
    this.upsertMeta(meta);
    if (this.enableMerkleCheckpoints && meta.eventCount > 0) {
      await this.emitCheckpointForSegment(meta);
    }
    this.active = null;
  }

  private async emitCheckpointForSegment(meta: LedgerSegmentMeta): Promise<void> {
    const slice = this.events.filter(
      (e) => e.sequence >= meta.firstSequence && e.sequence <= meta.lastSequence,
    );
    const previousRoot =
      [...this.checkpoints]
        .filter((c) => c.segmentId < meta.segmentId)
        .sort((a, b) => b.segmentId - a.segmentId)[0]?.rootHash ?? null;
    const checkpoint = buildChainedLedgerCheckpoint(slice, {
      segmentId: meta.segmentId,
      previousRoot,
    });

    let payload: ChainedLedgerCheckpoint | SignedChainedLedgerCheckpoint = checkpoint;
    if (this.checkpointSigning) {
      payload = await signChainedLedgerCheckpoint(checkpoint, this.checkpointSigning);
    }

    const dest = path.join(this.checkpointsDir, `${segmentDirName(meta.segmentId)}.json`);
    const tempPath = path.join(
      this.tmpDir,
      `ckpt_${meta.segmentId}_${process.pid}_${randomBytes(4).toString('hex')}.json`,
    );
    const serialized = canonicalizeStrict(payload);
    let handle: fs.FileHandle | null = null;
    try {
      handle = await fs.open(tempPath, 'w');
      await handle.write(serialized, 0, 'utf-8');
      if (this.durabilityMode !== 'none') await handle.datasync();
      await handle.close();
      handle = null;
      await fs.rename(tempPath, dest);
      await this.syncDirectory(this.checkpointsDir);
    } catch (err: unknown) {
      if (handle) {
        try {
          await handle.close();
        } catch {
          /* ignore */
        }
      }
      try {
        await fs.unlink(tempPath);
      } catch {
        /* ignore */
      }
      throw err;
    }

    this.checkpoints.push(checkpoint);
    this.checkpoints.sort((a, b) => a.segmentId - b.segmentId);
    this.previousCheckpointRoot = this.checkpoints[this.checkpoints.length - 1]!.rootHash;
  }

  /** Load checkpoint files (signatures only); chain verify runs after optional backfill. */
  private async loadCheckpointsFromDisk(): Promise<void> {
    const checkpoints: ChainedLedgerCheckpoint[] = [];
    let entries: Awaited<ReturnType<typeof fs.readdir>>;
    try {
      entries = await fs.readdir(this.checkpointsDir, { withFileTypes: true });
    } catch (err: unknown) {
      if (isNodeError(err) && err.code === 'ENOENT') {
        this.checkpoints = [];
        this.previousCheckpointRoot = null;
        return;
      }
      throw err;
    }

    for (const entry of entries) {
      if (!entry.isFile() || !/^\d{8}\.json$/.test(entry.name)) continue;
      const rawText = await fs.readFile(path.join(this.checkpointsDir, entry.name), 'utf-8');
      let parsed: unknown;
      try {
        parsed = JSON.parse(rawText);
      } catch (err: unknown) {
        throw new LedgerCorruptionError(`Truncated checkpoint ${entry.name}`, { cause: err });
      }
      const obj = parsed as { kind?: string };
      if (obj.kind === 'signed-chained-ledger-checkpoint') {
        const signed = parseSignedChainedLedgerCheckpoint(parsed);
        if (this.checkpointSigning) {
          const ok = await verifySignedChainedLedgerCheckpoint(signed, this.checkpointSigning);
          if (!ok) {
            throw new LedgerCorruptionError(`Checkpoint signature invalid for ${entry.name}`);
          }
        }
        checkpoints.push(signed.checkpoint);
      } else {
        checkpoints.push(parseChainedLedgerCheckpoint(parsed));
      }
    }

    checkpoints.sort((a, b) => a.segmentId - b.segmentId);
    this.checkpoints = checkpoints;
    this.previousCheckpointRoot =
      checkpoints.length === 0 ? null : checkpoints[checkpoints.length - 1]!.rootHash;
  }

  private async verifyLoadedCheckpointChain(loaded: MimersLedgerEvent[]): Promise<void> {
    if (!this.enableMerkleCheckpoints || this.checkpoints.length === 0) return;
    const chain = verifyChainedCheckpointSequence(this.checkpoints, loaded);
    if (!chain.ok) {
      throw new LedgerCorruptionError(`Checkpoint chain broken: ${chain.errors.join('; ')}`);
    }
    this.previousCheckpointRoot = this.checkpoints[this.checkpoints.length - 1]!.rootHash;
  }

  /** Emit checkpoints for closed segments that lack one (e.g. legacy adopt). */
  private async backfillMissingCheckpoints(_loaded: MimersLedgerEvent[]): Promise<void> {
    if (!this.enableMerkleCheckpoints) return;
    const have = new Set(this.checkpoints.map((c) => c.segmentId));
    const missing: number[] = [];
    for (const meta of [...this.segmentMetas].sort((a, b) => a.segmentId - b.segmentId)) {
      if (!meta.closed || meta.eventCount <= 0) continue;
      if (have.has(meta.segmentId)) continue;
      missing.push(meta.segmentId);
    }
    if (missing.length === 0) return;

    if (this.checkpointPolicy === 'fail-closed') {
      throw new LedgerCorruptionError(
        `Missing checkpoints for closed segments: ${missing.join(', ')} (checkpointPolicy=fail-closed)`,
      );
    }

    for (const segmentId of missing) {
      const meta = this.segmentMetas.find((m) => m.segmentId === segmentId);
      if (!meta) continue;
      await this.emitCheckpointForSegment(meta);
      have.add(segmentId);
    }
  }

  private async openNextSegment(): Promise<void> {
    const nextId =
      this.segmentMetas.length === 0
        ? 1
        : Math.max(...this.segmentMetas.map((m) => m.segmentId)) + 1;

    // Prefer segmented layout for new installs / after rotation.
    const useLegacy =
      nextId === 1 &&
      this.maxEventsPerSegment <= 0 &&
      (await this.hasLegacyEventFiles()) &&
      !(await this.hasSegmentDirs());

    if (useLegacy) {
      this.active = {
        segmentId: 1,
        dir: this.eventsDir,
        storage: 'legacy-events',
        eventCount: 0,
        firstSequence: this.nextSequence,
        lastSequence: 0,
        firstEventHash: null,
        lastEventHash: null,
        closed: false,
      };
    } else {
      const dir = path.join(this.segmentsDir, segmentDirName(nextId));
      await fs.mkdir(dir, { recursive: true });
      this.active = {
        segmentId: nextId,
        dir,
        storage: 'segment-dir',
        eventCount: 0,
        firstSequence: this.nextSequence,
        lastSequence: 0,
        firstEventHash: null,
        lastEventHash: null,
        closed: false,
      };
    }
    await this.persistActiveMeta();
  }

  private async persistActiveMeta(): Promise<void> {
    if (!this.active) return;
    const meta = this.toMeta(this.active);
    await this.writeSegmentMeta(meta);
    this.upsertMeta(meta);
  }

  private toMeta(active: ActiveSegment): LedgerSegmentMeta {
    return {
      schemaVersion: 'ledger.segment.v1',
      segmentId: active.segmentId,
      firstSequence: active.firstSequence,
      lastSequence: active.lastSequence,
      eventCount: active.eventCount,
      closed: active.closed,
      ...(active.closed ? { closedAt: new Date().toISOString() } : {}),
      firstEventHash: active.firstEventHash,
      lastEventHash: active.lastEventHash,
      storage: active.storage,
    };
  }

  private upsertMeta(meta: LedgerSegmentMeta): void {
    const idx = this.segmentMetas.findIndex((m) => m.segmentId === meta.segmentId);
    if (idx >= 0) this.segmentMetas[idx] = meta;
    else this.segmentMetas.push(meta);
    this.segmentMetas.sort((a, b) => a.segmentId - b.segmentId);
  }

  private async writeSegmentMeta(meta: LedgerSegmentMeta): Promise<void> {
    const dir =
      meta.storage === 'legacy-events'
        ? this.eventsDir
        : path.join(this.segmentsDir, segmentDirName(meta.segmentId));
    await fs.mkdir(dir, { recursive: true });
    const dest = path.join(dir, 'MANIFEST.json');
    const tempPath = path.join(
      this.tmpDir,
      `segmeta_${meta.segmentId}_${process.pid}_${randomBytes(4).toString('hex')}.json`,
    );
    const serialized = canonicalizeStrict(meta);
    let handle: fs.FileHandle | null = null;
    try {
      handle = await fs.open(tempPath, 'w');
      await handle.write(serialized, 0, 'utf-8');
      if (this.durabilityMode !== 'none') await handle.datasync();
      await handle.close();
      handle = null;
      await fs.rename(tempPath, dest);
      await this.syncDirectory(dir);
    } catch (err: unknown) {
      if (handle) {
        try {
          await handle.close();
        } catch {
          /* ignore */
        }
      }
      try {
        await fs.unlink(tempPath);
      } catch {
        /* ignore */
      }
      throw err;
    }
  }

  private async reconcileSegments(loaded: MimersLedgerEvent[]): Promise<void> {
    const metas = await this.loadAllSegmentMetas();
    const legacyFiles = await this.listSequenceFiles(this.eventsDir);

    if (metas.length === 0 && legacyFiles.length > 0) {
      // Adopt legacy flat layout as closed segment 1; new writes open segment 2 (or stay legacy if rotation disabled).
      const first = loaded[0];
      const last = loaded[loaded.length - 1];
      const adopted: LedgerSegmentMeta = {
        schemaVersion: 'ledger.segment.v1',
        segmentId: 1,
        firstSequence: first?.sequence ?? 1,
        lastSequence: last?.sequence ?? 0,
        eventCount: loaded.length,
        closed: this.maxEventsPerSegment > 0,
        ...(this.maxEventsPerSegment > 0 ? { closedAt: new Date().toISOString() } : {}),
        firstEventHash: first?.eventHash ?? null,
        lastEventHash: last?.eventHash ?? null,
        storage: 'legacy-events',
      };
      await this.writeSegmentMeta(adopted);
      this.segmentMetas = [adopted];
      if (adopted.closed) {
        this.active = null;
      } else {
        this.active = {
          segmentId: 1,
          dir: this.eventsDir,
          storage: 'legacy-events',
          eventCount: adopted.eventCount,
          firstSequence: adopted.firstSequence,
          lastSequence: adopted.lastSequence,
          firstEventHash: adopted.firstEventHash,
          lastEventHash: adopted.lastEventHash,
          closed: false,
        };
      }
      return;
    }

    if (metas.length === 0) {
      this.segmentMetas = [];
      this.active = null;
      return;
    }

    this.segmentMetas = metas.sort((a, b) => a.segmentId - b.segmentId);
    const open = [...this.segmentMetas].reverse().find((m) => !m.closed);
    if (open) {
      this.active = {
        segmentId: open.segmentId,
        dir:
          open.storage === 'legacy-events'
            ? this.eventsDir
            : path.join(this.segmentsDir, segmentDirName(open.segmentId)),
        storage: open.storage,
        eventCount: open.eventCount,
        firstSequence: open.firstSequence,
        lastSequence: open.lastSequence,
        firstEventHash: open.firstEventHash,
        lastEventHash: open.lastEventHash,
        closed: false,
      };
    } else {
      this.active = null;
    }
  }

  private async loadAllSegmentMetas(): Promise<LedgerSegmentMeta[]> {
    const metas: LedgerSegmentMeta[] = [];

    const legacyManifest = path.join(this.eventsDir, 'MANIFEST.json');
    try {
      const raw = JSON.parse(await fs.readFile(legacyManifest, 'utf-8'));
      metas.push(parseSegmentMeta(raw));
    } catch (err: unknown) {
      if (!(isNodeError(err) && err.code === 'ENOENT')) {
        throw new LedgerCorruptionError(`Invalid legacy segment MANIFEST at ${legacyManifest}`, {
          cause: err,
        });
      }
    }

    let segmentEntries: Awaited<ReturnType<typeof fs.readdir>>;
    try {
      segmentEntries = await fs.readdir(this.segmentsDir, { withFileTypes: true });
    } catch (err: unknown) {
      if (isNodeError(err) && err.code === 'ENOENT') return metas;
      throw err;
    }

    for (const entry of segmentEntries) {
      if (!entry.isDirectory() || !/^\d{8}$/.test(entry.name)) continue;
      const manifestPath = path.join(this.segmentsDir, entry.name, 'MANIFEST.json');
      try {
        const raw = JSON.parse(await fs.readFile(manifestPath, 'utf-8'));
        metas.push(parseSegmentMeta(raw));
      } catch (err: unknown) {
        if (isNodeError(err) && err.code === 'ENOENT') {
          const files = await this.listSequenceFiles(path.join(this.segmentsDir, entry.name));
          if (files.length === 0) continue;
          throw new LedgerCorruptionError(
            `Segment ${entry.name} has events but missing MANIFEST.json`,
          );
        }
        throw new LedgerCorruptionError(`Invalid segment MANIFEST at ${manifestPath}`, {
          cause: err,
        });
      }
    }

    return metas;
  }

  private async discoverEventFiles(): Promise<readonly { sequence: number; filePath: string }[]> {
    const found = new Map<number, string>();

    for (const file of await this.listSequenceFiles(this.eventsDir)) {
      found.set(file.sequence, file.filePath);
    }

    let segmentEntries: Awaited<ReturnType<typeof fs.readdir>>;
    try {
      segmentEntries = await fs.readdir(this.segmentsDir, { withFileTypes: true });
    } catch (err: unknown) {
      if (!(isNodeError(err) && err.code === 'ENOENT')) throw err;
      segmentEntries = [];
    }

    for (const entry of segmentEntries) {
      if (!entry.isDirectory() || !/^\d{8}$/.test(entry.name)) continue;
      for (const file of await this.listSequenceFiles(path.join(this.segmentsDir, entry.name))) {
        if (found.has(file.sequence)) {
          throw new LedgerCorruptionError(
            `Duplicate ledger sequence ${file.sequence} in legacy events/ and segments/`,
          );
        }
        found.set(file.sequence, file.filePath);
      }
    }

    return [...found.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([sequence, filePath]) => ({ sequence, filePath }));
  }

  private async listSequenceFiles(
    dir: string,
  ): Promise<readonly { sequence: number; filePath: string }[]> {
    let entries: Awaited<ReturnType<typeof fs.readdir>>;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch (err: unknown) {
      if (isNodeError(err) && err.code === 'ENOENT') return [];
      throw err;
    }
    const out: { sequence: number; filePath: string }[] = [];
    for (const entry of entries) {
      if (!entry.isFile() || !/^\d{8}\.json$/.test(entry.name)) continue;
      const sequence = Number.parseInt(entry.name.slice(0, 8), 10);
      out.push({ sequence, filePath: path.join(dir, entry.name) });
    }
    return out.sort((a, b) => a.sequence - b.sequence);
  }

  private eventPathForWrite(sequence: number): string {
    if (!this.active) {
      throw new Error('FileEventLog: no active segment for write');
    }
    return path.join(this.active.dir, eventFileName(sequence));
  }

  private async hasLegacyEventFiles(): Promise<boolean> {
    return (await this.listSequenceFiles(this.eventsDir)).length > 0;
  }

  private async hasSegmentDirs(): Promise<boolean> {
    try {
      const entries = await fs.readdir(this.segmentsDir, { withFileTypes: true });
      return entries.some((e) => e.isDirectory() && /^\d{8}$/.test(e.name));
    } catch (err: unknown) {
      if (isNodeError(err) && err.code === 'ENOENT') return false;
      throw err;
    }
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
