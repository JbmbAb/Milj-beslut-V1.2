import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  CASBoundaryViolation,
  CAS_DIGEST_MISMATCH,
  CAS_I02,
  CAS_IMMUTABILITY_VIOLATION,
  CAS_MUTATION_FORBIDDEN,
} from './CASInvariants';
import { CASAlgorithm, CASObjectLocation, joinCASRoot, parseCASHash, resolveObjectPath } from './CASPathResolver';

export const CAS_ALLOWED_OPERATIONS = ['put', 'get', 'exists'] as const;
export const CAS_FORBIDDEN_OPERATIONS = ['update', 'replace', 'mutate', 'overwrite', 'delete', 'truncate'] as const;

export type CASAllowedOperation = (typeof CAS_ALLOWED_OPERATIONS)[number];

export interface CASPutResult {
  readonly hash: string;
  readonly size: number;
  readonly existed: boolean;
}

/** CAS-I02: the write surface is put(bytes) -> hash. There is no address-first write. */
export interface WriteOnceCASRepository {
  put(bytes: Uint8Array): Promise<CASPutResult>;
  get(hash: string): Promise<Uint8Array | null>;
  exists(hash: string): Promise<boolean>;
}

export function assertCASOperationAllowed(operation: string): asserts operation is CASAllowedOperation {
  if ((CAS_ALLOWED_OPERATIONS as readonly string[]).includes(operation)) return;
  throw new CASBoundaryViolation(
    CAS_MUTATION_FORBIDDEN,
    CAS_I02,
    `operation '${operation}' is not part of the CAS surface (allowed: ${CAS_ALLOWED_OPERATIONS.join(', ')})`,
  );
}

/**
 * Narrows any implementation down to the three permitted operations at runtime, so a caller
 * cannot reach a mutation method that an implementation happens to carry.
 */
