import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

export interface ArchiveImportAcquisition {
  readonly acquisition_kind: 'ARCHIVE_IMPORT';
  /** Stable logical archive boundary from the approved Source Registry entry. */
  readonly archive_id: string;
  /** Observed materialization locator; provenance, never registry authority. */
  readonly observed_locator: string;
  /** When this already-materialized object was observed/imported. */
  readonly observed_at: string;
  /** Optional observation metadata such as RCLONE or a mounted-filesystem transport. */
  readonly transport_metadata?: Readonly<Record<string, string>>;
}

interface QuarantineArtifactBase {
  readonly quarantine_id: string; // Unikt ID för denna karantänsartefakt (UUIDv4)
  readonly source_id: string; // ID från källregistret (t.ex. 'mmd_v1')
  readonly file_name: string; // Ursprungligt filnamn
  readonly retrieved_at: string; // Tidpunkt för nedladdning
  readonly content_hash: string; // SHA-256 hash av filinnehållet
  readonly status: 'quarantined' | 'validated' | 'rejected' | 'promoted';
  readonly validation_errors?: readonly string[];
  readonly custom_metadata?: Record<string, any>;
}

/** Historical and current network acquisition shape. Its URL remains mandatory. */
export interface NetworkRawSourceArtifact extends QuarantineArtifactBase {
  readonly source_url: string;
  readonly acquisition?: never;
}

/** Explicit non-network archive/import observation. It must never carry a fabricated URL. */
export interface ArchiveImportRawSourceArtifact extends QuarantineArtifactBase {
  readonly source_url?: never;
  readonly acquisition: ArchiveImportAcquisition;
}

export type RawSourceArtifact = NetworkRawSourceArtifact | ArchiveImportRawSourceArtifact;

export interface QuarantinePutResult {
  readonly quarantine_id: string;
  readonly file_path: string;
  readonly metadata_path: string;
  readonly is_duplicate: boolean;
  readonly hash: string;
}

export type StreamingQuarantineReasonCode =
  | 'REJECT_OBJECT_SIZE'
  | 'REJECT_EMPTY_OBJECT'
  | 'REJECT_CHECKSUM'
  | 'REJECT_QUARANTINE_IO'
  | 'REJECT_QUARANTINE_CLEANUP';

/**
 * Failure of a streaming quarantine session.
 *
 * A session error is never a successful observation. `REJECT_QUARANTINE_IO` means the temp
 * object was removed and the caller may retry. `REJECT_QUARANTINE_CLEANUP` means removal
 * failed, so the caller must not treat the attempt as success or as a clean retry.
 */
export class StreamingQuarantineError extends Error {
  readonly reason_code: StreamingQuarantineReasonCode;

  constructor(message: string, reasonCode: StreamingQuarantineReasonCode) {
    super(message);
    this.name = 'StreamingQuarantineError';
    this.reason_code = reasonCode;
  }
}

export interface StreamingQuarantinePutResult extends QuarantinePutResult {
  readonly byte_length: number;
}

/** Independent chunk witness. Finalize commits only when this matches the bytes on disk. */
export interface StreamingQuarantineWitness {
  readonly byte_length: number;
  readonly content_hash: string;
}

export interface BeginNetworkObservationRequest {
  readonly source_id: string;
  readonly source_url: string;
  readonly file_name: string;
  readonly custom_metadata?: Record<string, any>;
  readonly max_bytes?: number;
}

/**
 * One in-progress network observation.
 *
 * `write` accepts a single chunk. `finalize` is the only transition that creates a quarantine
 * observation. `abort` deletes the temp object and creates nothing.
 */
export interface StreamingQuarantinePutSession {
  write(chunk: Uint8Array): Promise<void>;
  finalize(witness: StreamingQuarantineWitness): Promise<StreamingQuarantinePutResult>;
  abort(): Promise<void>;
}

/**
 * Additive streaming capability. `QuarantineStorage.put` remains the complete-byte contract.
 */
export interface StreamingQuarantineStorage extends QuarantineStorage {
  beginNetworkObservation(
    request: BeginNetworkObservationRequest,
  ): Promise<StreamingQuarantinePutSession>;
}

