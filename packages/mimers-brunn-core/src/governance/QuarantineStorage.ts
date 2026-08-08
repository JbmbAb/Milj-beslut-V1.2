import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

export interface RawSourceArtifact {
  readonly quarantine_id: string; // Unikt ID för denna karantänsartefakt (UUIDv4)
  readonly source_id: string;      // ID från källregistret (t.ex. 'mmd_v1')
  readonly source_url: string;     // URL där filen skördades ifrån
  readonly file_name: string;      // Ursprungligt filnamn
  readonly retrieved_at: string;   // Tidpunkt för nedladdning
  readonly content_hash: string;   // SHA-256 hash av filinnehållet
  readonly status: 'quarantined' | 'validated' | 'rejected' | 'promoted';
  readonly validation_errors?: readonly string[];
  readonly custom_metadata?: Record<string, any>;
}

export interface QuarantinePutResult {
  readonly quarantine_id: string;
  readonly file_path: string;
  readonly metadata_path: string;
  readonly is_duplicate: boolean;
  readonly hash: string;
}

export interface QuarantineStorage {
  put(
    sourceId: string,
    sourceUrl: string,
    fileName: string,
    bytes: Uint8Array,
    customMetadata?: Record<string, any>
  ): Promise<QuarantinePutResult>;

  get(quarantineId: string): Promise<Uint8Array | null>;
  getMetadata(quarantineId: string): Promise<RawSourceArtifact | null>;
  updateStatus(
    quarantineId: string,
    status: 'validated' | 'rejected' | 'promoted',
    errors?: string[]
  ): Promise<void>;
  list(filterStatus?: RawSourceArtifact['status']): Promise<readonly RawSourceArtifact[]>;
}

/**
 * Fysisk karantänlagring på disk (DiskQuarantineStorage)
 * Uppfyller strikt L1-11 kontraktsinvarianter:
 *   - Fysiskt isolerad från CAS (skriver till en specifik .quarantine mapp).
 *   - Bevarar originalet i sin helhet även om verifieringen misslyckas.
 *   - Stöder explicit identitet, status, åtkomst och loggning.
 */
export class DiskQuarantineStorage implements QuarantineStorage {
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
    customMetadata?: Record<string, any>
  ): Promise<QuarantinePutResult> {
    this.ensureDirectoryExists(this.rootPath);
    const hash = this.calculateHash(bytes);
    const id = randomUUID();

    // Sök efter existerande oförändrade filer i karantänen för dedubblering inom karantänen
    const existing = await this.findByHash(hash);
    if (existing) {
      return {
        quarantine_id: existing.quarantine_id,
        file_path: this.getFilePath(existing.quarantine_id),
        metadata_path: this.getMetadataPath(existing.quarantine_id),
        is_duplicate: true,
        hash,
      };
    }

    const artifact: RawSourceArtifact = {
      quarantine_id: id,
      source_id: sourceId,
      source_url: sourceUrl,
      file_name: fileName,
      retrieved_at: new Date().toISOString(),
      content_hash: hash,
      status: 'quarantined',
      custom_metadata: customMetadata,
    };

    const filePath = this.getFilePath(id);
    const metadataPath = this.getMetadataPath(id);

    // Spara fysiskt på disk
    fs.writeFileSync(filePath, bytes);
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
    errors?: string[]
  ): Promise<void> {
    this.ensureDirectoryExists(this.rootPath);
    const metadata = await this.getMetadata(quarantineId);
    if (!metadata) {
      throw new Error(`Karantänsartefakt med ID '${quarantineId}' hittades inte.`);
    }

    const updated: RawSourceArtifact = {
      ...metadata,
      status,
      validation_errors: errors ? [...(metadata.validation_errors || []), ...errors] : metadata.validation_errors,
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