export function sealCASRepository(repository: WriteOnceCASRepository): WriteOnceCASRepository {
  return new Proxy(repository, {
    get(target, property, receiver) {
      if (typeof property === 'symbol') return Reflect.get(target, property, receiver);
      assertCASOperationAllowed(property);
      const value = Reflect.get(target, property, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
    set(_target, property) {
      throw new CASBoundaryViolation(
        CAS_MUTATION_FORBIDDEN,
        CAS_I02,
        `cannot assign '${String(property)}' on a sealed CAS repository`,
      );
    },
    deleteProperty(_target, property) {
      throw new CASBoundaryViolation(
        CAS_MUTATION_FORBIDDEN,
        CAS_I02,
        `cannot delete '${String(property)}' on a sealed CAS repository`,
      );
    },
  });
}

export function digestBytes(bytes: Uint8Array, algorithm: CASAlgorithm = 'sha256'): string {
  return `${algorithm}:${createHash(algorithm).update(bytes).digest('hex')}`;
}

function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * Reference implementation of the frozen CAS surface. Physical stores (filesystem, object storage)
 * must expose the same three operations and the same immutability behaviour.
 *
 * `root` is used exclusively to render physical paths — never for identity (CAS-I03).
 */
export class InMemoryCASRepository implements WriteOnceCASRepository {
  private readonly objects = new Map<string, Uint8Array>();

  constructor(
    private readonly root: string,
    private readonly algorithm: CASAlgorithm = 'sha256',
    /** Seam used by invariant tests to simulate a digest collision; production uses the real digest. */
    private readonly digestFn: (bytes: Uint8Array, algorithm: CASAlgorithm) => string = digestBytes,
  ) {}

  async put(bytes: Uint8Array): Promise<CASPutResult> {
    const hash = this.digestFn(bytes, this.algorithm);
    const existing = this.objects.get(hash);

    if (existing) {
      if (!equalBytes(existing, bytes)) {
        throw new CASBoundaryViolation(CAS_IMMUTABILITY_VIOLATION, CAS_I02, `digest ${hash} is already bound to different bytes`);
      }
      return { hash, size: bytes.length, existed: true };
    }

    this.objects.set(hash, Uint8Array.from(bytes));
    return { hash, size: bytes.length, existed: false };
  }

  /**
   * Replication path: bytes arrive with a claimed digest. The claim is verified against the bytes,
   * so a caller can never bind an existing digest to different content (CAS-I02).
   */
  async putAtDigest(claimedHash: string, bytes: Uint8Array): Promise<CASPutResult> {
    const { algorithm } = parseCASHash(claimedHash);
    const actual = this.digestFn(bytes, algorithm);
    const normalized = `${algorithm}:${parseCASHash(claimedHash).digest}`;

    if (actual !== normalized) {
      throw new CASBoundaryViolation(
        CAS_DIGEST_MISMATCH,
        CAS_I02,
        `claimed ${normalized} but bytes hash to ${actual}`,
      );
    }

    return this.put(bytes);
  }

  async get(hash: string): Promise<Uint8Array | null> {
    const stored = this.objects.get(this.normalize(hash));
    return stored ? Uint8Array.from(stored) : null;
  }

  async exists(hash: string): Promise<boolean> {
    return this.objects.has(this.normalize(hash));
  }

  /** Physical path for an object in this store. Identity is unaffected by `root` (CAS-I03). */
  physicalPath(hash: string): string {
    return joinCASRoot(this.root, this.locate(hash));
  }

  locate(hash: string): CASObjectLocation {
    return resolveObjectPath(hash);
  }

  /** Byte-for-byte relocation of the whole store, as a disk A -> disk B move would do. */
  relocateTo(newRoot: string): InMemoryCASRepository {
    const moved = new InMemoryCASRepository(newRoot, this.algorithm, this.digestFn);
    for (const [hash, bytes] of this.objects) {
      moved.objects.set(hash, Uint8Array.from(bytes));
    }
    return moved;
  }

  private normalize(hash: string): string {
    const { algorithm, digest } = parseCASHash(hash);
    return `${algorithm}:${digest}`;
  }
}

/**
 * Fysisk, disk-baserad lagring för CAS (WORM-invarianter enligt L1-10 och L1-11).
 * Garanterar oföränderlighet och deterministiska sökvägar oavsett plattform/katalogrot.
 */
export class DiskCASRepository implements WriteOnceCASRepository {
  constructor(
    private readonly root: string,
    private readonly algorithm: CASAlgorithm = 'sha256'
  ) {
    this.root = path.resolve(root);
  }

  async put(bytes: Uint8Array): Promise<CASPutResult> {
    const hash = digestBytes(bytes, this.algorithm);
    const location = resolveObjectPath(hash);
    const physicalPath = joinCASRoot(this.root, location);

    if (fs.existsSync(physicalPath)) {
      const existingBytes = fs.readFileSync(physicalPath);
      // Byte-for-byte kontroll för att garantera immutability (CAS-I02)
      if (Buffer.compare(existingBytes, Buffer.from(bytes)) !== 0) {
        throw new CASBoundaryViolation(
          CAS_IMMUTABILITY_VIOLATION,
          CAS_I02,
          `digest ${hash} is already bound to different bytes`
        );
      }
      return { hash, size: bytes.length, existed: true };
    }

    // Skapa kataloger atomärt på disk
    const dir = path.dirname(physicalPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const tmpDir = path.join(this.root, 'tmp');
    if (!fs.existsSync(tmpDir)) {
      fs.mkdirSync(tmpDir, { recursive: true });
    }

    // Skriv temporärt och döp om för att garantera atomära atomiska WORM-skrivningar
    const tmpFile = path.join(tmpDir, `tmp-${Math.random().toString(36).substring(7)}.bin`);
    fs.writeFileSync(tmpFile, bytes);

    try {
      fs.renameSync(tmpFile, physicalPath);
    } catch (err) {
      if (fs.existsSync(physicalPath)) {
        // En annan tråd eller process kan ha hunnit skriva under tiden
        const existingBytes = fs.readFileSync(physicalPath);
        if (Buffer.compare(existingBytes, Buffer.from(bytes)) !== 0) {
          throw new CASBoundaryViolation(
            CAS_IMMUTABILITY_VIOLATION,
            CAS_I02,
            `digest ${hash} is already bound to different bytes`
          );
        }
        return { hash, size: bytes.length, existed: true };
      }
      throw err;
    } finally {
      if (fs.existsSync(tmpFile)) {
        try { fs.unlinkSync(tmpFile); } catch {}
      }
    }

    return { hash, size: bytes.length, existed: false };
  }

  async get(hash: string): Promise<Uint8Array | null> {
    const location = resolveObjectPath(hash);
    const physicalPath = joinCASRoot(this.root, location);
    if (!fs.existsSync(physicalPath)) {
      return null;
    }
    return new Uint8Array(fs.readFileSync(physicalPath));
  }

  async exists(hash: string): Promise<boolean> {
    const location = resolveObjectPath(hash);
    const physicalPath = joinCASRoot(this.root, location);
    return fs.existsSync(physicalPath);
  }
}