export function isStreamingQuarantineStorage(
  storage: QuarantineStorage,
): storage is StreamingQuarantineStorage {
  return typeof (storage as StreamingQuarantineStorage).beginNetworkObservation === 'function';
}

export interface ArchiveImportQuarantinePutRequest {
  readonly source_id: string;
  readonly file_name: string;
  readonly bytes: Uint8Array;
  readonly acquisition: ArchiveImportAcquisition;
  readonly custom_metadata?: Record<string, any>;
}

export interface QuarantineStorage {
  put(
    sourceId: string,
    sourceUrl: string,
    fileName: string,
    bytes: Uint8Array,
    customMetadata?: Record<string, any>,
  ): Promise<QuarantinePutResult>;

  get(quarantineId: string): Promise<Uint8Array | null>;
  getMetadata(quarantineId: string): Promise<RawSourceArtifact | null>;
  updateStatus(
    quarantineId: string,
    status: 'validated' | 'rejected' | 'promoted',
    errors?: string[],
  ): Promise<void>;
  list(filterStatus?: RawSourceArtifact['status']): Promise<readonly RawSourceArtifact[]>;
}

/** Capability required by the explicit governed archive-import operation. */
export interface ArchiveImportQuarantineStorage extends QuarantineStorage {
  putArchiveImport(request: ArchiveImportQuarantinePutRequest): Promise<QuarantinePutResult>;
}

/**
 * Fysisk karantänlagring på disk (DiskQuarantineStorage)
 * Uppfyller strikt L1-11 kontraktsinvarianter:
 *   - Fysiskt isolerad från CAS (skriver till en specifik .quarantine mapp).
 *   - Bevarar originalet i sin helhet även om verifieringen misslyckas.
 *   - Stöder explicit identitet, status, åtkomst och loggning.
 */
export class DiskQuarantineStorage implements ArchiveImportQuarantineStorage, StreamingQuarantineStorage {
  private readonly rootPath: string;

  constructor(customRootPath?: string) {
    // Standard sökmapp i projektet
    this.rootPath = customRootPath || path.resolve(process.cwd(), '.quarantine');
  }

