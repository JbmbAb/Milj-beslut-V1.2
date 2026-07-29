import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { randomBytes } from 'node:crypto';
import {
  CASIntegrityError,
  DurabilityError,
  isNodeError,
  type CASRepository,
  type CommitStrategy,
  type DurabilityMode,
  type PutBytesOptions,
  type PutResult,
} from './CASRepository';
import { WeightedLRUCache } from './cache';
import {
  canonicalizeStrict,
  hashBytes,
  parseHash,
  type HashAlgorithm,
  type SupportedHashAlgorithm,
} from '../serialization';
import { InMemoryMetrics, type MetricsCollector } from '../metrics/MetricsCollector';

function copyBytes(bytes: Uint8Array): Uint8Array {
  return Uint8Array.from(bytes);
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  return Buffer.compare(Buffer.from(a.buffer, a.byteOffset, a.byteLength), Buffer.from(b)) === 0;
}

export class DefaultCommitStrategy implements CommitStrategy {
  constructor(
    private readonly durabilityMode: DurabilityMode = 'strict',
    private readonly metrics?: MetricsCollector,
  ) {}

  async commit(tempPath: string, destinationPath: string): Promise<void> {
    const destDir = path.dirname(destinationPath);
    await fs.link(tempPath, destinationPath);
    await this.syncDirectory(destDir);
  }

  private async syncDirectory(dir: string): Promise<void> {
    if (this.durabilityMode === 'none') return;
    let dirHandle: fs.FileHandle | null = null;
    try {
      dirHandle = await fs.open(dir, 'r');
      await dirHandle.sync();
    } catch (syncErr: unknown) {
      this.metrics?.inc('cas_failures_total', 1, { result: 'fsync_failure' });
      if (this.durabilityMode === 'strict') {
        const msg = syncErr instanceof Error ? syncErr.message : String(syncErr);
        throw new DurabilityError(`[P-02] Directory fsync failed for '${dir}': ${msg}`, { cause: syncErr });
      }
    } finally {
      if (dirHandle) await dirHandle.close();
    }
  }
}

/**
 * File-backed CAS: opaque bytes at the core (putBytes/getBytes).
 * JSON helpers (putCanonical/get) sit one layer above.
 */
export class FileCASRepository implements CASRepository {
  private readonly baseDir: string;
  private readonly commitStrategy: CommitStrategy;
  private readonly cache: WeightedLRUCache<string, Uint8Array>;
  private readonly existsCache: WeightedLRUCache<string, boolean>;
  private readonly metrics: MetricsCollector;
  private readonly hashAlgorithm: HashAlgorithm;
  private readonly durabilityMode: DurabilityMode;

  constructor(
    baseDir: string,
    options: {
      commitStrategy?: CommitStrategy;
      maxCacheBytes?: number;
      metrics?: MetricsCollector;
      hashAlgorithm?: HashAlgorithm;
      durabilityMode?: DurabilityMode;
    } = {},
  ) {
    this.baseDir = path.resolve(baseDir);
    this.durabilityMode = options.durabilityMode || 'strict';
    this.metrics = options.metrics || new InMemoryMetrics();
    this.commitStrategy = options.commitStrategy || new DefaultCommitStrategy(this.durabilityMode, this.metrics);
    this.cache = new WeightedLRUCache(options.maxCacheBytes ?? 256 * 1024 * 1024, (bytes) => bytes.byteLength);
    this.existsCache = new WeightedLRUCache(10_000, () => 1);
    this.hashAlgorithm = options.hashAlgorithm || 'sha256';
  }

  async initialize(): Promise<void> {
    await fs.mkdir(this.baseDir, { recursive: true });
    await fs.mkdir(path.join(this.baseDir, 'tmp'), { recursive: true });
    await fs.mkdir(path.join(this.baseDir, 'objects', 'sha256'), { recursive: true });
    await fs.mkdir(path.join(this.baseDir, 'objects', 'sha512'), { recursive: true });

    const dummyTmp = path.join(this.baseDir, 'tmp', '.fs_assertion_dummy');
    const dummyDest = path.join(this.baseDir, 'objects', 'sha256', '.fs_assertion_dummy');
    try {
      await fs.writeFile(dummyTmp, 'probe');
      await fs.link(dummyTmp, dummyDest);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(
        `[P-05] Critical: 'tmp' and 'objects' must reside on the same filesystem. Link failed: ${msg}`,
      );
    } finally {
      try {
        await fs.unlink(dummyTmp);
      } catch {
        /* ignore */
      }
      try {
        await fs.unlink(dummyDest);
      } catch {
        /* ignore */
      }
    }
  }

