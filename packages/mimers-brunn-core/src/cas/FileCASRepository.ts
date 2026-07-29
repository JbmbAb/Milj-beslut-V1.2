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
  type PutResult,
} from './CASRepository';
import { WeightedLRUCache } from './cache';
import { canonicalizeStrict, hashSerialized, parseHash, type HashAlgorithm } from '../serialization';
import { InMemoryMetrics, type MetricsCollector } from '../metrics/MetricsCollector';

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

  async put(obj: unknown): Promise<PutResult> {
    this.metrics.inc('cas_puts_total', 1, { operation: 'put', algorithm: this.hashAlgorithm });

    const serializedData = canonicalizeStrict(obj);
    const bytes = Buffer.from(serializedData, 'utf-8');
    const size = bytes.byteLength;
    const hash = hashSerialized(serializedData, this.hashAlgorithm);
    const destinationPath = this.getFilePath(hash);

    const tempRandom = randomBytes(8).toString('hex');
    const tempFileName = `tmp_${hash.replace(':', '_')}_${process.pid}_${tempRandom}.tmp`;
    const tempPath = path.join(this.baseDir, 'tmp', tempFileName);

    let fileHandle: fs.FileHandle | null = null;
    try {
      fileHandle = await fs.open(tempPath, 'w');
      await fileHandle.write(serializedData, 0, 'utf-8');
      await fileHandle.datasync();
      await fileHandle.close();
      fileHandle = null;

      await fs.mkdir(path.dirname(destinationPath), { recursive: true });
      await this.commitStrategy.commit(tempPath, destinationPath);

      this.cache.set(hash, bytes);
      this.existsCache.set(hash, true);
      this.metrics.inc('cas_bytes_written', size, { operation: 'put', algorithm: this.hashAlgorithm });

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
          algorithm: this.hashAlgorithm,
        });
        const existingBytes = await fs.readFile(destinationPath);
        if (!existingBytes.equals(bytes)) {
          throw new CASIntegrityError(
            `[P-05] CAS Integrity Collision: File exists but contents differ! Hash: ${hash}`,
          );
        }
        this.cache.set(hash, bytes);
        this.existsCache.set(hash, true);
        return { hash, size, existed: true };
      }
      throw error;
    }
  }

  async get<T = unknown>(hash: string, options?: { verifyHash?: boolean }): Promise<T | null> {
    const { algorithm } = parseHash(hash);
    this.metrics.inc('cas_gets_total', 1, { operation: 'get', algorithm });

    if (this.cache.has(hash)) {
      this.metrics.inc('cas_cache_hits', 1, { operation: 'get', result: 'success', algorithm });
      const cachedBytes = this.cache.get(hash)!;
      const dataStr = Buffer.from(cachedBytes).toString('utf-8');
      if (options?.verifyHash) {
        const computed = hashSerialized(dataStr, algorithm);
        if (computed !== hash) {
          throw new Error(`In-Memory Corruption: cached hash ${computed} != ${hash}`);
        }
      }
      return JSON.parse(dataStr) as T;
    }
    this.metrics.inc('cas_cache_misses', 1, { operation: 'get', result: 'miss', algorithm });

    try {
      const dataBytes = await fs.readFile(this.getFilePath(hash));
      const dataStr = dataBytes.toString('utf-8');
      if (options?.verifyHash) {
        const computed = hashSerialized(dataStr, algorithm);
        if (computed !== hash) {
          throw new CASIntegrityError(
            `Storage Read Corruption: on-disk hash '${computed}' != '${hash}'.`,
          );
        }
      }
      const parsed = JSON.parse(dataStr) as T;
      this.cache.set(hash, dataBytes);
      this.existsCache.set(hash, true);
      return parsed;
    } catch (error: unknown) {
      if (isNodeError(error) && error.code === 'ENOENT') return null;
      throw error;
    }
  }

  /** Windows-safe sharded path: objects/<algo>/<2hex>/<rest> (no ':' in filename). */
  getFilePath(hash: string): string {
    const { algorithm, digest } = parseHash(hash);
    const shard = digest.substring(0, 2);
    const rest = digest.substring(2);
    return path.join(this.baseDir, 'objects', algorithm, shard, rest);
  }
}