  private ensureDirectoryExists(dir: string): void {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  private calculateHash(bytes: Uint8Array): string {
    return createHash('sha256').update(bytes).digest('hex');
  }

  async put(
    sourceId: string,
    sourceUrl: string,
    fileName: string,
    bytes: Uint8Array,
    customMetadata?: Record<string, any>,
  ): Promise<QuarantinePutResult> {
    if (!sourceUrl || sourceUrl.trim().length === 0) {
      throw new Error('Network quarantine acquisition requires a non-empty source URL.');
    }
    return this.putObserved({
      source_id: sourceId,
      source_url: sourceUrl,
      file_name: fileName,
      bytes,
      custom_metadata: customMetadata,
    });
  }

  async putArchiveImport(request: ArchiveImportQuarantinePutRequest): Promise<QuarantinePutResult> {
    const { acquisition } = request;
    if (
      acquisition.acquisition_kind !== 'ARCHIVE_IMPORT' ||
      !acquisition.archive_id?.trim() ||
      !acquisition.observed_locator?.trim() ||
      !acquisition.observed_at?.trim()
    ) {
      throw new Error('Archive quarantine acquisition requires complete ARCHIVE_IMPORT provenance.');
    }
    if (!request.source_id?.trim() || !request.file_name?.trim() || request.bytes.byteLength === 0) {
      throw new Error('Archive quarantine acquisition requires source_id, file_name, and non-empty bytes.');
    }
    return this.putObserved({
      source_id: request.source_id,
      file_name: request.file_name,
      bytes: request.bytes,
      acquisition,
      custom_metadata: request.custom_metadata,
    });
  }

  private async putObserved(input: {
    readonly source_id: string;
    readonly source_url?: string;
    readonly file_name: string;
    readonly bytes: Uint8Array;
    readonly acquisition?: ArchiveImportAcquisition;
    readonly custom_metadata?: Record<string, any>;
  }): Promise<QuarantinePutResult> {
    this.ensureDirectoryExists(this.rootPath);
    const hash = this.calculateHash(input.bytes);
    const id = randomUUID();

    // Sök efter existerande oförändrade filer i karantänen för dedubblering inom karantänen
    const existing = await this.findByHash(hash);
    if (existing) {
      if (input.acquisition && !sameArchiveObservation(existing, input)) {
        throw new Error(
          'Archive quarantine acquisition refuses to reuse bytes stored under different provenance.',
        );
      }
      return {
        quarantine_id: existing.quarantine_id,
        file_path: this.getFilePath(existing.quarantine_id),
        metadata_path: this.getMetadataPath(existing.quarantine_id),
        is_duplicate: true,
        hash,
      };
    }

    const common = {
      quarantine_id: id,
      source_id: input.source_id,
      file_name: input.file_name,
      retrieved_at: new Date().toISOString(),
      content_hash: hash,
      status: 'quarantined' as const,
      custom_metadata: input.custom_metadata,
    };
    const artifact: RawSourceArtifact = input.acquisition
      ? { ...common, acquisition: input.acquisition }
      : { ...common, source_url: input.source_url! };

    const filePath = this.getFilePath(id);
    const metadataPath = this.getMetadataPath(id);

    // Spara fysiskt på disk
    fs.writeFileSync(filePath, input.bytes);
    fs.writeFileSync(metadataPath, JSON.stringify(artifact, null, 2), 'utf8');

    return {
      quarantine_id: id,
      file_path: filePath,
      metadata_path: metadataPath,
      is_duplicate: false,
      hash,
    };
  }

  /**
   * Opens a temp object under `.incoming`. The temp name is not a quarantine id, and `list`
   * only reads root metadata, so an unfinished temp cannot be observed as a landed object.
   * Restart does not finalize leftovers. Crash leftovers are not scavenged in this slice.
   */
  async beginNetworkObservation(
    request: BeginNetworkObservationRequest,
  ): Promise<StreamingQuarantinePutSession> {
    if (!request.source_url || request.source_url.trim().length === 0) {
      throw new StreamingQuarantineError(
        'Network quarantine acquisition requires a non-empty source URL.',
        'REJECT_QUARANTINE_IO',
      );
    }
    if (!request.source_id?.trim() || !request.file_name?.trim()) {
      throw new StreamingQuarantineError(
        'Network quarantine acquisition requires source_id and file_name.',
        'REJECT_QUARANTINE_IO',
      );
    }

    const incoming = path.join(this.rootPath, INCOMING_DIR_NAME);
    this.ensureDirectoryExists(incoming);
    const tempPath = path.join(incoming, `${randomUUID()}.partial`);
    const stream = fs.createWriteStream(tempPath, { flags: 'wx' });
    let fileDescriptor: number | undefined;
    stream.on('error', () => {
      // Write and end paths surface the same error. This listener keeps it from crashing the process.
    });
    await new Promise<void>((resolve, reject) => {
      const fail = (error: Error) => {
        stream.off('open', succeed);
        reject(error);
      };
      const succeed = (fd: number) => {
        fileDescriptor = fd;
        stream.off('error', fail);
        resolve();
      };
      stream.once('open', succeed);
      stream.once('error', fail);
    });

    if (fileDescriptor === undefined) {
      stream.destroy();
      throw new StreamingQuarantineError(
        'Streaming quarantine writer opened without a file descriptor.',
        'REJECT_QUARANTINE_IO',
      );
    }

    return new DiskStreamingQuarantineSession(tempPath, request, stream, fileDescriptor, (commit) =>
      this.commitStreamedNetworkObservation(commit),
    );
  }

  private async commitStreamedNetworkObservation(input: {
    readonly tempPath: string;
    readonly hash: string;
    readonly byteLength: number;
    readonly request: BeginNetworkObservationRequest;
  }): Promise<StreamingQuarantinePutResult> {
    // A quarantine id is an observation, not a content-addressed blob. Reuse it only when
    // source, URL, file name, and registry binding all match. Identical bytes under any
    // other binding become a new observation; the bytes may share an inode via a hard link.
    const matches = await this.findAllByHash(input.hash);
    const identical = matches.find((candidate) =>
      sameStreamedNetworkProvenance(candidate, input.request),
    );
    if (identical) {
      await fs.promises.rm(input.tempPath, { force: false });
      return {
        quarantine_id: identical.quarantine_id,
        file_path: this.getFilePath(identical.quarantine_id),
        metadata_path: this.getMetadataPath(identical.quarantine_id),
        is_duplicate: true,
        hash: input.hash,
        byte_length: input.byteLength,
      };
    }

    const id = randomUUID();
    const filePath = this.getFilePath(id);
    const metadataPath = this.getMetadataPath(id);
    const artifact: NetworkRawSourceArtifact = {
      quarantine_id: id,
      source_id: input.request.source_id,
      source_url: input.request.source_url,
      file_name: input.request.file_name,
      retrieved_at: new Date().toISOString(),
      content_hash: input.hash,
      status: 'quarantined',
      custom_metadata: input.request.custom_metadata,
    };

    // Fail-closed visibility, not one crash-atomic transaction: the canonical bytes and
    // the metadata are two writes. A crash between them can leave an orphan .bin that
    // list() does not publish. Scavenging those leftovers is a separate operational closure.
    try {
      await this.placeStreamedBytes(input.tempPath, filePath, matches[0]);
    } catch (error) {
      throw new StreamingQuarantineError(
        `REJECT_QUARANTINE_IO: could not finalize streamed quarantine bytes: ${errorMessage(error)}`,
        'REJECT_QUARANTINE_IO',
      );
    }

    try {
      await fs.promises.writeFile(metadataPath, JSON.stringify(artifact, null, 2), {
        encoding: 'utf8',
        flag: 'wx',
      });
    } catch (error) {
      try {
        await fs.promises.rm(filePath, { force: true });
      } catch (cleanupError) {
        throw new StreamingQuarantineError(
          `streaming quarantine metadata write failed and canonical cleanup failed: ${errorMessage(cleanupError)}; cause: ${errorMessage(error)}`,
          'REJECT_QUARANTINE_CLEANUP',
        );
      }
      throw new StreamingQuarantineError(
        `REJECT_QUARANTINE_IO: could not write streamed quarantine metadata: ${errorMessage(error)}`,
        'REJECT_QUARANTINE_IO',
      );
    }

    return {
      quarantine_id: id,
      file_path: filePath,
      metadata_path: metadataPath,
      is_duplicate: false,
      hash: input.hash,
      byte_length: input.byteLength,
    };
  }

  async get(quarantineId: string): Promise<Uint8Array | null> {
    const filePath = this.getFilePath(quarantineId);
    if (!fs.existsSync(filePath)) {
      return null;
    }
    return new Uint8Array(fs.readFileSync(filePath));
  }

  async getMetadata(quarantineId: string): Promise<RawSourceArtifact | null> {
    const metadataPath = this.getMetadataPath(quarantineId);
    if (!fs.existsSync(metadataPath)) {
      return null;
    }
    try {
      return JSON.parse(fs.readFileSync(metadataPath, 'utf8')) as RawSourceArtifact;
    } catch {
      return null;
    }
  }

  async updateStatus(
    quarantineId: string,
    status: 'validated' | 'rejected' | 'promoted',
    errors?: string[],
  ): Promise<void> {
    this.ensureDirectoryExists(this.rootPath);
    const metadata = await this.getMetadata(quarantineId);
    if (!metadata) {
      throw new Error(`Karantänsartefakt med ID '${quarantineId}' hittades inte.`);
    }

    const updated: RawSourceArtifact = {
      ...metadata,
      status,
      validation_errors: errors
        ? [...(metadata.validation_errors || []), ...errors]
        : metadata.validation_errors,
    };

    const metadataPath = this.getMetadataPath(quarantineId);
    fs.writeFileSync(metadataPath, JSON.stringify(updated, null, 2), 'utf8');
  }

  async list(filterStatus?: RawSourceArtifact['status']): Promise<readonly RawSourceArtifact[]> {
    if (!fs.existsSync(this.rootPath)) {
      return [];
    }
    const files = fs.readdirSync(this.rootPath);
    const artifacts: RawSourceArtifact[] = [];

    for (const file of files) {
      if (file.endsWith('.metadata.json')) {
        const id = file.replace('.metadata.json', '');
        const meta = await this.getMetadata(id);
        if (meta && (!filterStatus || meta.status === filterStatus)) {
          artifacts.push(meta);
        }
      }
    }

    return artifacts;
  }

  private async findByHash(hash: string): Promise<RawSourceArtifact | null> {
    const matches = await this.findAllByHash(hash);
    return matches[0] ?? null;
  }

  private async findAllByHash(hash: string): Promise<RawSourceArtifact[]> {
    const all = await this.list();
    return all.filter((artifact) => artifact.content_hash === hash);
  }

  /**
   * Places the streamed bytes at the new observation path.
   * Same-hash bytes are hardlinked when the filesystem allows it. The temp file is removed
   * only after that link exists. If linking fails, the temp file itself is renamed into place.
   */
  private async placeStreamedBytes(
    tempPath: string,
    filePath: string,
    donor: RawSourceArtifact | undefined,
  ): Promise<void> {
    if (donor) {
      try {
        await fs.promises.link(this.getFilePath(donor.quarantine_id), filePath);
      } catch {
        await fs.promises.rename(tempPath, filePath);
        return;
      }
      try {
        await fs.promises.rm(tempPath, { force: false });
      } catch (error) {
        await fs.promises.rm(filePath, { force: true });
        throw error;
      }
      return;
    }
    await fs.promises.rename(tempPath, filePath);
  }

  private getFilePath(quarantineId: string): string {
    return path.join(this.rootPath, `${quarantineId}.bin`);
  }

  private getMetadataPath(quarantineId: string): string {
    return path.join(this.rootPath, `${quarantineId}.metadata.json`);
  }
}

const INCOMING_DIR_NAME = '.incoming';

class DiskStreamingQuarantineSession implements StreamingQuarantinePutSession {
  private settled = false;
  private byteLength = 0;
  private readonly hash = createHash('sha256');
  private tail: Promise<void> = Promise.resolve();