  async exists(hash: string): Promise<boolean> {
    try {
      const stat = await fs.stat(this.getFilePath(hash));
      const isFile = stat.isFile();
      if (isFile) this.existsCache.set(hash, true);
      return isFile;
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') {
        this.existsCache.delete(hash);
        return false;
      }
      throw error;
    }
  }

  async existsAuthoritative(hash: string): Promise<boolean> {
    return this.exists(hash);
  }

  async putBytes(bytes: Uint8Array, options: PutBytesOptions = {}): Promise<PutResult> {
    const algorithm = (options.algorithm ?? this.hashAlgorithm) as SupportedHashAlgorithm;
    this.metrics.inc('cas_puts_total', 1, { operation: 'put', algorithm });

    const stored = copyBytes(bytes);
    const size = stored.byteLength;
    const hash = hashBytes(stored, algorithm);
    const destinationPath = this.getFilePath(hash);

    const tempRandom = randomBytes(8).toString('hex');
    const tempFileName = `tmp_${hash.replace(':', '_')}_${process.pid}_${tempRandom}.tmp`;
    const tempPath = path.join(this.baseDir, 'tmp', tempFileName);

    let fileHandle: fs.FileHandle | null = null;
    try {
      fileHandle = await fs.open(tempPath, 'w');
      await fileHandle.write(Buffer.from(stored.buffer, stored.byteOffset, stored.byteLength));
      await fileHandle.datasync();
      await fileHandle.close();
      fileHandle = null;

      await fs.mkdir(path.dirname(destinationPath), { recursive: true });
      await this.commitStrategy.commit(tempPath, destinationPath);

      this.cache.set(hash, stored);
      this.existsCache.set(hash, true);
      this.metrics.inc('cas_bytes_written', size, { operation: 'put', algorithm });

      try {
        await fs.unlink(tempPath);
      } catch {
        /* ignore */
      }
      return { hash, size, existed: false };
    } catch (error: unknown) {
      if (fileHandle) {
        try {
          await fileHandle.close();
        } catch {
          /* ignore */
        }
      }
      try {
        await fs.unlink(tempPath);
      } catch {
        /* ignore */
      }

      if (isNodeError(error) && error.code === 'EEXIST') {
        this.metrics.inc('cas_collisions_total', 1, {
          operation: 'put',
          result: 'collision',
          algorithm,
        });
        const existingBytes = await fs.readFile(destinationPath);
        if (!bytesEqual(existingBytes, stored)) {
          throw new CASIntegrityError(
            `[P-05] CAS Integrity Collision: File exists but contents differ! Hash: ${hash}`,
          );
        }
        this.cache.set(hash, stored);
        this.existsCache.set(hash, true);
        return { hash, size, existed: true };
      }
      throw error;
    }
  }

  async putSerialized(serialized: string, options?: PutBytesOptions): Promise<PutResult> {
    return this.putBytes(Buffer.from(serialized, 'utf-8'), options);
  }

  async putCanonical(obj: unknown, options?: PutBytesOptions): Promise<PutResult> {
    return this.putSerialized(canonicalizeStrict(obj), options);
  }

  /** @deprecated Prefer putCanonical — thin alias. */
  async put(obj: unknown): Promise<PutResult> {
    return this.putCanonical(obj);
  }

  async getBytes(hash: string, options?: { verifyHash?: boolean }): Promise<Uint8Array | null> {
    const { algorithm } = parseHash(hash);
    this.metrics.inc('cas_gets_total', 1, { operation: 'get', algorithm });

    if (this.cache.has(hash)) {
      this.metrics.inc('cas_cache_hits', 1, { operation: 'get', result: 'success', algorithm });
      const cachedBytes = this.cache.get(hash)!;
      if (options?.verifyHash) {
        const computed = hashBytes(cachedBytes, algorithm);
        if (computed !== hash) {
          throw new Error(`In-Memory Corruption: cached hash ${computed} != ${hash}`);
        }
      }
      return copyBytes(cachedBytes);
    }

    this.metrics.inc('cas_cache_misses', 1, { operation: 'get', result: 'miss', algorithm });

    try {
      const dataBytes = await fs.readFile(this.getFilePath(hash));
      if (options?.verifyHash) {
        const computed = hashBytes(dataBytes, algorithm);
        if (computed !== hash) {
          throw new CASIntegrityError(
            `Storage Read Corruption: on-disk hash '${computed}' != '${hash}'.`,
          );
        }
      }
      const stored = copyBytes(dataBytes);
      this.cache.set(hash, stored);
      this.existsCache.set(hash, true);
      return copyBytes(stored);
    } catch (error: unknown) {
      if (isNodeError(error) && error.code === 'ENOENT') return null;
      throw error;
    }
  }

  /**
   * JSON helper: getBytes + JSON.parse.
   * Invalid for non-UTF8 / non-JSON payloads — use getBytes for binary.
   */
  async get<T = unknown>(hash: string, options?: { verifyHash?: boolean }): Promise<T | null> {
    const bytes = await this.getBytes(hash, options);
    if (bytes === null) return null;
    return JSON.parse(Buffer.from(bytes).toString('utf-8')) as T;
  }

  /** Windows-safe sharded path: objects/<algo>/<2hex>/<rest> (no ':' in filename). */
  getFilePath(hash: string): string {
    const { algorithm, digest } = parseHash(hash);
    const shard = digest.substring(0, 2);
    const rest = digest.substring(2);
    return path.join(this.baseDir, 'objects', algorithm, shard, rest);
  }

  async verifyStoredObject(hash: string): Promise<{ ok: boolean; size?: number; error?: string }> {
    const { algorithm } = parseHash(hash);
    try {
      const dataBytes = await fs.readFile(this.getFilePath(hash));
      const computed = hashBytes(dataBytes, algorithm);
      if (computed !== hash) {
        this.cache.delete(hash);
        return {
          ok: false,
          size: dataBytes.byteLength,
          error: `bitrot: on-disk hash '${computed}' != '${hash}'`,
        };
      }
      return { ok: true, size: dataBytes.byteLength };
    } catch (error: unknown) {
      if (isNodeError(error) && error.code === 'ENOENT') {
        return { ok: false, error: `missing object ${hash}` };
      }
      const msg = error instanceof Error ? error.message : String(error);
      return { ok: false, error: `verify failed for ${hash}: ${msg}` };
    }
  }

  async verifyDescriptor(
    descriptor: { readonly mediaType: string; readonly digest: string; readonly size: number },
    expectedMediaType?: string,
  ): Promise<{
    ok: boolean;
    digestValid: boolean;
    sizeValid: boolean;
    mediaTypeValid: boolean;
    error?: string;
  }> {
    const mediaTypeValid =
      typeof descriptor.mediaType === 'string' &&
      (expectedMediaType === undefined || descriptor.mediaType === expectedMediaType);

    let digestValid = false;
    let sizeValid = false;
    let error: string | undefined;

    try {
      parseHash(descriptor.digest);
      const stored = await this.verifyStoredObject(descriptor.digest);
      digestValid = stored.ok;
      sizeValid = stored.ok && stored.size === descriptor.size;
      if (!stored.ok) error = stored.error;
      else if (!sizeValid) {
        error = `size mismatch: expected ${descriptor.size}, got ${stored.size}`;
      }
    } catch (err: unknown) {
      error = err instanceof Error ? err.message : String(err);
    }

    if (!mediaTypeValid) {
      error = `mediaType mismatch: expected '${expectedMediaType}', got '${descriptor.mediaType}'`;
    }

    return {
      ok: digestValid && sizeValid && mediaTypeValid,
      digestValid,
      sizeValid,
      mediaTypeValid,
      error,
    };
  }

  async quarantineObject(
    hash: string,
    reason: string,
  ): Promise<{ quarantined: boolean; quarantinePath?: string; error?: string }> {
    const src = this.getFilePath(hash);
    const { algorithm, digest } = parseHash(hash);
    const shard = digest.substring(0, 2);
    const rest = digest.substring(2);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const quarantineDir = path.join(this.baseDir, 'quarantine', algorithm, shard);
    const quarantinePath = path.join(quarantineDir, `${rest}.${stamp}`);
    const metaPath = `${quarantinePath}.json`;

    try {
      await fs.mkdir(quarantineDir, { recursive: true });
      await fs.rename(src, quarantinePath);
      await fs.writeFile(
        metaPath,
        JSON.stringify({ hash, reason, quarantinedAt: new Date().toISOString() }, null, 2),
        'utf-8',
      );
      this.cache.delete(hash);
      this.existsCache.delete(hash);
      return { quarantined: true, quarantinePath };
    } catch (error: unknown) {
      if (isNodeError(error) && error.code === 'ENOENT') {
        return { quarantined: false, error: `missing object ${hash}` };
      }
      const msg = error instanceof Error ? error.message : String(error);
      return { quarantined: false, error: msg };
    }
  }

  async *streamObjectDigests(signal?: AbortSignal): AsyncIterable<string> {
    for (const algorithm of ['sha256', 'sha512'] as const) {
      const algoRoot = path.join(this.baseDir, 'objects', algorithm);
      let shardEntries: Awaited<ReturnType<typeof fs.readdir>>;
      try {
        shardEntries = await fs.readdir(algoRoot, { withFileTypes: true });
      } catch (error: unknown) {
        if (isNodeError(error) && error.code === 'ENOENT') continue;
        throw error;
      }

      for (const shardEntry of shardEntries) {
        if (signal?.aborted) throw new Error('Operation aborted by user signal.');
        if (!shardEntry.isDirectory()) continue;
        if (shardEntry.name.startsWith('.')) continue;

        const shardDir = path.join(algoRoot, shardEntry.name);
        const files = await fs.readdir(shardDir, { withFileTypes: true });
        for (const file of files) {
          if (signal?.aborted) throw new Error('Operation aborted by user signal.');
          if (!file.isFile() || file.name.startsWith('.')) continue;
          yield `${algorithm}:${shardEntry.name}${file.name}`;
        }
      }
    }
  }
}
