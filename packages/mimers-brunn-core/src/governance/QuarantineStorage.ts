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
export class DiskQuarantineStorage implements ArchiveImportQuarantineStorage {
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
    const all = await this.list();
    return all.find((a) => a.content_hash === hash) || null;
  }

  private getFilePath(quarantineId: string): string {
    return path.join(this.rootPath, `${quarantineId}.bin`);
  }

  private getMetadataPath(quarantineId: string): string {
    return path.join(this.rootPath, `${quarantineId}.metadata.json`);
  }
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