  constructor(
    private readonly tempPath: string,
    private readonly request: BeginNetworkObservationRequest,
    private readonly stream: fs.WriteStream,
    private readonly fileDescriptor: number,
    private readonly commit: (input: {
      readonly tempPath: string;
      readonly hash: string;
      readonly byteLength: number;
      readonly request: BeginNetworkObservationRequest;
    }) => Promise<StreamingQuarantinePutResult>,
  ) {}

  async write(chunk: Uint8Array): Promise<void> {
    if (this.settled) {
      throw new StreamingQuarantineError(
        'Streaming quarantine session is closed.',
        'REJECT_QUARANTINE_IO',
      );
    }
    if (chunk.byteLength === 0) return;

    const next = this.byteLength + chunk.byteLength;
    if (this.request.max_bytes !== undefined && next > this.request.max_bytes) {
      await this.fail(
        new StreamingQuarantineError(
          `REJECT_OBJECT_SIZE: streamed observation exceeded the ${this.request.max_bytes} byte limit.`,
          'REJECT_OBJECT_SIZE',
        ),
      );
    }

    this.byteLength = next;
    this.hash.update(chunk);
    try {
      await this.enqueue(chunk);
    } catch (error) {
      await this.fail(
        new StreamingQuarantineError(
          `REJECT_QUARANTINE_IO: ${errorMessage(error)}`,
          'REJECT_QUARANTINE_IO',
        ),
      );
    }
  }

  async finalize(witness: StreamingQuarantineWitness): Promise<StreamingQuarantinePutResult> {
    if (this.settled) {
      throw new StreamingQuarantineError(
        'Streaming quarantine session is already closed.',
        'REJECT_QUARANTINE_IO',
      );
    }

    try {
      await this.tail;
      if (this.byteLength === 0) {
        throw new StreamingQuarantineError(
          'REJECT_EMPTY_OBJECT: streamed observation contained no bytes.',
          'REJECT_EMPTY_OBJECT',
        );
      }

      const contentHash = this.hash.digest('hex');
      if (witness.byte_length !== this.byteLength || witness.content_hash !== contentHash) {
        throw new StreamingQuarantineError(
          'REJECT_CHECKSUM: streamed witness does not match the quarantine hash.',
          'REJECT_CHECKSUM',
        );
      }

      await this.finishWriter();
      const diskHash = await hashFileIncremental(this.tempPath);
      if (diskHash !== contentHash) {
        throw new StreamingQuarantineError(
          'REJECT_CHECKSUM: quarantine temp bytes do not match the streamed hash.',
          'REJECT_CHECKSUM',
        );
      }

      const result = await this.commit({
        tempPath: this.tempPath,
        hash: contentHash,
        byteLength: this.byteLength,
        request: this.request,
      });
      this.settled = true;
      return result;
    } catch (error) {
      return this.fail(error);
    }
  }

  async abort(): Promise<void> {
    if (this.settled) return;
    this.settled = true;
    await this.cleanupTemp();
  }

  private enqueue(chunk: Uint8Array): Promise<void> {
    const run = this.tail.then(() => this.writeChunk(chunk));
    this.tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async writeChunk(chunk: Uint8Array): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = (error?: Error | null) => {
        if (settled) return;
        settled = true;
        this.stream.off('error', onError);
        if (error) reject(error);
        else resolve();
      };
      const onError = (error: Error) => finish(error);
      this.stream.once('error', onError);
      this.stream.write(chunk, (error) => finish(error ?? null));
    });
  }

  private async finishWriter(): Promise<void> {
    await this.tail;
    await new Promise<void>((resolve, reject) => {
      fs.fsync(this.fileDescriptor, (error) => (error ? reject(error) : resolve()));
    });
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = (error?: Error | null) => {
        if (settled) return;
        settled = true;
        this.stream.off('error', onError);
        if (error) reject(error);
        else resolve();
      };
      const onError = (error: Error) => finish(error);
      this.stream.once('error', onError);
      this.stream.end(() => finish(null));
    });
  }

  private async fail(error: unknown): Promise<never> {
    if (!this.settled) {
      this.settled = true;
      try {
        await this.cleanupTemp();
      } catch (cleanupError) {
        throw new StreamingQuarantineError(
          `streaming quarantine failed and temp cleanup failed: ${errorMessage(cleanupError)}; cause: ${errorMessage(error)}`,
          'REJECT_QUARANTINE_CLEANUP',
        );
      }
    }
    if (error instanceof StreamingQuarantineError) throw error;
    throw new StreamingQuarantineError(errorMessage(error), 'REJECT_QUARANTINE_IO');
  }

  private async cleanupTemp(): Promise<void> {
    if (!this.stream.destroyed && !this.stream.writableFinished) {
      await new Promise<void>((resolve) => {
        this.stream.once('close', () => resolve());
        this.stream.destroy();
      });
    }
    await fs.promises.rm(this.tempPath, { force: true });
  }
}

async function hashFileIncremental(filePath: string): Promise<string> {
  const hash = createHash('sha256');
  const stream = fs.createReadStream(filePath);
  try {
    for await (const chunk of stream) {
      hash.update(chunk);
    }
  } catch (error) {
    stream.destroy();
    throw error;
  }
  return hash.digest('hex');
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sameStreamedNetworkProvenance(
  existing: RawSourceArtifact,
  request: BeginNetworkObservationRequest,
): boolean {
  if (!('source_url' in existing) || typeof existing.source_url !== 'string') return false;
  return (
    existing.source_id === request.source_id &&
    existing.source_url === request.source_url &&
    existing.file_name === request.file_name &&
    registryArtifactId(existing.custom_metadata) === registryArtifactId(request.custom_metadata)
  );
}

function registryArtifactId(metadata: Record<string, unknown> | undefined): string | undefined {
  const value = metadata?.registry_artifact_id;
  return typeof value === 'string' ? value : undefined;
}

function sameArchiveObservation(
  existing: RawSourceArtifact,
  input: {
    readonly source_id: string;
    readonly acquisition?: ArchiveImportAcquisition;
  },
): boolean {
  if (!input.acquisition || !('acquisition' in existing) || !existing.acquisition) return false;

  return (
    existing.source_id === input.source_id &&
    existing.acquisition.archive_id === input.acquisition.archive_id &&
    existing.acquisition.observed_locator === input.acquisition.observed_locator &&
    existing.acquisition.observed_at === input.acquisition.observed_at &&
    JSON.stringify(existing.acquisition.transport_metadata ?? {}) ===
      JSON.stringify(input.acquisition.transport_metadata ?? {})
  );
}
